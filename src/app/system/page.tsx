import { CollapsibleSection } from "@/components/CollapsibleSection";
import { LiveSystemBankrollPanel } from "@/components/LiveSystemBankrollPanel";
import { SystemHelmPanel } from "@/components/SystemHelmPanel";
import { currentSeason } from "@/lib/cron";
import {
  getLiveSystemBankroll,
  type LiveSystemBankroll,
} from "@/lib/system/liveBankroll";
import { getActivePolicy, type ActivePolicyView } from "@/lib/system/policy";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  const season = currentSeason();
  let systemPolicy: ActivePolicyView | null = null;
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
    try {
      systemPolicy = await getActivePolicy();
    } catch {
      systemPolicy = null;
    }
    try {
      liveBankroll = await getLiveSystemBankroll(season);
    } catch {
      /* keep empty */
    }
  } catch (err) {
    dbError = (err as Error).message;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">System book</h1>
        <p className="text-sm text-slate-400">
          Season {season} · live helm dollars — separate from your personal Multis.
          Place from each game&apos;s System book, then track progress here.
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
            Real stakes and bookie odds on helm tickets. After settle: HIT/MISS and
            season P&amp;L.
          </p>
        </div>
        <LiveSystemBankrollPanel initial={liveBankroll} />
      </section>

      <CollapsibleSection
        title="AI helm"
        description="Policy from Strategy lab — ranks which multi styles to favour. Steers Suggested multi defaults and each game's System book portfolio."
        defaultOpen
      >
        <SystemHelmPanel initial={systemPolicy} />
      </CollapsibleSection>
    </div>
  );
}
