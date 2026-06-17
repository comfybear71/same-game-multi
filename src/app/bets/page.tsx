import Link from "next/link";

import { LegResultControls } from "@/components/LegResultControls";
import { SettleNowButton } from "@/components/SettleNowButton";
import { auth } from "@/lib/auth";
import {
  getBetsForUser,
  summarise,
  userIdForEmail,
  type BetWithLegs,
} from "@/lib/data/bets";
import { marginVsTarget, signed, targetLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BetsPage() {
  const session = await auth();
  const email = session?.user?.email;

  let slips: BetWithLegs[] = [];
  let dbError: string | null = null;
  if (email) {
    try {
      const userId = await userIdForEmail(email);
      if (userId) slips = await getBetsForUser(userId);
    } catch (err) {
      dbError = (err as Error).message;
    }
  }

  const summary = summarise(slips);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Bet tracker</h1>
          <p className="text-sm text-slate-400">Same-game multis and their legs.</p>
        </div>
        <div className="flex items-center gap-2">
          <SettleNowButton />
          <Link href="/bets/new" className="btn">
            + New bet
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Slips" value={String(summary.total)} />
        <Stat label="Pending" value={String(summary.pending)} />
        <Stat label="Strike rate" value={strikeRate(summary.won, summary.lost)} />
        <Stat
          label="ROI"
          value={summary.roi == null ? "—" : `${(summary.roi * 100).toFixed(0)}%`}
        />
      </section>

      {dbError ? (
        <div className="card border-accent-loss/40 text-sm text-slate-400">
          Couldn&apos;t load bets: {dbError}
        </div>
      ) : null}

      {slips.length === 0 ? (
        <div className="card">
          <p className="text-slate-300">No bets logged yet.</p>
          <p className="mt-1 text-sm text-slate-400">
            Tap <span className="font-medium text-slate-200">+ New bet</span> to log
            a multi — upload your slip screenshot and let AI read the legs, or enter
            them by hand.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {slips.map((slip) => (
            <BetSlip key={slip.id} slip={slip} />
          ))}
        </div>
      )}
    </div>
  );
}

function strikeRate(won: number, lost: number): string {
  const settled = won + lost;
  if (settled === 0) return "—";
  return `${Math.round((won / settled) * 100)}%`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-bold text-white">{value}</div>
    </div>
  );
}

function BetSlip({ slip }: { slip: BetWithLegs }) {
  const statusColor: Record<string, string> = {
    pending: "bg-accent-pending/15 text-accent-pending",
    won: "bg-accent-win/15 text-accent-win",
    lost: "bg-accent-loss/15 text-accent-loss",
    void: "bg-slate-600/30 text-slate-300",
  };
  const settledLegs = slip.legs.filter(
    (l) => l.result === "hit" || l.result === "miss",
  );
  const hits = settledLegs.filter((l) => l.result === "hit").length;
  const misses = settledLegs.length - hits;

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">
          {slip.round ? `Round ${slip.round}` : "Multi"} · {slip.legs.length} legs
        </span>
        <span className={`pill ${statusColor[slip.status]}`}>{slip.status}</span>
      </div>
      <div className="mt-2 flex gap-4 text-sm text-slate-300">
        <span>Stake ${slip.totalStake?.toFixed(2) ?? "—"}</span>
        <span>Odds {slip.totalOdds?.toFixed(2) ?? "—"}</span>
      </div>
      {settledLegs.length > 0 ? (
        <p className="mt-2 text-sm">
          <span className="font-semibold text-white">
            {hits}/{settledLegs.length}
          </span>{" "}
          <span className="text-slate-400">legs hit</span>
          {slip.status === "lost" && misses === 1 ? (
            <span className="text-accent-pending">
              {" "}
              — one leg away from a winner
            </span>
          ) : null}
        </p>
      ) : null}
      <ul className="mt-3 space-y-1">
        {slip.legs.map((leg) => {
          const settled = leg.result === "hit" || leg.result === "miss";
          const margin =
            leg.actualValue != null
              ? marginVsTarget(leg.actualValue, leg.line)
              : null;
          return (
            <li key={leg.id} className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-slate-300">
                  {leg.playerName ? (
                    <span className="font-medium text-white">{leg.playerName} </span>
                  ) : null}
                  {leg.statType} {targetLabel(leg.line)}
                  {leg.odds ? <span className="text-slate-500"> @ {leg.odds}</span> : null}
                  {settled && leg.actualValue != null ? (
                    <span className="text-slate-500">
                      {" "}
                      · got{" "}
                      <span className="text-slate-300">{leg.actualValue}</span>
                      {margin != null ? (
                        <span
                          className={
                            margin >= 0 ? "text-accent-win" : "text-accent-loss"
                          }
                        >
                          {" "}
                          ({signed(margin)})
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
                <span
                  className={
                    leg.result === "hit"
                      ? "text-accent-win"
                      : leg.result === "miss"
                        ? "text-accent-loss"
                        : "text-slate-500"
                  }
                >
                  {leg.result}
                </span>
              </div>
              {leg.result === "pending" ? (
                <LegResultControls legId={leg.id} line={leg.line} />
              ) : null}
            </li>
          );
        })}
      </ul>
      {slip.screenshotUrl ? (
        <a
          href={slip.screenshotUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={slip.screenshotUrl}
            alt="bet slip"
            className="max-h-28 rounded-lg border border-surface-border"
          />
        </a>
      ) : null}
    </div>
  );
}
