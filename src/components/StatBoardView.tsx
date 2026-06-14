"use client";

import { useState } from "react";

import { FormChart } from "@/components/charts/FormChart";
import type { StatType } from "@/db/schema";
import { teamColors } from "@/lib/afl/teamColors";
import type { PlayerStatRow, StatBoard } from "@/lib/data/statboard";

const STAT_TABS: { key: StatType; label: string }[] = [
  { key: "disposals", label: "Disposals" },
  { key: "marks", label: "Marks" },
  { key: "tackles", label: "Tackles" },
  { key: "goals", label: "Goals" },
];

function fmt(n: number | null): string {
  return n == null ? "—" : n.toFixed(1);
}

export function StatBoardView({ board }: { board: StatBoard }) {
  const [stat, setStat] = useState<StatType>("disposals");
  const [team, setTeam] = useState<string>("all");

  const all = board.byStat[stat].filter((r) => team === "all" || r.team === team);
  const lined = all.filter((r) => r.line != null);
  const rows = lined.length > 0 ? lined : all;

  return (
    <div className="space-y-3">
      {/* Stat tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STAT_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStat(t.key)}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${
              stat === t.key
                ? "bg-accent text-surface"
                : "bg-surface-card text-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Team filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {["all", board.home, board.away].map((t) => (
          <button
            key={t}
            onClick={() => setTeam(t)}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
              team === t
                ? "bg-slate-200 text-surface"
                : "border border-surface-border text-slate-300"
            }`}
          >
            {t === "all" ? "All players" : t}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No players for this filter.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <PlayerStatCard key={r.playerId} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerStatCard({ row }: { row: PlayerStatRow }) {
  const c = teamColors(row.team);
  const hasCall = row.prediction != null && row.line != null;
  const over = hasCall ? row.prediction! > row.line! : null;
  // Last 5, displayed oldest -> newest with the most recent highlighted.
  const last5 = row.recentForm.slice(0, 5).reverse();

  return (
    <div className="card">
      <div className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-bold"
          style={{ background: c.bg, color: c.fg }}
        >
          {row.jumper ?? "–"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-white">{row.name}</div>
          <div className="text-xs text-slate-400">
            {row.team}
            {row.seasonAvg != null ? ` · Season avg ${row.seasonAvg.toFixed(1)}` : ""}
          </div>
        </div>
        <div className="text-right">
          {hasCall ? (
            <>
              <div
                className={`text-sm font-bold ${
                  over ? "text-accent-win" : "text-accent-loss"
                }`}
              >
                {over ? "OVER" : "UNDER"} {fmt(row.prediction)}
              </div>
              <div className="text-xs text-slate-400">
                Line {row.line}
                {row.edge != null ? (
                  <span className={over ? "text-accent-win" : "text-accent-loss"}>
                    {" "}
                    ({row.edge > 0 ? "+" : ""}
                    {row.edge.toFixed(1)})
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-300">
              Pred {fmt(row.prediction)}
              <div className="text-xs text-slate-500">no line</div>
            </div>
          )}
        </div>
      </div>

      {/* Last 5 form chips */}
      {last5.length > 0 ? (
        <div className="mt-3 flex items-center gap-1">
          <span className="mr-1 text-[11px] uppercase tracking-wide text-slate-500">
            Last 5
          </span>
          {last5.map((v, i) => {
            const newest = i === last5.length - 1;
            return (
              <span
                key={i}
                className={`inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded px-1.5 text-xs ${
                  newest
                    ? "bg-accent/20 font-semibold text-white ring-1 ring-accent"
                    : "bg-surface text-slate-300"
                }`}
              >
                {v}
              </span>
            );
          })}
          {row.hitRate != null ? (
            <span className="ml-auto text-[11px] text-slate-400">
              Hit{" "}
              <span className="font-semibold text-white">
                {Math.round(row.hitRate * 100)}%
              </span>
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Recent-form chart */}
      {row.recentForm.length > 1 ? (
        <div className="mt-2">
          <FormChart form={row.recentForm} line={row.line} />
        </div>
      ) : null}

      {/* Actual once settled */}
      {row.actual != null ? (
        <div className="mt-1 text-xs text-slate-400">
          Actual: <span className="font-semibold text-white">{row.actual}</span>
          {row.line != null ? (
            <span className={row.actual > row.line ? " text-accent-win" : " text-accent-loss"}>
              {" "}
              {row.actual > row.line ? "over" : "under"} the line
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Model detail (de-emphasised) */}
      <div className="mt-1 text-[11px] text-slate-500">
        Models · A {fmt(row.models.A)} · B {fmt(row.models.B)} · C {fmt(row.models.C)}
      </div>
    </div>
  );
}
