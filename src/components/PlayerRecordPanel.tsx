"use client";

import { useMemo, useState } from "react";

import type { PlayerBetRecord } from "@/lib/data/bets";
import { floorStat, targetLabel } from "@/lib/format";

type StatFilter = "all" | "disposals" | "goals" | "tackles" | "marks";
type SortMode = "volume" | "rate" | "trouble" | "recent-miss";

const STAT_FILTERS: { key: StatFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "disposals", label: "Disposals" },
  { key: "goals", label: "Goals" },
  { key: "tackles", label: "Tackles" },
  { key: "marks", label: "Marks" },
];

const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: "volume", label: "Most backed" },
  { key: "rate", label: "Best hit rate" },
  { key: "trouble", label: "Worst hit rate" },
  { key: "recent-miss", label: "Last missed" },
];

function hitRate(r: PlayerBetRecord): number {
  return r.bets > 0 ? r.hits / r.bets : 0;
}

function statSummary(records: PlayerBetRecord[], stat: string) {
  const rows = records.filter((r) => r.statType === stat);
  const bets = rows.reduce((n, r) => n + r.bets, 0);
  const hits = rows.reduce((n, r) => n + r.hits, 0);
  return { rows: rows.length, bets, hits, rate: bets > 0 ? hits / bets : null };
}

export function PlayerRecordPanel({ records }: { records: PlayerBetRecord[] }) {
  const [statFilter, setStatFilter] = useState<StatFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("volume");

  const summaries = useMemo(
    () =>
      (["disposals", "goals", "tackles", "marks"] as const).map((s) => ({
        stat: s,
        ...statSummary(records, s),
      })),
    [records],
  );

  const filtered = useMemo(() => {
    let rows =
      statFilter === "all"
        ? [...records]
        : records.filter((r) => r.statType === statFilter);

    rows.sort((a, b) => {
      switch (sortMode) {
        case "rate":
          return (
            hitRate(b) - hitRate(a) ||
            b.bets - a.bets ||
            a.playerName.localeCompare(b.playerName)
          );
        case "trouble":
          return (
            hitRate(a) - hitRate(b) ||
            b.bets - a.bets ||
            a.playerName.localeCompare(b.playerName)
          );
        case "recent-miss":
          if (a.lastResult !== b.lastResult) {
            return a.lastResult === "miss" ? -1 : 1;
          }
          return b.bets - a.bets || a.playerName.localeCompare(b.playerName);
        default:
          return b.bets - a.bets || a.playerName.localeCompare(b.playerName);
      }
    });
    return rows;
  }, [records, statFilter, sortMode]);

  const totalBets = records.reduce((n, r) => n + r.bets, 0);
  const totalHits = records.reduce((n, r) => n + r.hits, 0);

  if (records.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No settled legs yet. Once your bets are graded the morning after each
        game, every player you backed shows up here with their hit rate, the
        average line you took vs what they actually got, and how they went last
        time.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {summaries.map((s) => (
          <button
            key={s.stat}
            type="button"
            onClick={() => setStatFilter(s.stat)}
            className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
              statFilter === s.stat
                ? "border-accent/50 bg-accent/10"
                : "border-surface-border bg-surface/40 hover:border-slate-600"
            }`}
          >
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 capitalize">
              {s.stat}
            </div>
            <div className="mt-0.5 text-lg font-bold tabular-nums text-white">
              {s.bets === 0 ? "—" : `${Math.round((s.rate ?? 0) * 100)}%`}
            </div>
            <div className="text-[11px] text-slate-500">
              {s.bets === 0 ? "no legs" : `${s.hits}/${s.bets} legs · ${s.rows} players`}
            </div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          Overall{" "}
          <span className="font-semibold text-slate-300">
            {totalHits}/{totalBets}
          </span>{" "}
          legs hit ({totalBets > 0 ? Math.round((totalHits / totalBets) * 100) : 0}%)
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {STAT_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatFilter(f.key)}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
              statFilter === f.key
                ? "bg-slate-200 text-surface"
                : "border border-surface-border text-slate-400"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {SORT_OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setSortMode(o.key)}
            className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              sortMode === o.key
                ? "bg-slate-700 text-white"
                : "border border-surface-border text-slate-500"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <ul className="max-h-[70vh] space-y-2 overflow-y-auto">
        {filtered.map((r) => (
          <RecordRow key={`${r.playerName}:${r.statType}`} record={r} />
        ))}
      </ul>

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-400">No records for this stat yet.</p>
      ) : null}
    </div>
  );
}

function RecordRow({ record: r }: { record: PlayerBetRecord }) {
  const rate = hitRate(r);
  const pct = Math.round(rate * 100);
  const barColor =
    pct >= 70 ? "bg-accent-win" : pct >= 45 ? "bg-accent-pending" : "bg-accent-loss";

  return (
    <li className="rounded-lg border border-surface-border/60 bg-surface/30 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{r.playerName}</div>
          <div className="text-[11px] capitalize text-slate-500">{r.statType}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-bold tabular-nums text-white">
            {r.hits}/{r.bets}
          </div>
          <div
            className={`text-[11px] font-medium ${
              pct >= 70 ? "text-accent-win" : pct < 45 ? "text-accent-loss" : "text-accent-pending"
            }`}
          >
            {pct}%
          </div>
        </div>
      </div>

      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-slate-400">
        <span>
          Avg line{" "}
          <span className="font-medium text-slate-300">{floorStat(r.avgLine)}</span>
          {r.avgActual != null ? (
            <>
              {" "}
              · got{" "}
              <span className="font-medium text-slate-300">{floorStat(r.avgActual)}</span>
            </>
          ) : null}
        </span>
        <span>
          Last{" "}
          <span className="text-slate-300">{targetLabel(r.lastLine)}</span>
          {" → "}
          <span
            className={
              r.lastResult === "hit" ? "font-medium text-accent-win" : "font-medium text-accent-loss"
            }
          >
            {r.lastActual ?? "—"} {r.lastResult === "hit" ? "✓" : "✗"}
          </span>
        </span>
      </div>
    </li>
  );
}
