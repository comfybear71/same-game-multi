import { CollapsibleSection } from "@/components/CollapsibleSection";
import { CrystalBallPanel } from "@/components/CrystalBallPanel";
import { PlayerRecordPanel } from "@/components/PlayerRecordPanel";
import { RoundRosterPanel } from "@/components/RoundRosterPanel";
import { auth } from "@/lib/auth";
import { getLeaderboard, type Leaderboard } from "@/lib/data/accuracy";
import {
  analyseMultis,
  getBetsForUser,
  getPlayerBettingRecord,
  indexPlayerHistoryByName,
  summarise,
  userIdForEmail,
  type MultiAnalytics,
  type PlayerBetRecord,
  type PlayerHistorySummary,
} from "@/lib/data/bets";
import {
  buildCrystalBallReport,
  latestCompletedRound,
  type CrystalBallReport,
} from "@/lib/data/crystalBall";
import { currentSeason } from "@/lib/cron";
import {
  getRoundRoster,
  inferCurrentRound,
  type RoundRoster,
} from "@/lib/data/roundRoster";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const season = currentSeason();
  const session = await auth();

  let board: Leaderboard | null = null;
  let roi: string = "—";
  let strike: string = "—";
  let playerRecord: PlayerBetRecord[] = [];
  let playerHistory: Record<string, PlayerHistorySummary> = {};
  let multiStats: MultiAnalytics = {
    totalMultis: 0,
    pending: 0,
    won: 0,
    lost: 0,
    totalLegs: 0,
    avgLegs: 0,
    byLegCount: [],
  };
  let dbError: string | null = null;
  let roundRoster: RoundRoster | null = null;
  let crystalBall: CrystalBallReport | null = null;
  let crystalRound: number | null = null;

  try {
    const email = session?.user?.email;

    const [boardResult, roundResult, userId, completedRound] = await Promise.all([
      getLeaderboard(season),
      inferCurrentRound(season),
      email ? userIdForEmail(email) : Promise.resolve(null),
      latestCompletedRound(season),
    ]);
    board = boardResult;
    crystalRound = completedRound;

    const userWork =
      userId != null
        ? Promise.all([
            getBetsForUser(userId),
            getPlayerBettingRecord(userId),
          ])
        : Promise.resolve(null);

    const [roster, userBundle, crystal] = await Promise.all([
      roundResult != null
        ? getRoundRoster(season, roundResult)
        : Promise.resolve(null),
      userWork,
      completedRound != null
        ? buildCrystalBallReport(season, completedRound).catch(() => null)
        : Promise.resolve(null),
    ]);
    roundRoster = roster;
    crystalBall = crystal;

    if (userBundle) {
      const [slips, record] = userBundle;
      const summary = summarise(slips);
      multiStats = analyseMultis(slips);
      roi = summary.roi == null ? "—" : `${(summary.roi * 100).toFixed(0)}%`;
      const settled = summary.won + summary.lost;
      strike =
        settled === 0 ? "—" : `${Math.round((summary.won / settled) * 100)}%`;
      playerRecord = record.list;
      playerHistory = indexPlayerHistoryByName(playerRecord);
    }
  } catch (err) {
    dbError = (err as Error).message;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Review</h1>
        <p className="text-sm text-slate-400">
          Season {season} · round lineups and player record. Multis by ticket
          size live on Bets; helm dollars on System; backtests on Lab.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Best model"
          value={board?.bestModel ? `Model ${board.bestModel}` : "—"}
        />
        <Stat
          label="Multis"
          value={multiStats.totalMultis > 0 ? String(multiStats.totalMultis) : "—"}
        />
        <Stat label="ROI" value={roi} />
        <Stat label="Strike rate" value={strike} />
      </section>

      {dbError ? (
        <div className="card border-accent-loss/40 text-sm text-slate-400">
          Couldn&apos;t load review data: {dbError}
        </div>
      ) : null}

      <CollapsibleSection
        title="Round lineups"
        description="One card per match — expand to see squads. Hit rate on the right if you've backed them before (✗ = last miss or below 50%)."
        defaultOpen
      >
        <RoundRosterPanel roster={roundRoster} playerHistory={playerHistory} />
      </CollapsibleSection>

      <CollapsibleSection
        title="Crystal ball"
        description={
          crystalRound != null
            ? `Round ${crystalRound} — per game: ANY 5 / 10 / 15 leg multis with hindsight. Toggle longest vs shortest odds; ★ = on our System book.`
            : "After a round settles — ANY 5 / 10 / 15 leg crystal-ball multis per game."
        }
        defaultOpen
      >
        {crystalBall ? (
          <CrystalBallPanel report={crystalBall} />
        ) : (
          <p className="text-sm text-slate-500">
            Crystal ball needs a completed round with settled stats
            {crystalRound != null ? ` (Round ${crystalRound})` : ""}.
          </p>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Your player record"
        description="Split by stat — tap a summary card to filter. Most backed players and your strongest markets show up first. Sort the list to find who&apos;s been burning you."
        defaultOpen={false}
      >
        <PlayerRecordPanel records={playerRecord} />
      </CollapsibleSection>
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
