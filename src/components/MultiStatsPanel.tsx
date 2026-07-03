"use client";

import { useMemo, useState } from "react";

import type { MultiAnalytics, MultiLegGroup } from "@/lib/data/bets";

export function MultiStatsPanel({ analytics }: { analytics: MultiAnalytics }) {
  const [legFilter, setLegFilter] = useState<number | null>(null);

  const rows = useMemo(() => {
    const list = [...analytics.byLegCount].sort((a, b) => a.legCount - b.legCount);
    if (legFilter == null) return list;
    return list.filter((g) => g.legCount === legFilter);
  }, [analytics.byLegCount, legFilter]);

  if (analytics.totalMultis === 0) {
    return (
      <p className="text-sm text-slate-400">
        No multis logged yet. Each slip counts separately by leg count.
      </p>
    );
  }

  const settled = analytics.won + analytics.lost;
  const slipStrike =
    settled > 0 ? Math.round((analytics.won / settled) * 100) : null;

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        {analytics.totalMultis} multis · avg {analytics.avgLegs.toFixed(1).replace(/\.0$/, "")}{" "}
        legs · {analytics.won}W {analytics.lost}L
        {analytics.pending > 0 ? ` · ${analytics.pending} pending` : ""}
        {slipStrike != null ? ` · ${slipStrike}% slip strike` : ""}
      </p>

      <div className="flex flex-wrap gap-1">
        <FilterChip
          active={legFilter === null}
          onClick={() => setLegFilter(null)}
          label="All"
        />
        {analytics.byLegCount.map((g) => (
          <FilterChip
            key={g.legCount}
            active={legFilter === g.legCount}
            onClick={() => setLegFilter(legFilter === g.legCount ? null : g.legCount)}
            label={`${g.legCount} (${g.slips})`}
          />
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left uppercase tracking-wide text-slate-500">
              <th className="py-1 pr-3 font-medium">Legs</th>
              <th className="py-1 pr-3 font-medium">Slips</th>
              <th className="py-1 pr-3 font-medium">W-L</th>
              <th className="py-1 pr-3 font-medium">Legs hit</th>
              <th className="py-1 pr-3 font-medium">ROI</th>
              <th className="py-1 font-medium">Staked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <CompactRow key={g.legCount} group={g} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
        active ? "bg-slate-200 text-surface" : "border border-surface-border text-slate-500"
      }`}
    >
      {label}
    </button>
  );
}

function CompactRow({ group: g }: { group: MultiLegGroup }) {
  const legPct = g.legStrike != null ? Math.round(g.legStrike * 100) : null;
  const roi =
    g.roi == null ? "—" : `${g.roi >= 0 ? "+" : ""}${(g.roi * 100).toFixed(0)}%`;

  return (
    <tr className="border-t border-surface-border/50 text-slate-300">
      <td className="py-1 pr-3 font-semibold tabular-nums text-white">{g.legCount}</td>
      <td className="py-1 pr-3 tabular-nums">
        {g.slips}
        {g.pending > 0 ? <span className="text-slate-600"> ({g.pending}p)</span> : null}
      </td>
      <td className="py-1 pr-3 tabular-nums">
        <span className="text-accent-win">{g.won}</span>
        <span className="text-slate-600">-</span>
        <span className="text-accent-loss">{g.lost}</span>
      </td>
      <td className="py-1 pr-3 tabular-nums">
        {g.legSettled === 0 ? "—" : `${g.legHits}/${g.legSettled}`}
        {legPct != null ? (
          <span className="text-slate-600"> ({legPct}%)</span>
        ) : null}
      </td>
      <td
        className={`py-1 pr-3 tabular-nums ${
          g.roi == null ? "text-slate-600" : g.roi >= 0 ? "text-accent-win" : "text-accent-loss"
        }`}
      >
        {roi}
      </td>
      <td className="py-1 tabular-nums text-slate-500">
        {g.staked > 0 ? `$${g.staked.toFixed(0)}` : "—"}
      </td>
    </tr>
  );
}
