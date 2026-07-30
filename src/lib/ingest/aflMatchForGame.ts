/**
 * Resolve AFL Match Centre fixture id (CD_M…) for one of our games.
 */

import { canonicalTeam } from "@/lib/afl/teams";
import {
  fetchAflRoundMatches,
  findAflCompSeasonId,
  findAflRoundProviderId,
  getAflMediaToken,
  resolveAflMatchId,
} from "@/lib/ingest/aflMatchCentre";

export async function resolveAflMatchIdForGame(game: {
  season: number | null;
  round: number | null;
  home: string;
  away: string;
}): Promise<string | null> {
  if (game.season == null || game.round == null) return null;
  const token = await getAflMediaToken();
  if (!token) return null;
  const compSeasonId = await findAflCompSeasonId(game.season);
  if (!compSeasonId) return null;
  const roundProviderId = await findAflRoundProviderId(compSeasonId, game.round);
  if (!roundProviderId) return null;
  const matches = await fetchAflRoundMatches(roundProviderId, token);
  const hit = resolveAflMatchId(matches, game.home, game.away);
  return hit?.aflMatchId ?? null;
}

export function canonicalPair(home: string, away: string): { home: string; away: string } {
  return {
    home: canonicalTeam(home) ?? home,
    away: canonicalTeam(away) ?? away,
  };
}
