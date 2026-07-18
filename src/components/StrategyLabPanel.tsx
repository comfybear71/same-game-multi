"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { BankrollSimPanel } from "@/components/BankrollSimPanel";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { AFL_TEAMS } from "@/lib/afl/teams";
import {
  describeBacktestRun,
  type BacktestContext,
  type BacktestLabData,
} from "@/lib/data/backtest";
import type { BankrollSimView } from "@/lib/system/bankroll";
import type { LabControlFilters } from "@/lib/system/labFilters";

const FOCUS_OPTIONS = [
  { key: "goals", label: "Goals" },
  { key: "tackles", label: "Tackles" },
  { key: "marks", label: "Marks" },
  { key: "disposals", label: "Disposals" },
  { key: "any", label: "Any" },
] as const;

const TEAM_SHORT: Record<string, string> = {
  Adelaide: "Adel",
  "Brisbane Lions": "Bris",
  Carlton: "Carl",
  Collingwood: "Coll",
  Essendon: "Ess",
  Fremantle: "Freo",
  Geelong: "Geel",
  "Gold Coast": "GC",
  "Greater Western Sydney": "GWS",
  Hawthorn: "Haw",
  Melbourne: "Melb",
  "North Melbourne": "North",
  "Port Adelaide": "Port",
  Richmond: "Rich",
  "St Kilda": "StK",
  Sydney: "Syd",
  "West Coast": "WCE",
  "Western Bulldogs": "Dogs",
};

type FocusKey = (typeof FOCUS_OPTIONS)[number]["key"];

const FOCUS_COLORS: Record<FocusKey, string> = {
  disposals: "#38bdf8",
  goals: "#f87171",
  marks: "#fbbf24",
  tackles: "#34d399",
  any: "#a78bfa",
};

const MIN_LEGS = 3;
const MAX_LEGS = 15;
/** Production full-* matrix only has these leg counts. */
const PRODUCTION_LEGS = new Set([3, 6, 10]);

/** True when the dial range asks for a leg count only the wide experiment has. */
function needsWideMatrix(min: number, max: number): boolean {
  for (let n = min; n <= max; n++) {
    if (!PRODUCTION_LEGS.has(n)) return true;
  }
  return false;
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

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function StrategyLabPanel({
  data: initial,
  bankroll,
  controls,
  onControlsChange,
}: {
  data: BacktestLabData;
  bankroll: BankrollSimView;
  controls: LabControlFilters;
  onControlsChange: (next: LabControlFilters) => void;
}) {
  const [data, setData] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const focuses = new Set(controls.focuses as FocusKey[]);
  const minLegs = controls.minLegs;
  const maxLegs = controls.maxLegs;
  const pickedTeams = controls.teams;
  const stake = controls.stake;

  function patchControls(partial: Partial<LabControlFilters>) {
    onControlsChange({ ...controls, ...partial });
  }

  async function loadLab(runId: number, teams: string[]) {
    setError(null);
    setPending(true);
    patchControls({ runId, teams });
    try {
      const params = new URLSearchParams({ runId: String(runId) });
      if (teams.length === 1) params.set("team", teams[0]!);
      if (teams.length === 2) {
        params.set("teamA", teams[0]!);
        params.set("teamB", teams[1]!);
      }
      const res = await fetch(`/api/backtest/lab?${params}`);
      const json = (await res.json()) as BacktestLabData & { error?: string };
      if (!res.ok) {
        setError(json.error ?? `Failed (${res.status})`);
        return;
      }
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  // Prefer full-* for 3/6/10 only; switch to wide when dials ask for other legs.
  useEffect(() => {
    const wantWide = needsWideMatrix(controls.minLegs, controls.maxLegs);
    const preferred =
      (wantWide
        ? data.runs.find(
            (r) => r.label.startsWith("exp-") && r.label.includes("wide"),
          )
        : null) ??
      data.runs.find((r) => r.label.startsWith("full-")) ??
      data.runs.find(
        (r) => r.label.startsWith("exp-") && r.label.includes("wide"),
      ) ??
      data.runs.find((r) => (r.seasons?.length ?? 0) >= 2);
    if (!preferred) return;
    if (data.run?.id === preferred.id) {
      if (controls.runId !== preferred.id) patchControls({ runId: preferred.id });
      return;
    }
    const currentLabel = data.run?.label ?? "";
    const onThinRun =
      !data.run ||
      currentLabel.startsWith("strategy-lab-") ||
      currentLabel.startsWith("smoke");
    const wrongMatrix =
      wantWide && !currentLabel.includes("wide")
        ? true
        : !wantWide && currentLabel.includes("wide") && data.runs.some((r) => r.label.startsWith("full-"));
    if (onThinRun || wrongMatrix) void loadLab(preferred.id, controls.teams);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data.runs,
    data.run?.id,
    data.run?.label,
    controls.minLegs,
    controls.maxLegs,
  ]);

  function pickAllTeams() {
    if (data.run) void loadLab(data.run.id, []);
    else patchControls({ teams: [] });
  }

  function toggleTeam(team: string) {
    let next: string[];
    if (pickedTeams.includes(team)) {
      next = pickedTeams.filter((t) => t !== team);
    } else if (pickedTeams.length >= 2) {
      next = [pickedTeams[1]!, team];
    } else {
      next = [...pickedTeams, team];
    }
    if (data.run) void loadLab(data.run.id, next);
    else patchControls({ teams: next });
  }

  const scopeNote =
    pickedTeams.length === 2
      ? `${pickedTeams[0]} v ${pickedTeams[1]}`
      : pickedTeams.length === 1
        ? pickedTeams[0]
        : "All clubs";

  const filteredStrategies = data.strategies.filter(
    (s) =>
      focuses.has(s.focus as FocusKey) &&
      s.legCount >= minLegs &&
      s.legCount <= maxLegs,
  );

  if (!data.run && data.runs.length === 0) {
    return (
      <div className="space-y-3 text-sm text-slate-400">
        <p>
          No backtest runs yet. After migrating, smoke-test then full seasons:
        </p>
        <pre className="overflow-x-auto rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-300">
{`npm run db:migrate
npx tsx scripts/backtest-sgm.ts --seasons=2026 --max-games=3 --label=smoke
npx tsx scripts/backtest-sgm.ts --seasons='2024,2025,2026' --label=full-2024-2026`}
        </pre>
      </div>
    );
  }

  const run = data.run;
  const runDesc = run ? describeBacktestRun(run) : null;

  const leaderboard = [...filteredStrategies]
    .sort((a, b) => (b.slipHitRate ?? 0) - (a.slipHitRate ?? 0))
    .slice(0, 25)
    .map((s) => ({
      key: s.strategyKey,
      label: s.label,
      slipHit: s.slipHitRate != null ? Math.round(s.slipHitRate * 1000) / 10 : 0,
      n: s.slips,
    }));

  const legCounts = Array.from(
    { length: maxLegs - minLegs + 1 },
    (_, i) => minLegs + i,
  );
  const byLegCount = legCounts.map((legs) => {
    const rows = filteredStrategies.filter((s) => s.legCount === legs);
    const slips = rows.reduce((a, r) => a + r.slips, 0);
    const hits = rows.reduce((a, r) => a + r.slipHits, 0);
    return {
      legs: String(legs),
      slipHit: slips > 0 ? Math.round((hits / slips) * 1000) / 10 : 0,
      n: slips,
    };
  });

  const byFocus = FOCUS_OPTIONS.filter((f) => focuses.has(f.key)).map((f) => {
    const rows = filteredStrategies.filter((s) => s.focus === f.key);
    const slips = rows.reduce((a, r) => a + r.slips, 0);
    const hits = rows.reduce((a, r) => a + r.slipHits, 0);
    return {
      focus: f.label,
      slipHit: slips > 0 ? Math.round((hits / slips) * 1000) / 10 : 0,
      n: slips,
    };
  });

  const chartSeasons = [
    ...new Set(data.bySeason.map((r) => r.season)),
  ].sort((a, b) => a - b);
  const seasonChart = chartSeasons.map((season) => {
    const row: Record<string, string | number> = { season: String(season) };
    for (const f of FOCUS_OPTIONS) {
      if (!focuses.has(f.key)) continue;
      const slice = data.bySeason.filter((r) => {
        if (r.season !== season) return false;
        if (!r.strategyKey.startsWith(`${f.key}_`)) return false;
        const legs = Number(r.strategyKey.split("_")[1]);
        return Number.isFinite(legs) && legs >= minLegs && legs <= maxLegs;
      });
      const slips = slice.reduce((a, r) => a + r.slips, 0);
      const hits = slice.reduce((a, r) => a + r.slipHits, 0);
      row[f.key] = slips > 0 ? Math.round((hits / slips) * 1000) / 10 : 0;
    }
    return row;
  });

  const calibration = data.calibration.map((b) => ({
    modelled: Math.round(b.modelled * 100),
    actual:
      b.actualHitRate != null ? Math.round(b.actualHitRate * 1000) / 10 : null,
    n: b.slips,
  }));

  const deadLong = filteredStrategies.filter(
    (s) => s.slips >= 20 && (s.slipHitRate ?? 0) === 0 && (s.flatRoi ?? 0) <= -0.99,
  );

  return (
    <div className={`space-y-6 ${pending ? "opacity-60" : ""}`}>
      <div className="rounded-lg border border-surface-border bg-surface/40 px-3 py-2 text-sm text-slate-300">
        {run && runDesc ? (
          <p className="text-xs text-slate-500">
            History from{" "}
            <span className="text-slate-300">2024 R0 → now</span>
            {" · "}
            <span className="text-slate-300">{runDesc.title}</span>
            {" · "}
            {data.scopedGames.toLocaleString("en-AU")} games in window ·{" "}
            {filteredStrategies
              .reduce((a, s) => a + s.slips, 0)
              .toLocaleString("en-AU")}{" "}
            slips (current filters)
          </p>
        ) : (
          <p className="text-xs text-slate-500">Loading history from 2024 R0…</p>
        )}
        <p className="mt-1 text-xs text-slate-500">
          Every recipe on every game in that window — then we cut the junk.
          Tap two clubs for H2H meetings (not total slips).
        </p>
        {error ? <p className="mt-2 text-xs text-accent-loss">{error}</p> : null}
      </div>

      {run ? (
        <>
          <div className="space-y-3 rounded-lg border border-surface-border bg-surface/30 px-3 py-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Clubs · ALL or X vs Y
              </div>
              <p className="mt-0.5 text-[11px] text-slate-600">
                Selected:{" "}
                <span className="text-slate-300">{scopeNote}</span>
                <span className="text-slate-600">
                  {" "}
                  ·{" "}
                  {pickedTeams.length === 2
                    ? `${data.scope?.teamA && data.scope?.teamB ? data.scopedGames : "…"} meetings`
                    : `${data.scopedGames} games since 2024 R0`}
                </span>
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => pickAllTeams()}
                  disabled={pending}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                    pickedTeams.length === 0
                      ? "border-accent/60 bg-accent/15 text-accent"
                      : "border-surface-border text-slate-500 hover:text-slate-300"
                  }`}
                >
                  ALL
                </button>
                {AFL_TEAMS.map((team) => {
                  const on = pickedTeams.includes(team);
                  const ord =
                    pickedTeams[0] === team
                      ? "1"
                      : pickedTeams[1] === team
                        ? "2"
                        : null;
                  return (
                    <button
                      key={team}
                      type="button"
                      title={team}
                      disabled={pending}
                      onClick={() => toggleTeam(team)}
                      className={`rounded-md border px-2 py-1 text-xs font-medium ${
                        on
                          ? "border-accent/60 bg-accent/15 text-accent"
                          : "border-surface-border text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {TEAM_SHORT[team] ?? team}
                      {ord ? (
                        <span className="ml-1 text-[10px] text-slate-500">
                          {ord}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Market
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <p className="min-w-0 shrink text-[11px] leading-snug text-slate-500">
                  <span className="tabular-nums text-slate-400">
                    {filteredStrategies.length}
                  </span>{" "}
                  recipes ·{" "}
                  <span className="tabular-nums text-slate-400">
                    {filteredStrategies
                      .reduce((a, s) => a + s.slips, 0)
                      .toLocaleString("en-AU")}
                  </span>{" "}
                  slips
                  {pickedTeams.length === 2
                    ? ` · ${data.scopedGames} meetings`
                    : pickedTeams.length === 1
                      ? " · club"
                      : " · all clubs"}
                  {data.run?.label?.startsWith("full-") ? (
                    <span className="text-slate-600">
                      {" "}
                      (5×3/6/10)
                    </span>
                  ) : data.run?.label?.includes("wide") ? (
                    <span className="text-slate-600"> (wide 3–25)</span>
                  ) : null}
                  {deadLong.length > 0 ? (
                    <span className="text-slate-600">
                      {" "}
                      · {deadLong.length} dead long
                    </span>
                  ) : null}
                </p>
                <button
                  type="button"
                  title="Select all markets"
                  onClick={() =>
                    patchControls({
                      focuses: FOCUS_OPTIONS.map((f) => f.key),
                    })
                  }
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                    focuses.size === FOCUS_OPTIONS.length
                      ? "border-accent/60 bg-accent/15 text-accent"
                      : "border-surface-border text-slate-500 hover:text-slate-300"
                  }`}
                >
                  ALL
                </button>
                {FOCUS_OPTIONS.map((f) => {
                  const on = focuses.has(f.key);
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => {
                        const next = toggleInSet(focuses, f.key);
                        if (next.size === 0) return;
                        patchControls({ focuses: [...next] });
                      }}
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                        on
                          ? "border-accent/60 bg-accent/15 text-accent"
                          : "border-surface-border text-slate-500 hover:border-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-xs text-slate-400">
                Min legs · {minLegs}
                <input
                  type="range"
                  min={MIN_LEGS}
                  max={MAX_LEGS}
                  step={1}
                  value={minLegs}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    patchControls({
                      minLegs: v,
                      maxLegs: v > maxLegs ? v : maxLegs,
                    });
                  }}
                  className="mt-1 w-full accent-sky-400"
                />
                <LegTicks active={minLegs} />
              </label>
              <label className="block text-xs text-slate-400">
                Max legs · {maxLegs}
                <input
                  type="range"
                  min={MIN_LEGS}
                  max={MAX_LEGS}
                  step={1}
                  value={maxLegs}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    patchControls({
                      maxLegs: v,
                      minLegs: v < minLegs ? v : minLegs,
                    });
                  }}
                  className="mt-1 w-full accent-sky-400"
                />
                <LegTicks active={maxLegs} />
              </label>
              <label className="block text-xs text-slate-400">
                Stake (${stake})
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={stake}
                  onChange={(e) =>
                    patchControls({ stake: Number(e.target.value) })
                  }
                  className="mt-1 w-full accent-sky-400"
                />
                <span className="mt-0.5 block text-[11px] text-slate-600">
                  $1–$100 flat / ticket
                  {needsWideMatrix(minLegs, maxLegs) ? (
                    <> · using wide matrix for legs outside 3/6/10</>
                  ) : null}
                </span>
              </label>
            </div>
          </div>

          <BankrollSimPanel
            initial={bankroll}
            controls={controls}
            recipes={filteredStrategies}
            matchup={
              pickedTeams.length === 2 &&
              data.scope?.teamA &&
              data.scope?.teamB &&
              ((data.scope.teamA === pickedTeams[0] &&
                data.scope.teamB === pickedTeams[1]) ||
                (data.scope.teamA === pickedTeams[1] &&
                  data.scope.teamB === pickedTeams[0]))
                ? {
                    label: data.scopeLabel ?? scopeNote,
                    games: data.scopedGames,
                    strategies: filteredStrategies,
                  }
                : null
            }
            matchupLoading={pickedTeams.length === 2}
          />

          {data.strategies.length === 0 ? (
            <p className="text-sm text-slate-500">
              No slips in this club scope for the selected run.
            </p>
          ) : null}

          <CollapsibleSection
            title="Charts & strategy table"
            description="Hit-rate charts, calibration, venue/club context — open when you want the deep dive."
            defaultOpen={false}
          >
          <div className="space-y-4">
          <ChartBlock
            title="Slip hit rate by strategy"
            subtitle="Top 25 in current filter (by hit rate)"
          >
            <ResponsiveContainer
              width="100%"
              height={Math.max(220, leaderboard.length * 26)}
            >
              <BarChart
                data={leaderboard}
                layout="vertical"
                margin={{ left: 8, right: 16 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2a3a" />
                <XAxis type="number" unit="%" stroke="#64748b" fontSize={11} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={120}
                  stroke="#64748b"
                  fontSize={11}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number, name: string) => [
                    name === "n" ? v : `${v}%`,
                    name === "slipHit" ? "Slip hit" : name,
                  ]}
                />
                <Bar
                  dataKey="slipHit"
                  fill="#38bdf8"
                  name="Slip hit %"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartBlock>

          <div className="grid gap-4 sm:grid-cols-2">
            <ChartBlock
              title="By leg count"
              subtitle={`${minLegs}–${maxLegs} legs`}
            >
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byLegCount}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2a3a" />
                  <XAxis dataKey="legs" stroke="#64748b" fontSize={11} />
                  <YAxis unit="%" stroke="#64748b" fontSize={11} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="slipHit" fill="#34d399" name="Slip hit %" />
                </BarChart>
              </ResponsiveContainer>
            </ChartBlock>

            <ChartBlock title="By market" subtitle="Selected focuses">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byFocus}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2a3a" />
                  <XAxis dataKey="focus" stroke="#64748b" fontSize={11} />
                  <YAxis unit="%" stroke="#64748b" fontSize={11} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="slipHit" fill="#fbbf24" name="Slip hit %" />
                </BarChart>
              </ResponsiveContainer>
            </ChartBlock>
          </div>

          {seasonChart.length > 0 ? (
            <ChartBlock
              title="Slip hit by season"
              subtitle="Selected markets · legs in range"
            >
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={seasonChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2a3a" />
                  <XAxis dataKey="season" stroke="#64748b" fontSize={11} />
                  <YAxis unit="%" stroke="#64748b" fontSize={11} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend />
                  {FOCUS_OPTIONS.filter((f) => focuses.has(f.key)).map((f) => (
                    <Line
                      key={f.key}
                      type="monotone"
                      dataKey={f.key}
                      name={f.label}
                      stroke={FOCUS_COLORS[f.key]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </ChartBlock>
          ) : null}

          {calibration.length > 0 ? (
            <ChartBlock
              title="Calibration"
              subtitle="Modelled slip chance vs actual hit rate (whole run)"
            >
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={calibration}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2a3a" />
                  <XAxis dataKey="modelled" unit="%" stroke="#64748b" fontSize={11} />
                  <YAxis unit="%" stroke="#64748b" fontSize={11} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    stroke="#34d399"
                    strokeWidth={2}
                    name="Actual hit %"
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartBlock>
          ) : null}

          <ContextExplorer context={data.context} />

          <div>
            <h3 className="mb-1 text-sm font-semibold text-white">
              Strategy table
            </h3>
            <p className="mb-2 text-[11px] text-slate-500">
              Sorted by slip hit (ROI as tie-break). A rare long-shot can show
              huge +ROI while almost never clearing — that is not a Sportsbet
              price. Prefer decent hit rate first, then ROI.
            </p>
            <div className="overflow-x-auto rounded-lg border border-surface-border">
              <table className="w-full min-w-[36rem] text-left text-xs">
                <thead className="bg-surface text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Strategy</th>
                    <th className="px-3 py-2 font-medium">N</th>
                    <th className="px-3 py-2 font-medium">Slip hit</th>
                    <th className="px-3 py-2 font-medium">Leg hit</th>
                    <th className="px-3 py-2 font-medium">Avg model</th>
                    <th className="px-3 py-2 font-medium">Flat ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {[...filteredStrategies]
                    .sort((a, b) => {
                      const hit = (b.slipHitRate ?? 0) - (a.slipHitRate ?? 0);
                      if (hit !== 0) return hit;
                      return (b.flatRoi ?? -999) - (a.flatRoi ?? -999);
                    })
                    .map((s) => {
                      const isDead =
                        s.slips >= 20 &&
                        (s.slipHitRate ?? 0) === 0 &&
                        (s.flatRoi ?? 0) <= -0.99;
                      return (
                        <tr
                          key={s.strategyKey}
                          className={`border-t border-surface-border/60 ${
                            isDead ? "opacity-40" : ""
                          }`}
                        >
                          <td className="px-3 py-2 text-slate-200">{s.label}</td>
                          <td className="px-3 py-2 tabular-nums text-slate-400">
                            {s.slips}
                          </td>
                          <td className="px-3 py-2 tabular-nums font-medium text-white">
                            {pct(s.slipHitRate)}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-slate-300">
                            {pct(s.legHitRate)}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-slate-400">
                            {pct(s.avgModelledChance)}
                          </td>
                          <td
                            className={`px-3 py-2 tabular-nums ${
                              (s.flatRoi ?? 0) >= 0
                                ? "text-accent-win"
                                : "text-accent-loss"
                            }`}
                          >
                            {roiPct(s.flatRoi)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
          </div>
          </CollapsibleSection>
        </>
      ) : null}
    </div>
  );
}

const tooltipStyle = {
  background: "#131a26",
  border: "1px solid #1f2a3a",
  borderRadius: 8,
  fontSize: 12,
};

function LegTicks({ active }: { active: number }) {
  const nums = Array.from(
    { length: MAX_LEGS - MIN_LEGS + 1 },
    (_, i) => MIN_LEGS + i,
  );
  return (
    <div className="mt-0.5 flex justify-between text-[9px] tabular-nums leading-none">
      {nums.map((n) => (
        <span
          key={n}
          className={n === active ? "font-semibold text-sky-400" : "text-slate-600"}
        >
          {n}
        </span>
      ))}
    </div>
  );
}

function ChartBlock({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="text-[11px] text-slate-500">{subtitle}</p>
      </div>
      <div className="rounded-lg border border-surface-border bg-surface/40 p-2">
        {children}
      </div>
    </div>
  );
}

type ContextTab = "teams" | "venues" | "matchups" | "players";

function ContextExplorer({ context }: { context: BacktestContext | undefined }) {
  const [tab, setTab] = useState<ContextTab>("teams");

  if (!context) return null;
  const hasAny =
    context.byTeam.length > 0 ||
    context.byVenue.length > 0 ||
    context.byMatchup.length > 0 ||
    context.byPlayerTeam.length > 0;
  if (!hasAny) return null;

  const tabs: { id: ContextTab; label: string }[] = [
    { id: "teams", label: "By team" },
    { id: "venues", label: "By oval" },
    { id: "matchups", label: "H2H" },
    { id: "players", label: "Player clubs" },
  ];

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-white">
          Team · oval · matchups
        </h3>
        <p className="text-[11px] text-slate-500">
          Whole selected run (not market/leg filters).{" "}
          <span className="text-slate-400">By team</span> = if you only bet
          games involving that club.{" "}
          <span className="text-slate-400">Player clubs</span> = leg hit rate
          for that club&apos;s players.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
              tab === t.id
                ? "border-accent/60 bg-accent/15 text-accent"
                : "border-surface-border text-slate-500 hover:text-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "teams" ? (
        <div className="overflow-x-auto rounded-lg border border-surface-border">
          <table className="w-full min-w-[40rem] text-left text-xs">
            <thead className="bg-surface text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Team</th>
                <th className="px-3 py-2 font-medium">Games</th>
                <th className="px-3 py-2 font-medium">Slip hit</th>
                <th className="px-3 py-2 font-medium">Flat ROI</th>
                <th className="px-3 py-2 font-medium">Home ROI</th>
                <th className="px-3 py-2 font-medium">Away ROI</th>
              </tr>
            </thead>
            <tbody>
              {context.byTeam.map((t) => (
                <tr
                  key={t.team}
                  className="border-t border-surface-border/60"
                >
                  <td className="px-3 py-2 text-slate-200">{t.team}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-400">
                    {t.games}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-white">
                    {pct(t.slipHitRate)}
                    <span className="ml-1 text-slate-600">
                      ({t.slipHits}/{t.slips})
                    </span>
                  </td>
                  <td
                    className={`px-3 py-2 tabular-nums ${
                      (t.flatRoi ?? 0) >= 0
                        ? "text-accent-win"
                        : "text-accent-loss"
                    }`}
                  >
                    {roiPct(t.flatRoi)}
                  </td>
                  <td
                    className={`px-3 py-2 tabular-nums ${
                      (t.homeRoi ?? 0) >= 0
                        ? "text-accent-win"
                        : "text-accent-loss"
                    }`}
                  >
                    {roiPct(t.homeRoi)}
                  </td>
                  <td
                    className={`px-3 py-2 tabular-nums ${
                      (t.awayRoi ?? 0) >= 0
                        ? "text-accent-win"
                        : "text-accent-loss"
                    }`}
                  >
                    {roiPct(t.awayRoi)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "venues" ? (
        <div className="overflow-x-auto rounded-lg border border-surface-border">
          <table className="w-full min-w-[32rem] text-left text-xs">
            <thead className="bg-surface text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Oval</th>
                <th className="px-3 py-2 font-medium">Games</th>
                <th className="px-3 py-2 font-medium">Slip hit</th>
                <th className="px-3 py-2 font-medium">Flat ROI</th>
              </tr>
            </thead>
            <tbody>
              {context.byVenue.map((v) => (
                <tr
                  key={v.venue}
                  className="border-t border-surface-border/60"
                >
                  <td className="px-3 py-2 text-slate-200">{v.venue}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-400">
                    {v.games}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-white">
                    {pct(v.slipHitRate)}
                    <span className="ml-1 text-slate-600">
                      ({v.slipHits}/{v.slips})
                    </span>
                  </td>
                  <td
                    className={`px-3 py-2 tabular-nums ${
                      (v.flatRoi ?? 0) >= 0
                        ? "text-accent-win"
                        : "text-accent-loss"
                    }`}
                  >
                    {roiPct(v.flatRoi)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "matchups" ? (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500">
            Use the club buttons above (tap two teams) for H2H legs. Table below
            is slip ROI by fixture in the current scope.
          </p>
          <div className="overflow-x-auto rounded-lg border border-surface-border">
            <table className="w-full min-w-[36rem] text-left text-xs">
              <thead className="bg-surface text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Fixture</th>
                  <th className="px-3 py-2 font-medium">Meetings</th>
                  <th className="px-3 py-2 font-medium">Slip hit</th>
                  <th className="px-3 py-2 font-medium">Flat ROI</th>
                </tr>
              </thead>
              <tbody>
                {context.byMatchup.slice(0, 40).map((m) => (
                  <tr
                    key={m.label}
                    className="border-t border-surface-border/60"
                  >
                    <td className="px-3 py-2 text-slate-200">{m.label}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-400">
                      {m.games}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-white">
                      {pct(m.slipHitRate)}
                      <span className="ml-1 text-slate-600">
                        ({m.slipHits}/{m.slips})
                      </span>
                    </td>
                    <td
                      className={`px-3 py-2 tabular-nums ${
                        (m.flatRoi ?? 0) >= 0
                          ? "text-accent-win"
                          : "text-accent-loss"
                      }`}
                    >
                      {roiPct(m.flatRoi)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "players" ? (
        <div className="overflow-x-auto rounded-lg border border-surface-border">
          <table className="w-full min-w-[28rem] text-left text-xs">
            <thead className="bg-surface text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Club</th>
                <th className="px-3 py-2 font-medium">Legs</th>
                <th className="px-3 py-2 font-medium">Leg hit</th>
              </tr>
            </thead>
            <tbody>
              {context.byPlayerTeam.map((t) => (
                <tr
                  key={t.team}
                  className="border-t border-surface-border/60"
                >
                  <td className="px-3 py-2 text-slate-200">{t.team}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-400">
                    {t.legs.toLocaleString("en-AU")}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-white">
                    {pct(t.hitRate)}
                    <span className="ml-1 text-slate-600">
                      ({t.hits}/{t.legs})
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
