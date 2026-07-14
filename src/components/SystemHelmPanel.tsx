"use client";

import { useState } from "react";

import type { ActivePolicyView } from "@/lib/system/policy";

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n * 1000) / 10}%`;
}

function roiPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Math.round(n * 1000) / 10;
  return `${v > 0 ? "+" : ""}${v}%`;
}

const TIER_CLASS: Record<string, string> = {
  banker: "text-emerald-400",
  balanced: "text-sky-400",
  low: "text-slate-500",
};

export function SystemHelmPanel({
  initial,
}: {
  initial: ActivePolicyView | null;
}) {
  const [policy, setPolicy] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/system/policy", { method: "POST", body: "{}" });
      const json = (await res.json()) as {
        ok?: boolean;
        policy?: ActivePolicyView;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.policy) {
        throw new Error(json.error ?? `Failed (${res.status})`);
      }
      setPolicy(json.policy);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!policy) {
    return (
      <div className="space-y-3 text-sm text-slate-400">
        <p>
          No AI policy yet. Run Strategy lab (full seasons preferred), then refresh
          the helm — it ranks strategies by slip hit rate + flat ROI and steers
          Suggested multi + the System book.
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="rounded-md border border-surface-border px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {busy ? "Refreshing…" : "Refresh from lab"}
        </button>
        {error ? <p className="text-xs text-accent-loss">{error}</p> : null}
      </div>
    );
  }

  const top = policy.weights.strategies.slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-300">
            Default tip:{" "}
            <span className="font-medium text-white">
              {policy.defaults.focus} · {policy.defaults.legCount} legs
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Source: run #{policy.sourceRunId}
            {policy.sourceLabel ? ` (${policy.sourceLabel})` : ""} · updated{" "}
            {new Date(policy.updatedAt).toLocaleString("en-AU", {
              timeZone: "Australia/Perth",
            })}{" "}
            AWST
          </p>
          {policy.rationale ? (
            <p className="mt-2 text-xs text-slate-400">{policy.rationale}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="rounded-md border border-surface-border px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {busy ? "Refreshing…" : "Refresh from lab"}
        </button>
      </div>

      {error ? <p className="text-xs text-accent-loss">{error}</p> : null}

      <div className="overflow-x-auto rounded-lg border border-surface-border">
        <table className="w-full min-w-[28rem] text-left text-xs">
          <thead className="bg-surface text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Strategy</th>
              <th className="px-3 py-2 font-medium">Tier</th>
              <th className="px-3 py-2 font-medium">Slip hit</th>
              <th className="px-3 py-2 font-medium">Flat ROI</th>
              <th className="px-3 py-2 font-medium">N</th>
              <th className="px-3 py-2 font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {top.map((s) => (
              <tr key={s.strategyKey} className="border-t border-surface-border/60">
                <td className="px-3 py-2 tabular-nums text-slate-500">{s.rank}</td>
                <td className="px-3 py-2 text-slate-200">{s.label}</td>
                <td className={`px-3 py-2 capitalize ${TIER_CLASS[s.tier] ?? ""}`}>
                  {s.tier}
                </td>
                <td className="px-3 py-2 tabular-nums text-white">
                  {pct(s.slipHitRate)}
                </td>
                <td
                  className={`px-3 py-2 tabular-nums ${
                    (s.flatRoi ?? 0) >= 0 ? "text-accent-win" : "text-accent-loss"
                  }`}
                >
                  {roiPct(s.flatRoi)}
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-400">{s.slips}</td>
                <td className="px-3 py-2 tabular-nums text-slate-400">
                  {Math.round(s.score * 1000) / 1000}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">
        Top 8 strategies (banker + balanced) are placed as the System book on each
        game — separate from your personal Multis / ROI.
      </p>
    </div>
  );
}
