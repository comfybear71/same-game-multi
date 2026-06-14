import Link from "next/link";
import { notFound } from "next/navigation";

import { PredictedVsAverageChart } from "@/components/charts/PredictedVsAverageChart";
import { GeneratePredictionsButton } from "@/components/GeneratePredictionsButton";
import { PredictionsTable } from "@/components/PredictionsTable";
import { getGamePredictions, type PlayerPredictionRow } from "@/lib/data/predictions";
import { getGameById } from "@/lib/data/games";
import { STAT_TYPES } from "@/lib/predictions/features";
import { formatAwst } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (Number.isNaN(id)) notFound();

  let game = null;
  let rows: PlayerPredictionRow[] = [];
  try {
    game = await getGameById(id);
    if (game) rows = await getGamePredictions(id);
  } catch {
    game = game ?? null;
  }
  if (!game) notFound();

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-accent hover:underline">
        ← Back to fixtures
      </Link>

      <header className="card">
        <div className="text-xs uppercase tracking-wide text-slate-400">
          {game.round ? `Round ${game.round}` : "Fixture"}
          {game.venue ? ` · ${game.venue}` : ""}
        </div>
        <h1 className="mt-1 text-2xl font-bold text-white">
          {game.home} <span className="text-slate-500">vs</span> {game.away}
        </h1>
        <p className="mt-1 text-sm text-slate-400">{formatAwst(game.commenceTime)}</p>
      </header>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Predictions</h2>
            <p className="text-sm text-slate-400">
              Models A (season avg), B (form-weighted), C (smart: form × opponent
              × venue, from AFL Tables history). Edge = Model C minus the
              bookmaker line.
            </p>
          </div>
          <GeneratePredictionsButton gameId={game.id} />
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">
            No predictions yet. Hit &ldquo;Fetch props &amp; predict&rdquo; to pull
            The Odds API player lines and run the models. (Requires{" "}
            <code>ODDS_API_KEY</code>.)
          </p>
        ) : null}
      </section>

      {rows.length > 0 ? (
        <>
          <section className="card">
            <h3 className="mb-1 font-semibold text-white">{rows[0].playerName}</h3>
            <p className="mb-3 text-xs text-slate-400">
              Model predictions vs bookmaker line.
            </p>
            <PredictedVsAverageChart data={chartData(rows[0])} />
          </section>
          <PredictionsTable rows={rows} />
        </>
      ) : null}
    </div>
  );
}

function chartData(row: PlayerPredictionRow) {
  return STAT_TYPES.map((stat) => ({
    stat,
    line: row.stats[stat].line,
    A: row.stats[stat].models.A,
    B: row.stats[stat].models.B,
    C: row.stats[stat].models.C,
  }));
}
