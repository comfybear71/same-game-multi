/** Cash return from stake × bookie odds when the slip hits; stake back if voided. */
export function computeCashReturn(
  slipHit: boolean | null,
  stake: number | null,
  placedOdds: number | null,
  voided = false,
): number {
  if (voided && stake != null && stake > 0) {
    return stake;
  }
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
