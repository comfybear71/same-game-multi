import Link from "next/link";
import { notFound } from "next/navigation";

import { GeneratePredictionsButton } from "@/components/GeneratePredictionsButton";
import { LiveScoreboard } from "@/components/LiveScoreboard";
import { StatBoardView } from "@/components/StatBoardView";
import { SuggestedMultis } from "@/components/SuggestedMultis";
import { TeamFormAndRanks, teamNameClass } from "@/components/TeamFormAndRanks";
import type { StatType } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  getPlayerBettingRecord,
  getUserBetTracker,
  userIdForEmail,
  type BetTrackerLeg,
  type PlayerBetRecord,
} from "@/lib/data/bets";
import { canonicalTeam } from "@/lib/afl/teams";
import { teamColors } from "@/lib/afl/teamColors";
import { floorStat, targetLabel } from "@/lib/format";
import { getGameById, getRecentTeamForm, type FormResult } from "@/lib/data/games";
import { getStatBoard, type StatBoard } from "@/lib/data/statboard";
import { getTeamRankings } from "@/lib/data/teamStats";
import { STAT_TYPES } from "@/lib/predictions/features";
import {
  fixtureStatWins,
  fixtureTeamRanking,
  type TeamRanking,
} from "@/lib/predictions/teamMatchup";
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

  // The signed-in user's own legs on this game (for the live "your bets" panel)
  // plus their per-player betting record (for the "last time you backed him…"
  // hint on each card).
  let myLegs: BetTrackerLeg[] = [];
  let playerRecord: Record<string, PlayerBetRecord> = {};
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (email) {
      const userId = await userIdForEmail(email);
      if (userId) {
        myLegs = await getUserBetTracker(userId, game.id);
        playerRecord = (await getPlayerBettingRecord(userId)).byKey;
      }
    }
  } catch {
    myLegs = [];
  }

  // Team form + league rankings + matchup edges for the two sides (same data as
  // the fixture cards), shown under the header.
  let homeRanking: TeamRanking | null = null;
  let awayRanking: TeamRanking | null = null;
  let homeForm: FormResult[] | null = null;
  let awayForm: FormResult[] | null = null;
  let homeWins = new Set<StatType>();
  let awayWins = new Set<StatType>();
  try {
    const [rankings, form] = await Promise.all([
      getTeamRankings(),
      getRecentTeamForm(),
    ]);
    homeRanking = fixtureTeamRanking(rankings, game.home);
    awayRanking = fixtureTeamRanking(rankings, game.away);
    homeForm = form.get(canonicalTeam(game.home) ?? game.home) ?? null;
    awayForm = form.get(canonicalTeam(game.away) ?? game.away) ?? null;
    homeWins = fixtureStatWins(rankings, game.home, game.away);
    awayWins = fixtureStatWins(rankings, game.away, game.home);
  } catch {
    // team stats are best-effort; the rest of the page still renders
  }
  const hasTeamStats = !!(homeRanking || awayRanking || homeForm || awayForm);

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

      {hasTeamStats ? (
        <section className="card">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">
            Last 5 &amp; league ranking
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className={`font-semibold ${teamNameClass(homeWins.size)}`}>
                {game.home}
              </div>
              <TeamFormAndRanks form={homeForm} ranking={homeRanking} wins={homeWins} />
            </div>
            <div className="flex-1 text-right">
              <div className={`font-semibold ${teamNameClass(awayWins.size)}`}>
                {game.away}
              </div>
              <TeamFormAndRanks
                form={awayForm}
                ranking={awayRanking}
                wins={awayWins}
                align="right"
              />
            </div>
          </div>
        </section>
      ) : null}

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
          <StatBoardView board={board} record={playerRecord} />
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
                  <span className="capitalize">{leg.statType}</span> {targetLabel(leg.line)}
                  {leg.prediction != null
                    ? ` · we predict ${floorStat(leg.prediction)}`
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
