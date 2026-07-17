"use client";

import { useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { BankrollSimView } from "@/lib/system/bankroll";
import type { LabControlFilters } from "@/lib/system/labFilters";

export type RecipeRow = {
  strategyKey: string;
  label: string;
  focus: string;
  slips: number;
  slipHits: number;
  slipHitRate: number | null;
  flatRoi: number | null;
  flatReturned: number;
};

export type MatchupDash = {
  label: string;
  games: number;
  strategies: RecipeRow[];
};

/** Best first by flat ROI — keep red ROI visible (useful “avoid” signal). */
function rankedRecipes(rows: RecipeRow[], limit = 20): RecipeRow[] {
  return [...rows]
    .filter((s) => s.slips >= 2)
    .sort((a, b) => (b.flatRoi ?? -999) - (a.flatRoi ?? -999))
    .slice(0, limit);
}

const FOCUS_LABELS: Record<string, string> = {
  goals: "Goals",
  tackles: "Tackles",
  marks: "Marks",
  disposals: "Disposals",
  any: "Any",
};

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Math.round(n * 100) / 100;
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
}

function pctHits(hits: number, total: number): string {
  if (total <= 0) return "—";
  return `${Math.round((hits / total) * 1000) / 10}%`;
}

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n * 1000) / 10}%`;
}

function roiPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Math.round(n * 1000) / 10;
  return `${v > 0 ? "+" : ""}${v}%`;
}

/** Compact live scoreboard — sits under the dials on /lab. */
export function BankrollSimPanel({
  initial,
  controls,
  recipes = [],
  matchup,
  matchupLoading,
}: {
  initial: BankrollSimView;
  controls: LabControlFilters;
  /** Lab strategies in current dial scope — used for profitable recipe list. */
  recipes?: RecipeRow[];
  /** When two clubs are selected — H2H metrics sit beside the bank chart. */
  matchup?: MatchupDash | null;
  matchupLoading?: boolean;
}) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqGen = useRef(0);

  const targetSource = controls.runId;
  const isH2h = controls.teams.length === 2;

  async function simulate() {
    if (targetSource == null) return;
    const gen = ++reqGen.current;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        sourceRunId: targetSource,
        flatStake: controls.stake,
        focuses: controls.focuses,
        minLegs: controls.minLegs,
        maxLegs: controls.maxLegs,
        persist: false,
      };
      if (controls.teams.length === 1) body.team = controls.teams[0];
      if (controls.teams.length === 2) {
        body.teamA = controls.teams[0];
        body.teamB = controls.teams[1];
      }

      const res = await fetch("/api/system/bankroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as BankrollSimView & {
        ok?: boolean;
        error?: string;
      };
      if (gen !== reqGen.current) return;
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? `Failed (${res.status})`);
      }
      setData({
        run: json.run,
        checkpoints: json.checkpoints ?? [],
        rounds: json.rounds ?? [],
      });
    } catch (err) {
      if (gen !== reqGen.current) return;
      setError((err as Error).message);
    } finally {
      if (gen === reqGen.current) setBusy(false);
    }
  }

  const focusesKey = controls.focuses.join(",");
  const teamsKey = controls.teams.join("|");

  useEffect(() => {
    if (targetSource == null) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void simulate();
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    targetSource,
    controls.stake,
    controls.minLegs,
    controls.maxLegs,
    focusesKey,
    teamsKey,
  ]);

  const run = data.run;
  const equity = data.rounds.map((r) => ({
    label: `${r.season} R${r.round}`,
    bank: Math.round(r.bankAfter * 100) / 100,
  }));

  const scopeLabel =
    controls.teams.length === 2
      ? `${controls.teams[0]} v ${controls.teams[1]}`
      : controls.teams.length === 1
        ? controls.teams[0]
        : "All clubs";

  const matchupStats = matchup ? summariseMatchup(matchup) : null;
  const ranked = rankedRecipes(matchup?.strategies ?? recipes, 20);
  const favourite =
    ranked.find((s) => (s.flatRoi ?? 0) > 0) ?? ranked[0] ?? null;

  return (
    <div
      className={`space-y-3 rounded-lg border border-surface-border bg-surface/40 px-3 py-3 ${
        busy ? "opacity-70" : ""
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">
            {isH2h ? `Matchup · ${scopeLabel}` : "Dollar result"}
            {busy ? (
              <span className="ml-2 text-xs font-normal text-slate-500">
                updating…
              </span>
            ) : null}
          </h2>
          <p className="text-[11px] text-slate-500">
            ${controls.stake}/ticket · legs {controls.minLegs}–{controls.maxLegs}
            {!isH2h && favourite ? (
              <>
                {" "}
                · favourite{" "}
                <span className="text-slate-300">{favourite.label}</span>
              </>
            ) : null}
            {isH2h ? (
              <> · walk-forward bank + H2H recipes for these dials</>
            ) : null}
          </p>
        </div>
      </div>

      {error ? <p className="text-xs text-accent-loss">{error}</p> : null}

      {!run && busy ? (
        <p className="text-sm text-slate-500">Crunching walk-forward…</p>
      ) : null}

      {isH2h && matchupLoading && !matchup ? (
        <p className="text-sm text-slate-500">
          Loading {scopeLabel} meetings since 2024 R0…
        </p>
      ) : null}

      {run ? (
        <>
          {/* KPI strip — H2H adds meetings / matchup hit */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {matchupStats ? (
              <>
                <Stat label="Meetings" value={String(matchupStats.games)} big />
                <Stat
                  label="Matchup hit"
                  value={`${pct(matchupStats.hitRate)} (${matchupStats.hits}/${matchupStats.slips})`}
                />
                <Stat
                  label="Matchup ROI"
                  value={roiPct(matchupStats.flatRoi)}
                  tone={(matchupStats.flatRoi ?? 0) >= 0 ? "win" : "loss"}
                />
              </>
            ) : null}
            <Stat
              label="Net P&L"
              value={money(run.netProfit)}
              tone={(run.netProfit ?? 0) >= 0 ? "win" : "loss"}
              big={!matchupStats}
            />
            <Stat label="Final bank" value={money(run.finalBank)} />
            <Stat
              label="Ticket hit"
              value={`${run.ticketsHit}/${run.ticketsPlaced} (${pctHits(
                run.ticketsHit,
                run.ticketsPlaced,
              )})`}
            />
          </div>

          {matchupStats && matchupStats.byFocus.length > 0 ? (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                By market in this matchup
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {matchupStats.byFocus.map((f) => (
                  <div
                    key={f.focus}
                    className="min-w-[6.5rem] shrink-0 rounded-md border border-surface-border/60 bg-surface/50 px-2 py-1.5"
                  >
                    <div className="text-xs font-medium text-white">
                      {f.focus}
                    </div>
                    <div className="mt-0.5 whitespace-nowrap text-[11px] tabular-nums text-slate-400">
                      {pct(f.hitRate)} hit ·{" "}
                      <span
                        className={
                          (f.roi ?? 0) >= 0
                            ? "text-accent-win"
                            : "text-accent-loss"
                        }
                      >
                        {roiPct(f.roi)}
                      </span>{" "}
                      · n={f.slips}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Chart | recipes — chart gets ~2/3 on wide screens */}
          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
            <div className="min-w-0">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Bank by round
              </h3>
              {equity.length > 0 ? (
                <div className="rounded-md border border-surface-border/60 bg-surface/30 p-1">
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={equity}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2a3a" />
                      <XAxis
                        dataKey="label"
                        stroke="#64748b"
                        fontSize={9}
                        interval="preserveStartEnd"
                      />
                      <YAxis stroke="#64748b" fontSize={10} width={36} />
                      <Tooltip
                        contentStyle={{
                          background: "#131a26",
                          border: "1px solid #1f2a3a",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="bank"
                        stroke="#38bdf8"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-xs text-slate-600">No round equity yet.</p>
              )}
            </div>

            <div className="min-w-0">
              {ranked.length > 0 ? (
                <>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {isH2h ? "Best recipes (this H2H)" : "What we learned"}
                  </h3>
                  <p className="mb-1.5 text-[11px] text-slate-600">
                    Legs {controls.minLegs}–{controls.maxLegs}
                    {isH2h ? " in these meetings" : ""} — sorted by flat ROI
                    (red = avoid).
                  </p>
                  <ol className="max-h-[14rem] space-y-1 overflow-y-auto text-xs">
                    {ranked.map((s, i) => (
                      <li
                        key={s.strategyKey}
                        className="flex flex-wrap items-baseline gap-x-2 text-slate-300"
                      >
                        <span className="w-4 tabular-nums text-slate-500">
                          {i + 1}.
                        </span>
                        <span className="text-white">{s.label}</span>
                        <span className="tabular-nums text-slate-400">
                          {pct(s.slipHitRate)} hit ({s.slipHits}/{s.slips})
                        </span>
                        <span
                          className={`tabular-nums ${
                            (s.flatRoi ?? 0) >= 0
                              ? "text-accent-win"
                              : "text-accent-loss"
                          }`}
                        >
                          {roiPct(s.flatRoi)} ROI
                        </span>
                      </li>
                    ))}
                  </ol>
                </>
              ) : isH2h && matchup && matchup.games === 0 ? (
                <p className="text-sm text-slate-500">
                  No meetings for this matchup in the selected run.
                </p>
              ) : (
                <p className="text-sm text-slate-500">
                  No recipes in this filter
                  {needsWideHint(controls)
                    ? " — widen legs or check wide run"
                    : ""}
                  .
                </p>
              )}
            </div>
          </div>
        </>
      ) : !busy && targetSource == null ? (
        <p className="text-sm text-slate-500">Loading history…</p>
      ) : null}
    </div>
  );
}

function summariseMatchup(matchup: MatchupDash) {
  const strategies = matchup.strategies;
  const slips = strategies.reduce((a, s) => a + s.slips, 0);
  const hits = strategies.reduce((a, s) => a + s.slipHits, 0);
  const returned = strategies.reduce((a, s) => a + s.flatReturned, 0);
  const hitRate = slips > 0 ? hits / slips : null;
  const flatRoi = slips > 0 ? (returned - slips) / slips : null;

  const byFocus = Object.entries(FOCUS_LABELS)
    .map(([key, label]) => {
      const rows = strategies.filter((s) => s.focus === key);
      const n = rows.reduce((a, r) => a + r.slips, 0);
      const h = rows.reduce((a, r) => a + r.slipHits, 0);
      const ret = rows.reduce((a, r) => a + r.flatReturned, 0);
      return {
        focus: label,
        slips: n,
        hitRate: n > 0 ? h / n : null,
        roi: n > 0 ? (ret - n) / n : null,
      };
    })
    .filter((r) => r.slips > 0);

  return {
    games: matchup.games,
    slips,
    hits,
    hitRate,
    flatRoi,
    byFocus,
  };
}

function needsWideHint(controls: LabControlFilters): boolean {
  for (let n = controls.minLegs; n <= controls.maxLegs; n++) {
    if (n !== 3 && n !== 6 && n !== 10) return true;
  }
  return false;
}

function Stat({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: string;
  tone?: "win" | "loss";
  big?: boolean;
}) {
  return (
    <div className="rounded-md border border-surface-border/60 bg-surface/50 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`mt-0.5 font-semibold tabular-nums ${
          big ? "text-lg" : "text-sm"
        } ${
          tone === "win"
            ? "text-accent-win"
            : tone === "loss"
              ? "text-accent-loss"
              : "text-white"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
