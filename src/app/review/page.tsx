import { auth } from "@/lib/auth";
import { getLeaderboard, type Leaderboard } from "@/lib/data/accuracy";
import { getBetsForUser, summarise, userIdForEmail } from "@/lib/data/bets";
import { currentSeason } from "@/lib/cron";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const season = currentSeason();
  const session = await auth();

  let board: Leaderboard | null = null;
  let roi: string = "—";
  let strike: string = "—";
  let dbError: string | null = null;

  try {
    board = await getLeaderboard(season);
    const email = session?.user?.email;
    if (email) {
      const userId = await userIdForEmail(email);
      if (userId) {
        const summary = summarise(await getBetsForUser(userId));
        roi = summary.roi == null ? "—" : `${(summary.roi * 100).toFixed(0)}%`;
        const settled = summary.won + summary.lost;
        strike = settled === 0 ? "—" : `${Math.round((summary.won / settled) * 100)}%`;
      }
    }
  } catch (err) {
    dbError = (err as Error).message;
  }

  const hasData = board?.overall.some((o) => o.samples > 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Review &amp; forecasting</h1>
        <p className="text-sm text-slate-400">
          Season {season} · model accuracy and bet performance.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Best model" value={board?.bestModel ? `Model ${board.bestModel}` : "—"} />
        <Stat label="ROI" value={roi} />
        <Stat label="Strike rate" value={strike} />
      </section>

      {dbError ? (
        <div className="card border-accent-loss/40 text-sm text-slate-400">
          Couldn&apos;t load review data: {dbError}
        </div>
      ) : null}

      <section className="card">
        <h2 className="mb-3 text-lg font-semibold text-white">Model leaderboard</h2>
        {hasData ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-1 pr-4 font-medium">Model</th>
                  <th className="py-1 pr-4 font-medium">Avg MAE</th>
                  <th className="py-1 pr-4 font-medium">Line accuracy</th>
                  <th className="py-1 pr-4 font-medium">Samples</th>
                </tr>
              </thead>
              <tbody>
                {board!.overall.map((o) => (
                  <tr
                    key={o.model}
                    className={`border-t border-surface-border ${
                      o.model === board!.bestModel ? "text-accent" : "text-slate-300"
                    }`}
                  >
                    <td className="py-1.5 pr-4 font-semibold">Model {o.model}</td>
                    <td className="py-1.5 pr-4">{o.avgMae == null ? "—" : o.avgMae.toFixed(2)}</td>
                    <td className="py-1.5 pr-4">
                      {o.avgLineAccuracy == null
                        ? "—"
                        : `${(o.avgLineAccuracy * 100).toFixed(0)}%`}
                    </td>
                    <td className="py-1.5 pr-4">{o.samples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            No settled predictions yet. After a round completes, the morning-after
            cron records actuals and scores each model by mean absolute error and
            line-call accuracy per stat. The most accurate model is highlighted to
            guide the next week.
          </p>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-bold text-white">{value}</div>
    </div>
  );
}
