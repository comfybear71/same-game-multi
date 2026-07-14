"use client";

import { useState } from "react";
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

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Math.round(n * 100) / 100;
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
}

function pct(hits: number, total: number): string {
  if (total <= 0) return "—";
  return `${Math.round((hits / total) * 1000) / 10}%`;
}

export function BankrollSimPanel({ initial }: { initial: BankrollSimView }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rerun() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/system/bankroll", {
        method: "POST",
        body: "{}",
      });
      const json = (await res.json()) as BankrollSimView & {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? `Failed (${res.status})`);
      }
      setData({
        run: json.run,
        checkpoints: json.checkpoints ?? [],
        rounds: json.rounds ?? [],
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const run = data.run;
  const equity = data.rounds.map((r) => ({
    label: `${r.season} R${r.round}`,
    bank: Math.round(r.bankAfter * 100) / 100,
    net: Math.round((r.bankAfter - r.capitalInjected) * 100) / 100,
  }));

  if (!run) {
    return (
      <div className="space-y-3 text-sm text-slate-400">
        <p>
          No dollar sim yet. Needs a Strategy lab run with slips (e.g.
          full-2024-2026), then re-run the bankroll walk-forward.
        </p>
        <button
          type="button"
          onClick={() => void rerun()}
          disabled={busy}
          className="rounded-md border border-surface-border px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {busy ? "Running…" : "Run dollar sim from lab"}
        </button>
        {error ? <p className="text-xs text-accent-loss">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-300">
            {run.label}{" "}
            <span className="text-slate-500">
              · source lab #{run.sourceRunId} · {run.status}
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Unit ${run.params.startUnit} → grow {(run.params.growPct * 100).toFixed(0)}%
            on round profit · top-up ${run.params.topUp} if no hits / underwater ·
            cap ${run.params.unitCap} · top {run.params.portfolioK} strategies
          </p>
          {run.rationale ? (
            <p className="mt-2 text-xs text-slate-400">{run.rationale}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void rerun()}
          disabled={busy}
          className="rounded-md border border-surface-border px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {busy ? "Running…" : "Re-run dollar sim"}
        </button>
      </div>

      {error ? <p className="text-xs text-accent-loss">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {data.checkpoints.map((c) => (
          <div
            key={c.season}
            className="rounded-lg border border-surface-border bg-surface/40 px-3 py-2"
          >
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              {c.season === 2026 ? "YTD " : "End "}
              {c.season}
              {c.afterRound != null ? ` · R${c.afterRound}` : ""}
            </div>
            <div className="mt-1 text-lg font-semibold text-white">
              {money(c.bank)}
            </div>
            <div
              className={`text-xs tabular-nums ${
                c.netProfit >= 0 ? "text-accent-win" : "text-accent-loss"
              }`}
            >
              net {money(c.netProfit)}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              unit {money(c.unit)} · capital in {money(c.capitalInjected)}
              <br />
              tickets {pct(c.ticketsHit, c.ticketsPlaced)} hit · {c.gamesPlayed}{" "}
              games
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Final bank" value={money(run.finalBank)} />
        <Stat
          label="Net profit"
          value={money(run.netProfit)}
          tone={(run.netProfit ?? 0) >= 0 ? "win" : "loss"}
        />
        <Stat label="Capital injected" value={money(run.capitalInjected)} />
        <Stat
          label="Ticket hit"
          value={`${run.ticketsHit}/${run.ticketsPlaced} (${pct(run.ticketsHit, run.ticketsPlaced)})`}
        />
      </div>

      {equity.length > 0 ? (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-white">Bank by round</h3>
          <p className="mb-2 text-[11px] text-slate-500">
            Cash after each round (includes capital top-ups to fund stakes).
          </p>
          <div className="rounded-lg border border-surface-border bg-surface/30 p-2">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={equity}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2a3a" />
                <XAxis
                  dataKey="label"
                  stroke="#64748b"
                  fontSize={9}
                  interval="preserveStartEnd"
                />
                <YAxis stroke="#64748b" fontSize={11} />
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
                  name="Bank $"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      {run.learnedTop.length > 0 ? (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-white">What we learned</h3>
          <p className="mb-2 text-[11px] text-slate-500">
            Final walk-forward policy after the last round (cold start could not
            know this on Opening Round 2024).
          </p>
          <ol className="space-y-1 text-xs">
            {run.learnedTop.map((s) => (
              <li key={s.strategyKey} className="flex flex-wrap gap-2 text-slate-300">
                <span className="tabular-nums text-slate-500">{s.rank}.</span>
                <span className="text-white">{s.label}</span>
                <span className="capitalize text-slate-500">{s.tier}</span>
                <span className="tabular-nums text-slate-400">
                  {s.slipHitRate != null
                    ? `${Math.round(s.slipHitRate * 1000) / 10}% hit`
                    : "—"}
                  {s.flatRoi != null
                    ? ` · ROI ${Math.round(s.flatRoi * 1000) / 10}%`
                    : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "win" | "loss";
}) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface/40 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`mt-0.5 text-sm font-semibold tabular-nums ${
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
