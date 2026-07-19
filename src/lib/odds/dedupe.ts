/** Exact-repeat key for a harvest row within a single run. */
export type SnapshotDedupeInput = {
  oddsApiEventId: string;
  playerName: string;
  marketKey: string;
  line: number;
  bookmaker: string;
  overOdds: number | null;
  underOdds: number | null;
};

export function snapshotDedupeKey(row: SnapshotDedupeInput): string {
  const over = row.overOdds == null ? "" : String(row.overOdds);
  const under = row.underOdds == null ? "" : String(row.underOdds);
  return [
    row.oddsApiEventId,
    row.playerName.toLowerCase().trim(),
    row.marketKey,
    String(row.line),
    row.bookmaker.toLowerCase(),
    over,
    under,
  ].join("|");
}

/** Returns rows with exact duplicates removed (first wins). */
export function dedupeSnapshots<T extends SnapshotDedupeInput>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const k = snapshotDedupeKey(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}
