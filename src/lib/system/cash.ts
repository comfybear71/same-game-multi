/** Cash return from stake × bookie odds when the slip hits. */
export function computeCashReturn(
  slipHit: boolean | null,
  stake: number | null,
  placedOdds: number | null,
): number {
  if (
    slipHit === true &&
    stake != null &&
    stake > 0 &&
    placedOdds != null &&
    placedOdds > 0
  ) {
    return stake * placedOdds;
  }
  return 0;
}
