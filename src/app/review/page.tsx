import { MultiStatsPanel } from "@/components/MultiStatsPanel";
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

  try {
    board = await getLeaderboard(season);
    const currentRound = await inferCurrentRound(season);
    if (currentRound != null) {
      roundRoster = await getRoundRoster(season, currentRound);
    }
    const email = session?.user?.email;
    if (email) {
      const userId = await userIdForEmail(email);
      if (userId) {
        const slips = await getBetsForUser(userId);
        const summary = summarise(slips);
        multiStats = analyseMultis(slips);
        roi = summary.roi == null ? "—" : `${(summary.roi * 100).toFixed(0)}%`;
        const settled = summary.won + summary.lost;
        strike = settled === 0 ? "—" : `${Math.round((summary.won / settled) * 100)}%`;
        playerRecord = (await getPlayerBettingRecord(userId)).list;
        playerHistory = indexPlayerHistoryByName(playerRecord);
      }
    }
  } catch (err) {
    dbError = (err as Error).message;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Review &amp; forecasting</h1>
        <p className="text-sm text-slate-400">
          Season {season} · model accuracy and bet performance.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Best model" value={board?.bestModel ? `Model ${board.bestModel}` : "—"} />
        <Stat label="Multis" value={multiStats.totalMultis > 0 ? String(multiStats.totalMultis) : "—"} />
        <Stat label="ROI" value={roi} />
        <Stat label="Strike rate" value={strike} />
      </section>

      {dbError ? (
        <div className="card border-accent-loss/40 text-sm text-slate-400">
          Couldn&apos;t load review data: {dbError}
        </div>
      ) : null}

      <CollapsibleSection
        title="Your multis"
        description="Slip performance by ticket size — filter chips, compact table."
      >
        <MultiStatsPanel analytics={multiStats} />
      </CollapsibleSection>

      <CollapsibleSection
        title="Round lineups"
        description="One card per match — expand to see squads. Hit rate on the right if you've backed them before (✗ = last miss or below 50%)."
      >
        <RoundRosterPanel roster={roundRoster} playerHistory={playerHistory} />
      </CollapsibleSection>

      <section className="card">
        <h2 className="mb-1 text-lg font-semibold text-white">Your player record</h2>
        <p className="mb-3 text-sm text-slate-400">
          Split by stat — tap a summary card to filter. Most backed players and
          your strongest markets show up first. Sort the list to find who&apos;s
          been burning you.
        </p>
        <PlayerRecordPanel records={playerRecord} />
      </section>
    </div>
  );
}

function CollapsibleSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <details className="card group">
      <summary className="flex cursor-pointer list-none items-start gap-2">
        <span className="mt-1 shrink-0 text-slate-600 transition-transform group-open:rotate-90">
          ▸
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-0.5 text-sm text-slate-400">{description}</p>
        </div>
      </summary>
      <div className="mt-3 border-t border-surface-border/60 pt-3">{children}</div>
    </details>
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
