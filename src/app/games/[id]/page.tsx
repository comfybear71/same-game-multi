import Link from "next/link";
import { notFound } from "next/navigation";

import { GeneratePredictionsButton } from "@/components/GeneratePredictionsButton";
import { StatBoardView } from "@/components/StatBoardView";
import { getGameById } from "@/lib/data/games";
import { getStatBoard, type StatBoard } from "@/lib/data/statboard";
import { STAT_TYPES } from "@/lib/predictions/features";
import { formatAwst } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (Number.isNaN(id)) notFound();

  let game = null;
  let board: StatBoard | null = null;
  try {
    game = await getGameById(id);
    if (game) board = await getStatBoard(id, game.home, game.away);
  } catch {
    game = game ?? null;
  }
  if (!game) notFound();

  const hasData = board ? STAT_TYPES.some((s) => board!.byStat[s].length > 0) : false;
  const upcoming = game.commenceTime.getTime() > Date.now();

  return (
    <div className="space-y-5">
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Recent form, season average and our prediction vs the bookie line.
        </p>
        <GeneratePredictionsButton gameId={game.id} />
      </div>

      {hasData && board ? (
        <StatBoardView board={board} />
      ) : (
        <div className="card text-sm text-slate-400">
          {upcoming ? (
            <>
              <p className="text-slate-300">No player lines yet for this game.</p>
              <p className="mt-1">
                Bookmakers usually post player props about a day or two before the
                game. Check back closer to kickoff, then tap{" "}
                <span className="font-medium text-slate-200">
                  &ldquo;Fetch props &amp; predict&rdquo;
                </span>
                .
              </p>
            </>
          ) : (
            <p>
              No predictions were generated for this game (player props weren&apos;t
              available).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
