"use client";

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

import type { BacktestLabData } from "@/lib/data/backtest";

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n * 1000) / 10}%`;
}

function roiPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Math.round(n * 1000) / 10;
  return `${v > 0 ? "+" : ""}${v}%`;
}

export function StrategyLabPanel({ data }: { data: BacktestLabData }) {
  if (!data.run) {
    return (
      <div className="space-y-3 text-sm text-slate-400">
        <p>
          No backtest runs yet. After migrating, smoke-test then full seasons:
        </p>
        <pre className="overflow-x-auto rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-300">
{`npm run db:migrate
npm run backtest -- --seasons=2026 --max-games=3
npm run backtest -- --seasons=2024,2025,2026`}
        </pre>
        <p className="text-xs text-slate-500">
          Walk-forward uses AFL Tables form before each game (players who
          played that day). Lines are model rungs — not historical Sportsbet
          prices. Full 3-season runs take a long time; use --resume=ID to
          continue.
        </p>
      </div>
    );
  }

  const run = data.run;
  const leaderboard = data.strategies.map((s) => ({
    key: s.strategyKey,
    label: s.label,
    slipHit: s.slipHitRate != null ? Math.round(s.slipHitRate * 1000) / 10 : 0,
    legHit: s.legHitRate != null ? Math.round(s.legHitRate * 1000) / 10 : 0,
    modelled:
      s.avgModelledChance != null ? Math.round(s.avgModelledChance * 1000) / 10 : 0,
    roi: s.flatRoi != null ? Math.round(s.flatRoi * 1000) / 10 : 0,
    n: s.slips,
  }));

  const byLegCount = [3, 6, 10].map((legs) => {
    const rows = data.strategies.filter((s) => s.legCount === legs);
    const slips = rows.reduce((a, r) => a + r.slips, 0);
    const hits = rows.reduce((a, r) => a + r.slipHits, 0);
    return {
      legs: `${legs} legs`,
      slipHit: slips > 0 ? Math.round((hits / slips) * 1000) / 10 : 0,
      n: slips,
    };
  });

  const focuses = ["disposals", "goals", "marks", "tackles", "any"];
  const byFocus = focuses.map((focus) => {
    const rows = data.strategies.filter((s) => s.focus === focus);
    const slips = rows.reduce((a, r) => a + r.slips, 0);
    const hits = rows.reduce((a, r) => a + r.slipHits, 0);
    return {
      focus,
      slipHit: slips > 0 ? Math.round((hits / slips) * 1000) / 10 : 0,
      n: slips,
    };
  });

  const seasons = [...new Set(data.bySeason.map((r) => r.season))].sort();
  const seasonChart = seasons.map((season) => {
    const row: Record<string, string | number> = { season: String(season) };
    for (const focus of ["disposals", "goals", "any"]) {
      const slice = data.bySeason.filter(
        (r) => r.season === season && r.strategyKey.startsWith(`${focus}_`),
      );
      const slips = slice.reduce((a, r) => a + r.slips, 0);
      const hits = slice.reduce((a, r) => a + r.slipHits, 0);
      row[focus] = slips > 0 ? Math.round((hits / slips) * 1000) / 10 : 0;
    }
    return row;
  });

  const calibration = data.calibration.map((b) => ({
    modelled: Math.round(b.modelled * 100),
    actual:
      b.actualHitRate != null ? Math.round(b.actualHitRate * 1000) / 10 : null,
    n: b.slips,
  }));

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-surface-border bg-surface/40 px-3 py-2 text-sm text-slate-300">
        <div className="font-medium text-white">{run.label}</div>
        <div className="mt-0.5 text-xs text-slate-500">
          Run #{run.id} · {run.status} · seasons {(run.seasons ?? []).join(", ")} ·{" "}
          {run.gamesProcessed} games · {run.slipsWritten} slips
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Slip hit rate = whole multi cleared. ROI = flat $1 at estimated model
          odds (not Sportsbet). Prefer strategies with larger N.
        </p>
      </div>

      <ChartBlock title="Slip hit rate by strategy" subtitle="Main leaderboard">
        <ResponsiveContainer width="100%" height={Math.max(280, leaderboard.length * 28)}>
          <BarChart data={leaderboard} layout="vertical" margin={{ left: 8, right: 16 }}>
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
            <Bar dataKey="slipHit" fill="#38bdf8" name="Slip hit %" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartBlock>

      <div className="grid gap-4 sm:grid-cols-2">
        <ChartBlock title="By leg count" subtitle="3 vs 6 vs 10">
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

        <ChartBlock title="By market" subtitle="Stat focus">
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
        <ChartBlock title="Slip hit by season" subtitle="Disposals / goals / any">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={seasonChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2a3a" />
              <XAxis dataKey="season" stroke="#64748b" fontSize={11} />
              <YAxis unit="%" stroke="#64748b" fontSize={11} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Line type="monotone" dataKey="disposals" stroke="#38bdf8" strokeWidth={2} />
              <Line type="monotone" dataKey="goals" stroke="#f87171" strokeWidth={2} />
              <Line type="monotone" dataKey="any" stroke="#a78bfa" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ChartBlock>
      ) : null}

      {calibration.length > 0 ? (
        <ChartBlock
          title="Calibration"
          subtitle="Modelled slip chance vs actual hit rate"
        >
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={calibration}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2a3a" />
              <XAxis
                dataKey="modelled"
                unit="%"
                stroke="#64748b"
                fontSize={11}
                label={{ value: "Modelled", position: "insideBottom", offset: -2, fill: "#64748b" }}
              />
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

      <div>
        <h3 className="mb-2 text-sm font-semibold text-white">Strategy table</h3>
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
              {data.strategies.map((s) => (
                <tr key={s.strategyKey} className="border-t border-surface-border/60">
                  <td className="px-3 py-2 text-slate-200">{s.label}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-400">{s.slips}</td>
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
                      (s.flatRoi ?? 0) >= 0 ? "text-accent-win" : "text-accent-loss"
                    }`}
                  >
                    {roiPct(s.flatRoi)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const tooltipStyle = {
  background: "#131a26",
  border: "1px solid #1f2a3a",
  borderRadius: 8,
  fontSize: 12,
};

function ChartBlock({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="text-[11px] text-slate-500">{subtitle}</p>
      </div>
      <div className="rounded-lg border border-surface-border bg-surface/30 p-2">
        {children}
      </div>
    </div>
  );
}
