import Link from "next/link";
import { notFound } from "next/navigation";

import { GeneratePredictionsButton } from "@/components/GeneratePredictionsButton";
import { LiveScoreboard } from "@/components/LiveScoreboard";
import { StatBoardView } from "@/components/StatBoardView";
import { SuggestedMultis } from "@/components/SuggestedMultis";
import { auth } from "@/lib/auth";
import {
  getUserBetTracker,
  userIdForEmail,
  type BetTrackerLeg,
} from "@/lib/data/bets";
import { teamColors } from "@/lib/afl/teamColors";
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

  // The signed-in user's own legs on this game (for the live "your bets" panel).
  let myLegs: BetTrackerLeg[] = [];
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (email) {
      const userId = await userIdForEmail(email);
      if (userId) myLegs = await getUserBetTracker(userId, game.id);
    }
  } catch {
    myLegs = [];
  }

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

      <LiveScoreboard gameId={game.id} home={game.home} away={game.away} />

      {myLegs.length > 0 ? <MyLegsPanel legs={myLegs} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Recent form, season average and our prediction vs the bookie line.
        </p>
        <GeneratePredictionsButton gameId={game.id} />
      </div>

      {hasData && board ? (
        <>
          <SuggestedMultis gameId={game.id} />
          <StatBoardView board={board} />
        </>
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

function MyLegsPanel({ legs }: { legs: BetTrackerLeg[] }) {
  const resultClass: Record<string, string> = {
    hit: "text-accent-win",
    miss: "text-accent-loss",
    pending: "text-slate-400",
    void: "text-slate-500",
  };
  const resultLabel: Record<string, string> = {
    hit: "✓ hit",
    miss: "✗ miss",
    pending: "live",
    void: "void",
  };
  return (
    <section className="card border-accent/40">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-accent">
        Your bets in this game
      </h2>
      <ul className="mt-3 space-y-2">
        {legs.map((leg, i) => {
          const c = teamColors(leg.team ?? "");
          return (
            <li key={i} className="flex items-center gap-3">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs font-bold"
                style={{ background: c.bg, color: c.fg }}
              >
                {leg.jumper ?? "–"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">
                  {leg.playerName ?? "Player"}
                </div>
                <div className="text-xs text-slate-400">
                  <span className="capitalize">{leg.statType}</span> over {leg.line}
                  {leg.prediction != null
                    ? ` · we predict ${leg.prediction.toFixed(1)}`
                    : ""}
                </div>
              </div>
              <span className={`text-sm font-semibold ${resultClass[leg.result] ?? "text-slate-400"}`}>
                {resultLabel[leg.result] ?? leg.result}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        Live running counts aren&apos;t available, but each leg ticks to ✓ or ✗
        automatically once the game&apos;s player stats are published.
      </p>
    </section>
  );
}
