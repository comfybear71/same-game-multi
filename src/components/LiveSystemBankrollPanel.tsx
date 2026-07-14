"use client";

import { useState } from "react";

import type { LiveSystemBankroll } from "@/lib/system/liveBankroll";

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Math.round(n * 100) / 100;
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
}

export function LiveSystemBankrollPanel({
  initial,
}: {
  initial: LiveSystemBankroll;
}) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/system/live-bankroll?season=${data.season}`);
      const json = (await res.json()) as LiveSystemBankroll & {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? `Failed (${res.status})`);
      }
      setData({
        season: json.season,
        ticketsTracked: json.ticketsTracked,
        ticketsGraded: json.ticketsGraded,
        ticketsHit: json.ticketsHit,
        ticketsPending: json.ticketsPending,
        totalStaked: json.totalStaked,
        openStake: json.openStake,
        settledStake: json.settledStake,
        totalReturned: json.totalReturned,
        netProfit: json.netProfit,
        tickets: json.tickets ?? [],
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const hitPct =
    data.ticketsGraded > 0
      ? `${Math.round((data.ticketsHit / data.ticketsGraded) * 1000) / 10}%`
      : "—";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-300">
            Season {data.season} · real dollars on System book tickets
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Enter stake + bookie odds on each game&apos;s System book after you
            place. Separate from personal Multis ROI and from the historical sim.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="rounded-md border border-surface-border px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {busy ? "Refreshing…" : "Refresh tally"}
        </button>
      </div>

      {error ? <p className="text-xs text-accent-loss">{error}</p> : null}

      {data.ticketsTracked === 0 ? (
        <p className="text-sm text-slate-500">
          No stakes logged yet. Generate a System book on a game, place the
          tickets, then save stake + odds on each slip.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Net P&L" value={money(data.netProfit)} tone={data.netProfit >= 0 ? "win" : "loss"} />
            <Stat label="Returned" value={money(data.totalReturned)} />
            <Stat label="Settled stake" value={money(data.settledStake)} />
            <Stat label="Open stake" value={money(data.openStake)} />
          </div>
          <p className="text-xs text-slate-500">
            {data.ticketsHit}/{data.ticketsGraded} graded hit ({hitPct}) ·{" "}
            {data.ticketsPending} pending · {data.ticketsTracked} tickets tracked ·
            total staked {money(data.totalStaked)}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1 pr-2 font-medium">Fixture</th>
                  <th className="py-1 pr-2 font-medium">Strategy</th>
                  <th className="py-1 pr-2 font-medium">Stake</th>
                  <th className="py-1 pr-2 font-medium">Odds</th>
                  <th className="py-1 pr-2 font-medium">Result</th>
                  <th className="py-1 font-medium">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {data.tickets.map((t) => (
                  <tr
                    key={t.id}
                    className="border-t border-surface-border/50 text-slate-300"
                  >
                    <td className="py-1.5 pr-2">
                      <a
                        href={`/games/${t.gameId}`}
                        className="text-slate-200 hover:text-accent"
                      >
                        {t.home} v {t.away}
                      </a>
                      <span className="ml-1 text-slate-600">
                        R{t.round ?? "—"}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-white">{t.label}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{money(t.stake)}</td>
                    <td className="py-1.5 pr-2 tabular-nums">
                      {t.placedOdds != null ? t.placedOdds.toFixed(2) : "—"}
                    </td>
                    <td className="py-1.5 pr-2">
                      {t.slipHit === true ? (
                        <span className="text-accent-win">HIT</span>
                      ) : t.slipHit === false ? (
                        <span className="text-accent-loss">MISS</span>
                      ) : (
                        <span className="text-slate-500">open</span>
                      )}
                    </td>
                    <td
                      className={`py-1.5 tabular-nums ${
                        t.pnl == null
                          ? "text-slate-500"
                          : t.pnl >= 0
                            ? "text-accent-win"
                            : "text-accent-loss"
                      }`}
                    >
                      {t.pnl == null ? "—" : money(t.pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
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
