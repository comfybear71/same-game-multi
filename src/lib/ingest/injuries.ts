// ─────────────────────────────────────────────────────────────────────────────
// Injury / team-news adapter — STUB for v1.
//
// Defines the interface the rest of the app codes against, plus an empty
// adapter that returns no news. Wire a real RSS/scrape source later without
// touching call sites. The UI shows "—" when `status` is "unknown".
// ─────────────────────────────────────────────────────────────────────────────

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

/** Empty adapter: always returns no news. Replace when a source is wired. */
export const noopInjurySource: InjurySource = {
  name: "none",
  async getTeamNews() {
    return [];
  },
};

/** The active source. Swap this for a real adapter later. */
export const injurySource: InjurySource = noopInjurySource;

export async function getTeamNews(team: string): Promise<InjuryNews[]> {
  return injurySource.getTeamNews(team);
}
