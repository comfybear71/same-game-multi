import { cached } from "@/lib/ingest/cache";

const BASE = "https://afltables.com/afl";

export interface SeasonPlayerRef {
  /** Display / match name, e.g. "Rory Laird". */
  name: string;
  /** AFL Tables file slug, e.g. "Rory_Laird" or "Will_Hamill1". */
  slug: string;
}

/** "Laird, Rory" / "OBrien, Reilly" → "Rory Laird" / "Reilly OBrien". */
export function aflTablesListNameToFull(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length < 3) return null;
  if (/total/i.test(cleaned)) return null;
  const comma = cleaned.indexOf(",");
  if (comma <= 0) {
    return cleaned.includes(" ") ? cleaned : null;
  }
  const last = cleaned.slice(0, comma).trim();
  const first = cleaned.slice(comma + 1).trim();
  if (!first || !last) return null;
  return `${first} ${last}`;
}

function slugFromHref(href: string): string | null {
  const m = href.match(/players\/[A-Za-z0-9]\/([^/"']+)\.html/i);
  return m?.[1] ?? null;
}

/**
 * Player names + slugs from AFL Tables' season stats page — seeds the
 * walk-forward roster pool for historical backtests.
 */
export async function listSeasonPlayers(year: number): Promise<SeasonPlayerRef[]> {
  const url = `${BASE}/stats/${year}.html`;
  const html = await cached<string>(`afltables:season:v3:${year}`, 24 * 60 * 60, async () => {
    const res = await fetch(url, {
      headers: { "User-Agent": "AFLMultiTracker/1.0 (backtest)" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`AFL Tables season ${year} -> ${res.status}`);
    return res.text();
  });

  const bySlug = new Map<string, SeasonPlayerRef>();
  // Relative: href="players/R/Rory_Laird.html">Laird, Rory</a>
  const re = /href="((?:\.\.\/)*(?:afl\/stats\/)?players\/[^"]+\.html)"[^>]*>([^<]{3,60})</gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const slug = slugFromHref(m[1]!);
    const name = aflTablesListNameToFull(m[2]!);
    if (!slug || !name) continue;
    bySlug.set(slug, { name, slug });
  }

  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** @deprecated Prefer listSeasonPlayers (includes slugs). */
export async function listSeasonPlayerNames(year: number): Promise<string[]> {
  return (await listSeasonPlayers(year)).map((p) => p.name);
}
