// ─────────────────────────────────────────────────────────────────────────────
// Injury / team-news adapter.
//
// Free, no-API-key source: AFL news RSS feeds (configured via AFL_NEWS_FEEDS).
// RSS items act as a plain-text feed; we parse them, infer a coarse status from
// keywords ("ruled out", "in doubt", "managed", "named"…) and match items to the
// players in a game by name. The qualitative note rides along so Claude and the
// UI can show *why* (hamstring, late out, rested, travel, personal reasons).
//
// Everything degrades gracefully: a missing/blocked/empty feed yields no news,
// exactly like the old stub, so the rest of the app never has to special-case it.
// The UI shows nothing (or "—") when a player has no matched news.
// ─────────────────────────────────────────────────────────────────────────────

import { cached } from "@/lib/ingest/cache";
import { env } from "@/lib/env";

export type InjuryStatus =
  | "available"
  | "test"
  | "out"
  | "managed"
  | "unknown";

export interface InjuryNews {
  playerName: string;
  team: string;
  status: InjuryStatus;
  note?: string;
  source?: string;
  updatedAt?: string;
}

export interface InjurySource {
  /** Human-readable name for diagnostics/UI. */
  name: string;
  /** Return current injury/news for a team, or [] if unavailable. */
  getTeamNews(team: string): Promise<InjuryNews[]>;
}

export interface RosterPlayer {
  id: number;
  name: string;
  team: string;
}

// ── RSS fetch + parse ────────────────────────────────────────────────────────

interface NewsItem {
  title: string;
  summary: string;
  published: string | null;
}

const FEED_TTL_SECONDS = 30 * 60; // refresh at most twice an hour

function feedUrls(): string[] {
  return env.AFL_NEWS_FEEDS.split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}

/** Strip CDATA/tags/entities down to readable text. */
function decodeText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks) {
    const pick = (tag: string): string => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      return m ? decodeText(m[1]) : "";
    };
    const title = pick("title");
    if (!title) continue;
    items.push({
      title,
      summary: pick("description") || pick("content:encoded"),
      published: pick("pubDate") || null,
    });
  }
  return items;
}

/** Fetch + parse every configured feed, cached so we don't re-scrape per load. */
async function fetchNewsItems(): Promise<NewsItem[]> {
  const urls = feedUrls();
  if (urls.length === 0) return [];
  return cached<NewsItem[]>("afl:news:rss", FEED_TTL_SECONDS, async () => {
    const all: NewsItem[] = [];
    await Promise.all(
      urls.map(async (url) => {
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": env.SQUIGGLE_CONTACT, Accept: "application/rss+xml, application/xml, text/xml" },
          });
          if (!res.ok) {
            console.warn(`[injuries] feed ${url} -> ${res.status}`);
            return;
          }
          all.push(...parseRss(await res.text()));
        } catch (err) {
          console.warn(`[injuries] feed ${url} failed:`, err);
        }
      }),
    );
    return all;
  });
}

// ── Status inference + player matching ───────────────────────────────────────

// First rule that matches wins, most-severe first. Anything else stays unknown.
const STATUS_RULES: { status: InjuryStatus; re: RegExp }[] = [
  {
    status: "out",
    re: /\b(ruled out|won['’]?t play|will (?:miss|not play)|sidelined|out (?:for|injured)|omitted|dropped|axed|suspended|season[- ]ending|to miss)\b/i,
  },
  {
    status: "test",
    re: /\b(in doubt|injury cloud|cloud over|fitness test|race against|to be tested|questionable|under a cloud|in the balance|managing a)\b/i,
  },
  {
    status: "managed",
    re: /\b(managed|rested|load management|given a (?:week|rest)|wrapped in cotton)\b/i,
  },
  {
    status: "available",
    re: /\b(named|recalled|returns?|cleared to play|passes? (?:a )?fitness|back in|set to play|to return)\b/i,
  },
];

function inferStatus(text: string): InjuryStatus {
  for (const rule of STATUS_RULES) {
    if (rule.re.test(text)) return rule.status;
  }
  return "unknown";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does an article mention this player? Full name, or a distinctive surname. */
function mentionsPlayer(text: string, name: string, team: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes(name.toLowerCase())) return true;
  const parts = name.toLowerCase().split(/\s+/).filter(Boolean);
  const surname = parts[parts.length - 1] ?? "";
  // Surname-only is risky for common/short names — require the team nearby.
  if (surname.length >= 4 && new RegExp(`\\b${escapeRegExp(surname)}\\b`).test(lower)) {
    return lower.includes(team.toLowerCase());
  }
  return false;
}

/**
 * Match the current news feed against a game's roster. Returns only players who
 * have a *meaningful* status (out/test/managed/available) — a player merely
 * named in a match report isn't "news" and would just add noise to the cards.
 */
export async function getPlayerNews(
  roster: RosterPlayer[],
): Promise<Map<number, InjuryNews>> {
  const out = new Map<number, InjuryNews>();
  if (roster.length === 0) return out;

  let items: NewsItem[] = [];
  try {
    items = await fetchNewsItems();
  } catch (err) {
    console.warn("[injuries] fetch failed:", err);
    return out;
  }
  if (items.length === 0) return out;

  for (const p of roster) {
    // Feeds are newest-first; take the first meaningful mention.
    for (const item of items) {
      const text = `${item.title} ${item.summary}`;
      if (!mentionsPlayer(text, p.name, p.team)) continue;
      const status = inferStatus(text);
      if (status === "unknown") continue;
      out.set(p.id, {
        playerName: p.name,
        team: p.team,
        status,
        note: item.title,
        source: "RSS",
        updatedAt: item.published ?? undefined,
      });
      break;
    }
  }
  return out;
}

// ── Team-level interface (kept for compatibility) ────────────────────────────

/** RSS-backed source: team-level news for a single team. */
export const rssInjurySource: InjurySource = {
  name: "afl-rss",
  async getTeamNews(team: string): Promise<InjuryNews[]> {
    let items: NewsItem[] = [];
    try {
      items = await fetchNewsItems();
    } catch {
      return [];
    }
    const news: InjuryNews[] = [];
    for (const item of items) {
      const text = `${item.title} ${item.summary}`;
      if (!text.toLowerCase().includes(team.toLowerCase())) continue;
      const status = inferStatus(text);
      if (status === "unknown") continue;
      news.push({
        playerName: "",
        team,
        status,
        note: item.title,
        source: "RSS",
        updatedAt: item.published ?? undefined,
      });
    }
    return news;
  },
};

/** Empty adapter: always returns no news. */
export const noopInjurySource: InjurySource = {
  name: "none",
  async getTeamNews() {
    return [];
  },
};

/**
 * The active source, chosen at CALL time — never at import time, so this module
 * can be imported without eagerly validating env (see lib/env.ts lazy rule).
 * Falls back to the no-op when no feeds are configured.
 */
export function activeInjurySource(): InjurySource {
  return feedUrls().length > 0 ? rssInjurySource : noopInjurySource;
}

export async function getTeamNews(team: string): Promise<InjuryNews[]> {
  return activeInjurySource().getTeamNews(team);
}
