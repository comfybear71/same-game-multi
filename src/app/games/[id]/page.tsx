import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";

import { CollapsibleSection } from "@/components/CollapsibleSection";
import { GeneratePredictionsButton } from "@/components/GeneratePredictionsButton";
import { MatchBriefingCard } from "@/components/MatchBriefingCard";
import { GameLineupPanel } from "@/components/RoundRosterPanel";
import { LiveBetTracker } from "@/components/LiveBetTracker";
import { LiveScoreboard } from "@/components/LiveScoreboard";
import { StatBoardView } from "@/components/StatBoardView";
import { SuggestedMultis } from "@/components/SuggestedMultis";
import { SystemBookPanel } from "@/components/SystemBookPanel";
import { TeamFormAndRanks, teamNameClass } from "@/components/TeamFormAndRanks";
import type { StatType } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  getPlayerBettingRecord,
  getUserBetTracker,
  indexPlayerHistoryByName,
  userIdForEmail,
  type BetTrackerLeg,
  type PlayerBetRecord,
  type PlayerHistorySummary,
} from "@/lib/data/bets";
import { canonicalTeam } from "@/lib/afl/teams";
import { getGameById, getRecentTeamForm, type FormResult } from "@/lib/data/games";
import { getMatchBriefing } from "@/lib/data/matchBriefing";
import { getStatBoard, type StatBoard } from "@/lib/data/statboard";
import { getGameLineupRoster, type RoundLineupPlayer } from "@/lib/data/roundRoster";
import { getTeamRankings } from "@/lib/data/teamStats";
import { STAT_TYPES } from "@/lib/predictions/features";
import {
  fixtureStatWins,
  fixtureTeamRanking,
  type TeamRanking,
} from "@/lib/predictions/teamMatchup";
import { formatAwst } from "@/lib/time";
import { resolveLiveGameState, type LiveGameState } from "@/lib/ingest/squiggle";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: { params: { id: string } }) {
  // Soft nav from Fixtures can otherwise reuse a stale RSC payload (notes /
  // briefing missing until a hard refresh).
  noStore();

  const id = Number(params.id);
  if (Number.isNaN(id)) notFound();

  let game = null;
  let board: StatBoard | null = null;
  let lineupPlayers: RoundLineupPlayer[] = [];
  let lineupPhase: RoundLineupPlayer["phase"] = "upcoming";
  try {
    game = await getGameById(id);
    if (game) {
      const [boardResult, lineupResult] = await Promise.all([
        getStatBoard(id, game.home, game.away),
        getGameLineupRoster(id),
      ]);
      board = boardResult;
      lineupPlayers = lineupResult.players;
      if (lineupResult.players[0]) lineupPhase = lineupResult.players[0].phase;
      else if (game.status === "complete") lineupPhase = "played";
      else if (game.commenceTime <= new Date()) lineupPhase = "live";
    }
  } catch {
    game = game ?? null;
  }
  if (!game) notFound();

  let myLegs: BetTrackerLeg[] = [];
  let playerRecord: Record<string, PlayerBetRecord> = {};
  let playerHistory: Record<string, PlayerHistorySummary> = {};
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (email) {
      const userId = await userIdForEmail(email);
      if (userId) {
        myLegs = await getUserBetTracker(userId, game.id, game.round);
        const recordIndex = await getPlayerBettingRecord(userId);
        playerRecord = recordIndex.byKey;
        playerHistory = indexPlayerHistoryByName(recordIndex.list);
      }
    }
  } catch {
    myLegs = [];
  }

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
    // team stats are best-effort
  }
  const hasTeamStats = !!(homeRanking || awayRanking || homeForm || awayForm);

  let matchBriefing = null;
  try {
    matchBriefing = await getMatchBriefing(game.home, game.away, game.season);
  } catch {
    matchBriefing = {
      homeLadder: null,
      awayLadder: null,
      homeForm: [],
      awayForm: [],
      h2h: [],
      h2hSummary: null,
      weatherHint:
        "Rain or wind at kickoff often pushes disposal totals down — check the forecast before you finalise lines.",
    };
  }

  const hasData = board ? STAT_TYPES.some((s) => board!.byStat[s].length > 0) : false;
  const upcoming = game.commenceTime.getTime() > Date.now();
  const kickedOff = !upcoming && game.status !== "complete";
  const lineupNamed = lineupPlayers.filter((p) => p.lineupStatus !== "emergency").length;
  const lineupEmg = lineupPlayers.length - lineupNamed;
  const lineupTitle =
    lineupPlayers.length === 0
      ? "Lineup"
      : `Lineup (${lineupNamed} selected${lineupEmg > 0 ? ` · ${lineupEmg} emg` : ""})`;
  const lineupDescription =
    lineupPlayers.length === 0
      ? "Upload the team sheet on Fixtures before generating predictions."
      : `Named squad · ${lineupPhase}${game.round != null ? ` · Round ${game.round}` : ""}`;

  let initialLive: LiveGameState | null = null;
  if (kickedOff && game.season != null && game.round != null) {
    try {
      const resolved = await resolveLiveGameState(
        game.season,
        game.round,
        game.squiggleId,
        game.home,
        game.away,
      );
      if (resolved && resolved.status !== "scheduled") {
        initialLive = {
          status: resolved.status,
          timestr: resolved.timestr,
          homeScore: resolved.homeScore,
          awayScore: resolved.awayScore,
          complete: resolved.complete,
        };
      }
    } catch {
      /* client poll will retry */
    }
  }

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

      {matchBriefing ? (
        <CollapsibleSection
          key={`briefing-${game.id}`}
          resetKey={game.id}
          title="Match briefing"
          description="Preview notes, ladder, form and head-to-head."
          defaultOpen
        >
          <MatchBriefingCard
            gameId={game.id}
            home={game.home}
            away={game.away}
            venue={game.venue}
            commenceTime={game.commenceTime}
            briefing={matchBriefing}
            matchNotes={game.matchNotes}
            embedded
          />
        </CollapsibleSection>
      ) : null}

      {hasTeamStats ? (
        <CollapsibleSection
          key={`form-${game.id}`}
          resetKey={game.id}
          title="Last 5 & league ranking"
          description="Recent form and which side ranks higher by key stats."
          defaultOpen
        >
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
        </CollapsibleSection>
      ) : null}

      <LiveScoreboard
        gameId={game.id}
        home={game.home}
        away={game.away}
        homeScore={game.homeScore}
        awayScore={game.awayScore}
        gameStatus={game.status}
        initialLive={initialLive}
        kickedOff={kickedOff}
      />

      <CollapsibleSection title={lineupTitle} description={lineupDescription}>
        <GameLineupPanel
          gameId={game.id}
          home={game.home}
          away={game.away}
          phase={lineupPhase}
          players={lineupPlayers}
          round={game.round}
          playerHistory={playerHistory}
          embedded
        />
      </CollapsibleSection>

      {myLegs.length > 0 ? (
        <CollapsibleSection
          title="Your bets in this game"
          description="Live +/− tracking and Game over settle."
          defaultOpen
        >
          <LiveBetTracker legs={myLegs} gameId={game.id} embedded />
        </CollapsibleSection>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          AFL Tables form — season average, last game, fantasy and projections.
        </p>
        <GeneratePredictionsButton gameId={game.id} />
      </div>

      {/* System book is independent of predictions — saved stake/odds must
          still show on cold start even if the board was cleared. */}
      <CollapsibleSection
        title="System book"
        description="Helm portfolio — place 100%, nudge lines to Sportsbet, log stake + odds."
        defaultOpen
      >
        <SystemBookPanel gameId={game.id} embedded />
      </CollapsibleSection>

      {hasData && board ? (
        <>
          <CollapsibleSection
            title="Suggested multi"
            description="Build a personal ticket across markets — not the System book."
          >
            <SuggestedMultis gameId={game.id} round={game.round} embedded />
          </CollapsibleSection>
          <CollapsibleSection
            title="Player boards"
            description="Per-stat projections, form and fantasy for the named squad."
          >
            <StatBoardView board={board} record={playerRecord} />
          </CollapsibleSection>
        </>
      ) : (
        <div className="card text-sm text-slate-400">
          {upcoming ? (
            <>
              <p className="text-slate-300">No predictions yet for this game.</p>
              <ol className="mt-2 list-inside list-decimal space-y-1">
                {lineupPlayers.length === 0 ? (
                  <li>
                    Upload the lineup on the{" "}
                    <Link href="/" className="text-accent hover:underline">
                      fixtures
                    </Link>{" "}
                    page (AFL team sheet screenshot).
                  </li>
                ) : (
                  <li>Lineup uploaded ({lineupPlayers.length} players).</li>
                )}
                <li>
                  Tap{" "}
                  <span className="font-medium text-slate-200">
                    &ldquo;Generate predictions&rdquo;
                  </span>{" "}
                  above — pulls stats from AFL Tables for everyone in the lineup.
                  System book stakes above stay put either way.
                </li>
              </ol>
            </>
          ) : (
            <p>
              No predictions were generated for this game. Upload a lineup and run
              Generate predictions before kickoff.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
