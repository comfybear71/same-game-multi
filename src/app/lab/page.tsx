import { LabWorkspace } from "@/components/LabWorkspace";
import { getBacktestLabData, type BacktestLabData } from "@/lib/data/backtest";
import {
  getLatestBankrollSim,
  type BankrollSimView,
} from "@/lib/system/bankroll";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  const emptyLab = (): BacktestLabData => ({
    run: null,
    runs: [],
    strategies: [],
    bySeason: [],
    calibration: [],
    context: { byTeam: [], byVenue: [], byMatchup: [], byPlayerTeam: [] },
    scope: null,
    scopeLabel: null,
    scopedGames: 0,
  });

  let labData: BacktestLabData = emptyLab();
  let bankroll: BankrollSimView = { run: null, checkpoints: [], rounds: [] };
  let dbError: string | null = null;

  try {
    try {
      labData = await getBacktestLabData();
    } catch {
      labData = emptyLab();
    }
    try {
      bankroll = await getLatestBankrollSim();
    } catch {
      bankroll = { run: null, checkpoints: [], rounds: [] };
    }
  } catch (err) {
    dbError = (err as Error).message;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Lab</h1>
        <p className="text-sm text-slate-400">
          Twist the dials — dollar P&amp;L and what we learned update live.
          History from 2024 R0. Research only; live staking is on System.
        </p>
      </header>

      {dbError ? (
        <div className="card border-accent-loss/40 text-sm text-slate-400">
          Couldn&apos;t load lab data: {dbError}
        </div>
      ) : null}

      <LabWorkspace labData={labData} bankroll={bankroll} />
    </div>
  );
}
