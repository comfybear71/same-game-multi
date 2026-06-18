import type { StatType } from "@/db/schema";
import { env } from "@/lib/env";

// Read a bookmaker "Resulted" / settled same-game-multi screenshot with Claude
// vision. Unlike the placement slip (readBetSlip.ts), this screen shows each
// leg's ACTUAL value (the green pill) and whether it won or lost, so we can
// settle the slip straight from the image instead of waiting on AFL Tables.
// Uses the Anthropic Messages API directly (no SDK dependency).

const MODEL = "claude-haiku-4-5-20251001";
const API_URL = "https://api.anthropic.com/v1/messages";

const ALLOWED_MEDIA = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const STAT_TYPES: StatType[] = ["disposals", "marks", "tackles", "goals"];

export interface ExtractedResultLeg {
  player: string;
  statType: StatType | null;
  line: number | null;
  actual: number | null; // the value the player actually got (green pill)
  outcome: "won" | "lost" | null;
}

export interface ExtractedResult {
  betId: string | null; // bookmaker bet id, if shown (helps confirm the slip)
  totalOdds: number | null;
  totalStake: number | null;
  legCount: number | null;
  legs: ExtractedResultLeg[];
}

const PROMPT = `You are reading a screenshot of a SETTLED AFL (Australian Football League) same-game multi from a bookmaker's "Resulted" screen (e.g. Sportsbet, TAB, Ladbrokes). Each leg shows the market (e.g. "22+ Disposals"), the player, and a coloured pill with the actual number the player achieved, plus a tick (won) or cross (lost).

Extract it into JSON. Respond with ONLY a JSON object — no prose, no code fences — matching exactly:
{"betId": string|null, "totalOdds": number|null, "totalStake": number|null, "legCount": number|null, "legs": [{"player": string, "statType": "disposals"|"marks"|"tackles"|"goals"|null, "line": number|null, "actual": number|null, "outcome": "won"|"lost"|null}]}

Rules:
- One entry in "legs" per player selection. A player may appear in several legs (different markets) — list each separately.
- "player" is the player's full name as shown.
- "statType": map the market to one of disposals, marks, tackles, goals. If it's a different market, use null.
- "line": the numeric threshold. For an "N+" market (e.g. "22+ Disposals"), use N minus 0.5 (so 22+ -> 21.5).
- "actual": the actual value the player got — the number in the coloured pill next to the leg. If not visible, null.
- "outcome": "won" if the leg shows a tick / is green / marked won, "lost" if it shows a cross / is red / marked lost, else null.
- "betId": the bookmaker's bet / receipt id if shown (e.g. "O/1000025035/0000044/D"), else null.
- "totalOdds"/"totalStake": the multi's combined odds and the stake if shown, else null.
- "legCount": the total number of legs in the multi if stated (e.g. "14 Legs"), else null.
Numbers must be plain numbers (no "$", "+", "x", or "@").`;

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object in model response");
  }
  return text.slice(start, end + 1);
}

export async function readBetResult(imageUrl: string): Promise<ExtractedResult> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    throw new Error(`could not fetch image: ${imgRes.status}`);
  }
  const ct = (imgRes.headers.get("content-type") || "image/png").split(";")[0];
  const mediaType = ALLOWED_MEDIA.has(ct) ? ct : "image/png";
  const base64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = json.content?.find((c) => c.type === "text")?.text ?? "";
  const parsed = JSON.parse(extractJson(text)) as ExtractedResult;

  return {
    betId: typeof parsed.betId === "string" ? parsed.betId.trim() || null : null,
    totalOdds: typeof parsed.totalOdds === "number" ? parsed.totalOdds : null,
    totalStake: typeof parsed.totalStake === "number" ? parsed.totalStake : null,
    legCount: typeof parsed.legCount === "number" ? parsed.legCount : null,
    legs: Array.isArray(parsed.legs)
      ? parsed.legs.map((l) => ({
          player: String(l.player ?? "").trim(),
          statType: STAT_TYPES.includes(l.statType as StatType)
            ? (l.statType as StatType)
            : null,
          line: typeof l.line === "number" ? l.line : null,
          actual: typeof l.actual === "number" ? l.actual : null,
          outcome: l.outcome === "won" || l.outcome === "lost" ? l.outcome : null,
        }))
      : [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching extracted result legs back onto a slip's stored legs.
//
// A slip is logged at placement (manually or via readBetSlip), so its legs
// already exist in the DB. The result screenshot is matched against them by
// normalised player name + stat type (which is effectively unique per slip),
// disambiguating by nearest line when a player has the same stat twice.
// ─────────────────────────────────────────────────────────────────────────────

export interface StoredLegRef {
  id: number;
  playerName: string | null;
  statType: StatType;
  line: number;
}

export interface ResultMatch {
  legId: number;
  result: "hit" | "miss";
  actualValue: number | null;
}

export interface MatchOutcome {
  matches: ResultMatch[];
  unmatchedStored: StoredLegRef[]; // stored legs not found in the screenshot
  unmatchedExtracted: ExtractedResultLeg[]; // screenshot legs not mapped to a leg
}

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Settled result for one leg: prefer the actual number, fall back to the tick. */
function legResult(
  line: number,
  actual: number | null,
  outcome: "won" | "lost" | null,
): { result: "hit" | "miss"; actualValue: number | null } | null {
  if (actual != null) return { result: actual > line ? "hit" : "miss", actualValue: actual };
  if (outcome) return { result: outcome === "won" ? "hit" : "miss", actualValue: null };
  return null;
}

export function matchResultLegs(
  extracted: ExtractedResultLeg[],
  stored: StoredLegRef[],
): MatchOutcome {
  const usedExtracted = new Set<number>();
  const matches: ResultMatch[] = [];
  const unmatchedStored: StoredLegRef[] = [];

  for (const leg of stored) {
    const key = leg.playerName ? normaliseName(leg.playerName) : "";
    const candidates = extracted
      .map((e, idx) => ({ e, idx }))
      .filter(
        ({ e, idx }) =>
          !usedExtracted.has(idx) &&
          e.statType === leg.statType &&
          normaliseName(e.player) === key,
      )
      .sort(
        (a, b) =>
          Math.abs((a.e.line ?? leg.line) - leg.line) -
          Math.abs((b.e.line ?? leg.line) - leg.line),
      );

    const best = candidates[0];
    if (!best) {
      unmatchedStored.push(leg);
      continue;
    }
    const settled = legResult(leg.line, best.e.actual, best.e.outcome);
    if (!settled) {
      unmatchedStored.push(leg);
      continue;
    }
    usedExtracted.add(best.idx);
    matches.push({ legId: leg.id, result: settled.result, actualValue: settled.actualValue });
  }

  const unmatchedExtracted = extracted.filter((_, idx) => !usedExtracted.has(idx));
  return { matches, unmatchedStored, unmatchedExtracted };
}
