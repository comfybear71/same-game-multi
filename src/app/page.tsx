import { GameCard } from "@/components/GameCard";
import { LiveGameCard } from "@/components/LiveGameCard";
import { SyncButton } from "@/components/SyncButton";
import type { Game } from "@/db/schema";
import {
  getInPlayGames,
  getNextGame,
  getRecentResults,
  getRecentTeamForm,
  getUpcomingGames,
  type FormResult,
} from "@/lib/data/games";
import { getTeamRankings, type TeamRanking } from "@/lib/data/teamStats";
import { getLineupCounts } from "@/lib/ingest/lineup";
import { canonicalTeam } from "@/lib/afl/teams";
import { fixtureStatWins, fixtureTeamRanking } from "@/lib/predictions/teamMatchup";

import type { FixtureForm, FixtureRanks, FixtureWins } from "@/components/GameCard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let nextGame: Game | null = null;
  let upcoming: Game[] = [];
  let results: Game[] = [];
  let inPlay: Game[] = [];
  let teamRankings: Map<string, TeamRanking> = new Map();
  let teamForm: Map<string, FormResult[]> = new Map();
  let dbError: string | null = null;

  try {
    [nextGame, upcoming, results, inPlay, teamRankings, teamForm] =
      await Promise.all([
        getNextGame(),
        getUpcomingGames(),
        getRecentResults(),
        getInPlayGames(),
        getTeamRankings(),
        getRecentTeamForm(),
      ]);
  } catch (err) {
    dbError = (err as Error).message;
  }

  const ranksFor = (g: Game): FixtureRanks => ({
    home: fixtureTeamRanking(teamRankings, g.home),
    away: fixtureTeamRanking(teamRankings, g.away),
  });
  const formFor = (g: Game): FixtureForm => ({
    home: teamForm.get(canonicalTeam(g.home) ?? g.home) ?? null,
    away: teamForm.get(canonicalTeam(g.away) ?? g.away) ?? null,
  });
  const winsFor = (g: Game): FixtureWins => ({
    home: fixtureStatWins(teamRankings, g.home, g.away),
    away: fixtureStatWins(teamRankings, g.away, g.home),
  });
  const restUpcoming = upcoming.filter((g) => g.id !== nextGame?.id);

  // Which upcoming games already have a lineup, so the card shows "uploaded"
  // and neither user re-does the housekeeping. Best-effort — never block render.
  let lineupCounts: Map<number, number> = new Map();
  const upcomingIds = [nextGame?.id, ...restUpcoming.map((g) => g.id)].filter(
    (id): id is number => id != null,
  );
  if (upcomingIds.length > 0) {
    lineupCounts = await getLineupCounts(upcomingIds).catch(() => new Map());
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Fixtures</h1>
          <p className="text-sm text-slate-400">All times shown in AWST (Perth).</p>
        </div>
        <SyncButton />
      </section>

      {dbError ? (
        <div className="card border-accent-loss/40">
          <p className="font-semibold text-accent-loss">Couldn&apos;t reach the database.</p>
          <p className="mt-1 text-sm text-slate-400">
            Set <code>DATABASE_URL</code> and run <code>npm run db:migrate</code>, then
            hit &ldquo;Refresh fixtures&rdquo;. Details: {dbError}
          </p>
        </div>
      ) : null}

      {inPlay.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent-loss">
            In play
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {inPlay.map((g) => (
              <LiveGameCard
                key={g.id}
                gameId={g.id}
                home={g.home}
                away={g.away}
                round={g.round}
                venue={g.venue}
              />
            ))}
          </div>
        </section>
      ) : null}

      {nextGame ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">
            Next game
          </h2>
          <GameCard
            game={nextGame}
            featured
            ranks={ranksFor(nextGame)}
            form={formFor(nextGame)}
            wins={winsFor(nextGame)}
            lineupUpload
            lineupCount={lineupCounts.get(nextGame.id) ?? 0}
          />
        </section>
      ) : !dbError ? (
        <div className="card">
          <p className="text-slate-300">No upcoming games yet.</p>
          <p className="mt-1 text-sm text-slate-400">
            Hit &ldquo;Refresh fixtures&rdquo; to pull the latest round from Squiggle.
          </p>
        </div>
      ) : null}

      {restUpcoming.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Upcoming
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {restUpcoming.map((g) => (
              <GameCard
                key={g.id}
                game={g}
                ranks={ranksFor(g)}
                form={formFor(g)}
                wins={winsFor(g)}
                lineupUpload
                lineupCount={lineupCounts.get(g.id) ?? 0}
              />
            ))}
          </div>
        </section>
      ) : null}

      {results.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Recent results
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
