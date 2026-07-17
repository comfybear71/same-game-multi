import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { LiveSystemBankrollPanel } from "@/components/LiveSystemBankrollPanel";
import { currentSeason } from "@/lib/cron";
import {
  getLiveSystemBankroll,
  type LiveSystemBankroll,
} from "@/lib/system/liveBankroll";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  // Soft nav / Link prefetch can otherwise reuse a stale empty RSC payload.
  noStore();

  const season = currentSeason();
  let liveBankroll: LiveSystemBankroll = {
    season,
    ticketsTracked: 0,
    ticketsGraded: 0,
    ticketsHit: 0,
    ticketsPending: 0,
    totalStaked: 0,
    openStake: 0,
    settledStake: 0,
    totalReturned: 0,
    netProfit: 0,
    tickets: [],
  };
  let dbError: string | null = null;

  try {
    liveBankroll = await getLiveSystemBankroll(season);
  } catch (err) {
    dbError = (err as Error).message;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">System book</h1>
        <p className="text-sm text-slate-400">
          Season {season} · live dollars on placed System book tickets — separate
          from your personal Multis. Styles from{" "}
          <Link href="/lab" className="text-accent hover:underline">
            Lab
          </Link>
          , players from{" "}
          <Link href="/leaders" className="text-accent hover:underline">
            Leaders
          </Link>
          ; place on each game, track P&amp;L here.
        </p>
      </header>

      {dbError ? (
        <div className="card border-accent-loss/40 text-sm text-slate-400">
          Couldn&apos;t load system data: {dbError}
        </div>
      ) : null}

      <section className="card space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Live System bank</h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Real stakes and bookie odds. Expand a game for ticket detail; P&amp;L
            chart fills in as slips settle.
          </p>
        </div>
        <LiveSystemBankrollPanel
          key={`live-${liveBankroll.season}-${liveBankroll.ticketsTracked}-${liveBankroll.totalStaked}`}
          initial={liveBankroll}
        />
      </section>
    </div>
  );
}
