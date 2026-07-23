import Link from "next/link";

import { BetSlipScrollRow } from "@/components/BetSlipScrollRow";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { DeleteBetButton } from "@/components/DeleteBetButton";
import { EditLegMarket } from "@/components/EditLegMarket";
import { LegResultControls } from "@/components/LegResultControls";
import { MultiStatsPanel } from "@/components/MultiStatsPanel";
import { RunMigrationsButton } from "@/components/RunMigrationsButton";
import { UploadResultButton } from "@/components/UploadResultButton";
import { auth } from "@/lib/auth";
import { teamColors } from "@/lib/afl/teamColors";
import {
  analyseMultis,
  getEnrichedBetsForUser,
  summarise,
  userIdForEmail,
  type EnrichedBetSlip,
} from "@/lib/data/bets";
import { deriveSlipStatus } from "@/lib/betTypes";
import { rollUpSlips } from "@/lib/settle";
import { marginVsTarget, signed, targetLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BetsPage({
  searchParams,
}: {
  searchParams?: { saved?: string; bet?: string; round?: string; noround?: string };
}) {
  const session = await auth();
  const email = session?.user?.email;

  let slips: EnrichedBetSlip[] = [];
  let dbError: string | null = null;
  if (email) {
    try {
      const userId = await userIdForEmail(email);
      if (userId) slips = await getEnrichedBetsForUser(userId);
    } catch (err) {
      dbError = (err as Error).message;
    }
  }

  // Fix slips still marked lost/won when leg results say void (stake returned).
  const staleIds = slips
    .filter((s) => deriveSlipStatus(s.legs) !== s.status)
    .map((s) => s.id);
  if (staleIds.length > 0) {
    try {
      await rollUpSlips(staleIds);
      if (email) {
        const userId = await userIdForEmail(email);
        if (userId) slips = await getEnrichedBetsForUser(userId);
      }
    } catch {
      /* display still uses deriveSlipStatus */
    }
  }

  const summary = summarise(slips);
  const multiStats = analyseMultis(slips);
  const justSaved = searchParams?.saved === "1";
  const savedBetId = searchParams?.bet ? Number(searchParams.bet) : null;
  const savedNoRound = searchParams?.noround === "1";
  const savedSlip =
    savedBetId != null && Number.isFinite(savedBetId)
      ? slips.find((s) => s.id === savedBetId) ?? null
      : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Bet tracker</h1>
          <p className="text-sm text-slate-400">Same-game multis and their legs.</p>
        </div>
        <Link href="/bets/new" className="btn">
          + New bet
        </Link>
      </header>

      {justSaved ? (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            savedNoRound || (savedSlip && savedSlip.round == null)
              ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
              : "border-accent-win/40 bg-accent-win/10 text-emerald-100"
          }`}
        >
          {savedSlip ? (
            <>
              Saved slip #{savedSlip.id} · {savedSlip.legs.length} legs
              {savedSlip.totalOdds != null ? ` · odds ${savedSlip.totalOdds}` : ""}
              {savedSlip.round != null
                ? ` · Round ${savedSlip.round}`
                : " · under No round (expand below)"}
              .
            </>
          ) : (
            <>
              Bet saved
              {savedNoRound
                ? " — check the No round section below if you don’t see it in Round 20."
                : "."}
            </>
          )}
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Slips" value={String(summary.total)} />
        <Stat label="Pending" value={String(summary.pending)} />
        <Stat label="Strike rate" value={strikeRate(summary.won, summary.lost)} />
        <Stat
          label="ROI"
          value={summary.roi == null ? "—" : `${(summary.roi * 100).toFixed(0)}%`}
        />
      </section>

      <CollapsibleSection
        title="Your multis"
        description="Slip performance by ticket size — filter chips, compact table."
      >
        <MultiStatsPanel analytics={multiStats} />
      </CollapsibleSection>

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
          {groupByRound(slips).map((group, i) => (
            <RoundSection key={group.key} group={group} defaultOpen={i === 0} />
          ))}
        </div>
      )}

      <footer className="border-t border-surface-border pt-4">
        <RunMigrationsButton />
      </footer>
    </div>
  );
}

function strikeRate(won: number, lost: number): string {
  const settled = won + lost;
  if (settled === 0) return "—";
  return `${Math.round((won / settled) * 100)}%`;
}

interface RoundGroup {
  key: string;
  round: number | null;
  slips: EnrichedBetSlip[];
}

/** Group slips by round, newest round first, unrounded last. */
function groupByRound(slips: EnrichedBetSlip[]): RoundGroup[] {
  const map = new Map<number | null, EnrichedBetSlip[]>();
  for (const s of slips) {
    const k = s.round ?? null;
    const arr = map.get(k);
    if (arr) arr.push(s);
    else map.set(k, [s]);
  }
  return [...map.entries()]
    .map(([round, group]) => ({ key: String(round), round, slips: group }))
    .sort((a, b) => {
      if (a.round == null) return 1;
      if (b.round == null) return -1;
      return b.round - a.round;
    });
}

function RoundSection({
  group,
  defaultOpen,
}: {
  group: RoundGroup;
  defaultOpen: boolean;
}) {
  const s = summarise(group.slips);
  const noRound = group.round == null;
  return (
    <details open={defaultOpen || noRound} className="space-y-3">
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg bg-surface-card px-3 py-2">
        <span className="text-sm font-semibold text-white">
          {noRound ? (
            <span className="text-amber-300">
              No round — link a game on these slips
            </span>
          ) : (
            `Round ${group.round}`
          )}
        </span>
        <span className="text-xs text-slate-400">
          {s.total} slip{s.total === 1 ? "" : "s"} · {s.won}W {s.lost}L
          {s.pending > 0 ? ` · ${s.pending} pending` : ""}
        </span>
      </summary>
      {noRound ? (
        <p className="px-1 text-xs text-amber-200/90">
          Usually from an AI slip read that couldn&apos;t see the match header.
          Slips still count for your record — open one and fix the fixture if needed,
          or re-read with Adelaide v Collingwood visible in the screenshot.
        </p>
      ) : null}
      {/* Slips scroll horizontally within the round — scrollbar sits under the heading. */}
      <BetSlipScrollRow>
          {group.slips.map((slip) => (
            <div
              key={slip.id}
              className="w-[85vw] max-w-sm shrink-0 snap-start sm:w-80"
            >
              <BetSlip slip={slip} />
            </div>
          ))}
      </BetSlipScrollRow>
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

function BetSlip({ slip }: { slip: EnrichedBetSlip }) {
  const statusColor: Record<string, string> = {
    pending: "bg-accent-pending/15 text-accent-pending",
    won: "bg-accent-win/15 text-accent-win",
    lost: "bg-accent-loss/15 text-accent-loss",
    void: "bg-slate-600/30 text-slate-300",
  };
  const voids = slip.legs.filter((l) => l.result === "void").length;
  const activeLegs = slip.legs.filter((l) => l.result !== "void");
  const settledLegs = activeLegs.filter(
    (l) => l.result === "hit" || l.result === "miss",
  );
  const hits = settledLegs.filter((l) => l.result === "hit").length;
  const misses = settledLegs.length - hits;
  const displayStatus = deriveSlipStatus(slip.legs);

  return (
    <div className="card">
      {slip.fixture ? (
        <div className="mb-2 border-b border-surface-border/60 pb-2">
          <Link
            href={`/games/${slip.fixture.gameId}`}
            className="block text-sm font-semibold leading-snug text-white hover:text-accent"
          >
            {slip.fixture.home} v {slip.fixture.away}
          </Link>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">
          {slip.round ? `Round ${slip.round}` : "Multi"} · {slip.legs.length} legs
        </span>
        <span className={`pill ${statusColor[displayStatus]}`}>{displayStatus}</span>
      </div>
      <div className="mt-2 flex gap-4 text-sm text-slate-300">
        <span>Stake ${slip.totalStake?.toFixed(2) ?? "—"}</span>
        <span>Odds {slip.totalOdds?.toFixed(2) ?? "—"}</span>
      </div>
      {displayStatus === "void" ? (
        <p className="mt-2 text-sm text-slate-400">
          Stake returned — {voids} injured leg{voids === 1 ? "" : "s"} voided
          {hits > 0 ? ` · ${hits}/${activeLegs.length} active legs hit` : ""}
        </p>
      ) : settledLegs.length > 0 ? (
        <p className="mt-2 text-sm">
          <span className="font-semibold text-white">
            {hits}/{settledLegs.length}
          </span>{" "}
          <span className="text-slate-400">legs hit</span>
          {voids > 0 ? (
            <span className="text-slate-500">
              {" "}
              · {voids} void
            </span>
          ) : null}
          {displayStatus === "lost" && misses === 1 ? (
            <span className="text-accent-pending">
              {" "}
              — one leg away from a winner
            </span>
          ) : null}
        </p>
      ) : voids > 0 ? (
        <p className="mt-2 text-sm text-slate-400">{voids} void leg{voids === 1 ? "" : "s"}</p>
      ) : null}
      <ul className="mt-3 space-y-1">
        {slip.legs.map((leg) => {
          const isVoid = leg.result === "void";
          const settled = leg.result === "hit" || leg.result === "miss";
          const margin =
            !isVoid && leg.actualValue != null
              ? marginVsTarget(leg.actualValue, leg.line)
              : null;
          const colors = leg.team ? teamColors(leg.team) : null;
          return (
            <li
              key={leg.id}
              className={`space-y-1 text-sm${isVoid ? " opacity-90" : ""}`}
            >
              <div className="flex justify-between gap-2">
                <div className="flex min-w-0 items-start gap-1.5">
                  {colors ? (
                    <span
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold"
                      style={{ background: colors.bg, color: colors.fg }}
                    >
                      {leg.jumper ?? "–"}
                    </span>
                  ) : null}
                  <span className="min-w-0 text-slate-300">
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
                    ) : isVoid && leg.actualValue != null ? (
                      <span className="text-slate-500">
                        {" "}
                        · tracked{" "}
                        <span className="text-slate-300">{leg.actualValue}</span>
                      </span>
                    ) : null}
                  </span>
                </div>
                {isVoid ? (
                  <span className="shrink-0 rounded bg-slate-600/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                    Void
                  </span>
                ) : (
                  <span
                    className={`shrink-0 capitalize ${
                      leg.result === "hit"
                        ? "text-accent-win"
                        : leg.result === "miss"
                          ? "text-accent-loss"
                          : "text-slate-500"
                    }`}
                  >
                    {leg.result}
                  </span>
                )}
              </div>
              <LegResultControls
                legId={leg.id}
                line={leg.line}
                result={leg.result}
                actualValue={leg.actualValue}
              />
              <EditLegMarket
                legId={leg.id}
                statType={leg.statType}
                line={leg.line}
                result={leg.result}
              />
            </li>
          );
        })}
      </ul>
      {displayStatus === "pending" ? (
        <div className="mt-3 border-t border-surface-border pt-3">
          <DeleteBetButton betId={slip.id} />
        </div>
      ) : null}
      <div className="mt-3 border-t border-surface-border pt-3">
        <UploadResultButton betId={slip.id} />
        <p className="mt-2 text-xs text-slate-500">
          Take a screenshot of this bet&apos;s results in the Sportsbet app, then tap
          the button above to fill in the scores automatically.
        </p>
      </div>
      {slip.screenshotUrl || slip.resultScreenshotUrl ? (
        <div className="mt-3 flex gap-2">
          {slip.screenshotUrl ? (
            <Screenshot url={slip.screenshotUrl} label="Slip" />
          ) : null}
          {slip.resultScreenshotUrl ? (
            <Screenshot url={slip.resultScreenshotUrl} label="Result" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Screenshot({ url, label }: { url: string; label: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-block">
      <span className="mb-1 block text-[11px] text-slate-500">{label}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`bet ${label.toLowerCase()}`}
        className="max-h-28 rounded-lg border border-surface-border"
      />
    </a>
  );
}
