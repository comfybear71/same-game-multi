import { cached } from "@/lib/ingest/cache";

const BASE = "https://afltables.com/afl";

/**
 * Player names listed on AFL Tables' season stats page — used to seed the
 * walk-forward roster pool for historical backtests.
 */
export async function listSeasonPlayerNames(year: number): Promise<string[]> {
  const url = `${BASE}/stats/${year}.html`;
  const html = await cached<string>(`afltables:season:${year}`, 24 * 60 * 60, async () => {
    const res = await fetch(url, {
      headers: { "User-Agent": "AFLMultiTracker/1.0 (backtest)" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`AFL Tables season ${year} -> ${res.status}`);
    return res.text();
  });

  const names = new Set<string>();
  // Links like .../players/M/Marcus_Bontempelli.html">Marcus Bontempelli</a>
  const re =
    /\/afl\/stats\/players\/[A-Z0-9]\/[^"]+\.html"[^>]*>([A-Za-z][A-Za-z .'\-]+)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const name = m[1]!.replace(/\s+/g, " ").trim();
    if (name.length >= 4 && !name.includes("Total")) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
