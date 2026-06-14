import { GameCard } from "@/components/GameCard";
import { SyncButton } from "@/components/SyncButton";
import type { Game } from "@/db/schema";
import { getNextGame, getRecentResults, getUpcomingGames } from "@/lib/data/games";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let nextGame: Game | null = null;
  let upcoming: Game[] = [];
  let results: Game[] = [];
  let dbError: string | null = null;

  try {
    [nextGame, upcoming, results] = await Promise.all([
      getNextGame(),
      getUpcomingGames(),
      getRecentResults(),
    ]);
  } catch (err) {
    dbError = (err as Error).message;
  }

  const restUpcoming = upcoming.filter((g) => g.id !== nextGame?.id);

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

      {nextGame ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">
            Next game
          </h2>
          <GameCard game={nextGame} featured />
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
              <GameCard key={g.id} game={g} />
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
