export type QuotaStatus = {
  remaining: number | null;
  used: number | null;
};

export function parseQuotaHeaders(headers: Headers): QuotaStatus {
  const rem = headers.get("x-requests-remaining");
  const used = headers.get("x-requests-used");
  return {
    remaining: rem != null && rem !== "" ? Number(rem) : null,
    used: used != null && used !== "" ? Number(used) : null,
  };
}

export class QuotaFloorError extends Error {
  readonly remaining: number;
  readonly floor: number;

  constructor(remaining: number, floor: number) {
    super(
      `Odds API quota floor hit: ${remaining} remaining (floor ${floor}). Aborting harvest.`,
    );
    this.name = "QuotaFloorError";
    this.remaining = remaining;
    this.floor = floor;
  }
}

/** Throw if remaining is known and below floor. */
export function assertQuotaFloor(
  status: QuotaStatus,
  floor: number,
): void {
  if (status.remaining == null) return;
  if (Number.isFinite(status.remaining) && status.remaining < floor) {
    throw new QuotaFloorError(status.remaining, floor);
  }
}
