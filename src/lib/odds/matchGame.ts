import { canonicalTeam } from "@/lib/afl/teams";

export type GameRow = {
  id: number;
  home: string;
  away: string;
  commenceTime: Date;
  oddsApiId: string | null;
};

const MS_36H = 36 * 60 * 60 * 1000;

/** Match Odds API event to our games row (oddsApiId, else teams + commence ±36h). */
export function matchGameToEvent(
  games: GameRow[],
  event: {
    id: string;
    homeTeam: string;
    awayTeam: string;
    commenceTime: string;
  },
): GameRow | null {
  const byId = games.find((g) => g.oddsApiId === event.id);
  if (byId) return byId;

  const home = canonicalTeam(event.homeTeam) ?? event.homeTeam.trim();
  const away = canonicalTeam(event.awayTeam) ?? event.awayTeam.trim();
  const commence = new Date(event.commenceTime).getTime();
  if (!Number.isFinite(commence)) return null;

  const candidates = games.filter((g) => {
    const gh = canonicalTeam(g.home) ?? g.home;
    const ga = canonicalTeam(g.away) ?? g.away;
    const sameOrientation =
      gh.toLowerCase() === home.toLowerCase() &&
      ga.toLowerCase() === away.toLowerCase();
    const swapped =
      gh.toLowerCase() === away.toLowerCase() &&
      ga.toLowerCase() === home.toLowerCase();
    if (!sameOrientation && !swapped) return false;
    return Math.abs(g.commenceTime.getTime() - commence) <= MS_36H;
  });

  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      Math.abs(a.commenceTime.getTime() - commence) -
      Math.abs(b.commenceTime.getTime() - commence),
  );
  return candidates[0] ?? null;
}
