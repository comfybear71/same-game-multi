import { formatInTimeZone, toZonedTime } from "date-fns-tz";

// The app is operated from Perth. All display times are AWST (UTC+8, no DST).
export const AWST = "Australia/Perth";

/** Format a UTC date for display in AWST, e.g. "Sat 14 Jun, 5:40 PM AWST". */
export function formatAwst(date: Date | string, pattern = "EEE d MMM, h:mm a"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return `${formatInTimeZone(d, AWST, pattern)} AWST`;
}

/** Short date-only label in AWST, e.g. "Sat 14 Jun". */
export function formatAwstDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, AWST, "EEE d MMM");
}

/** The AWST-local Date for a given instant (handy for "morning after" logic). */
export function toAwst(date: Date | string): Date {
  const d = typeof date === "string" ? new Date(date) : date;
  return toZonedTime(d, AWST);
}

/** True if the game's commence time is in the future. */
export function isUpcoming(commenceTime: Date | string): boolean {
  const d =
    typeof commenceTime === "string" ? new Date(commenceTime) : commenceTime;
  return d.getTime() > Date.now();
}
