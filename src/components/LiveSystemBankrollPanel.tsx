"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import type { EquityPoint } from "@/components/LiveSystemEquityChart";
import type {
  LiveSystemBankroll,
  LiveSystemTicketRow,
} from "@/lib/system/liveBankroll";
import { formatAwst } from "@/lib/time";

/** Recharts needs a real width — skip SSR so cold start / soft nav don't blank. */
const EquityChart = dynamic(
  () => import("@/components/LiveSystemEquityChart").then((m) => m.LiveSystemEquityChart),
  { ssr: false, loading: () => null },
);

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Math.round(n * 100) / 100;
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
}

function roiPct(net: number, settledStake: number): string {
  if (settledStake <= 0) return "—";
  const v = Math.round((net / settledStake) * 1000) / 10;
  return `${v > 0 ? "+" : ""}${v}%`;
}

/** Cumulative P&L / ROI after each graded ticket (kickoff order). */
function buildEquityCurve(tickets: LiveSystemTicketRow[]): EquityPoint[] {
  const graded = tickets
    .filter((t) => t.pnl != null)
    .sort((a, b) => {
      const at = new Date(a.commenceTime).getTime();
      const bt = new Date(b.commenceTime).getTime();
      return at - bt || a.id - b.id;
    });

  let cum = 0;
  let settled = 0;
  return graded.map((t, i) => {
    cum += t.pnl!;
    settled += t.stake ?? 0;
    return {
      n: i + 1,
      label: `#${i + 1}`,
      game: `${t.home} v ${t.away}`,
      strategy: t.label,
      pnl: Math.round(cum * 100) / 100,
      roi: settled > 0 ? Math.round((cum / settled) * 1000) / 10 : 0,
    };
  });
}

interface GameGroup {
  gameId: number;
  home: string;
  away: string;
  round: number | null;
  commenceTime: Date | string;
  tickets: LiveSystemTicketRow[];
  openStake: number;
  settledStake: number;
  returned: number;
  pending: number;
  graded: number;
  hits: number;
}

interface RoundGroup {
  round: number | null;
  games: GameGroup[];
}

function groupByRoundThenGame(tickets: LiveSystemTicketRow[]): RoundGroup[] {
  const byRound = new Map<number | null, Map<number, GameGroup>>();

  for (const t of tickets) {
    let games = byRound.get(t.round);
    if (!games) {
      games = new Map();
      byRound.set(t.round, games);
    }
    let g = games.get(t.gameId);
    if (!g) {
      g = {
        gameId: t.gameId,
        home: t.home,
        away: t.away,
        round: t.round,
        commenceTime: t.commenceTime,
        tickets: [],
        openStake: 0,
        settledStake: 0,
        returned: 0,
        pending: 0,
        graded: 0,
        hits: 0,
      };
      games.set(t.gameId, g);
    }
    g.tickets.push(t);
    if (t.stake != null && t.stake > 0) {
      if (t.slipHit == null) {
        g.openStake += t.stake;
        g.pending++;
      } else {
        g.settledStake += t.stake;
        g.returned += t.cashReturn;
        g.graded++;
        if (t.slipHit) g.hits++;
      }
    }
  }

  const rounds = [...byRound.entries()].sort((a, b) => {
    const ar = a[0] ?? -1;
    const br = b[0] ?? -1;
    return br - ar; // newest round first
  });

  return rounds.map(([round, games]) => ({
    round,
    games: [...games.values()].sort((a, b) => {
      const at = new Date(a.commenceTime).getTime();
      const bt = new Date(b.commenceTime).getTime();
      return at - bt;
    }),
  }));
}

export function LiveSystemBankrollPanel({
  initial,
}: {
  initial: LiveSystemBankroll;
}) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = groupByRoundThenGame(data.tickets);
  const equity = useMemo(
    () => buildEquityCurve(data.tickets),
    [data.tickets],
  );

  const initialSig = `${initial.season}:${initial.ticketsTracked}:${initial.totalStaked}:${initial.openStake}:${initial.tickets.length}`;

  // Soft nav can reuse this island with stale useState(initial).
  useEffect(() => {
    setData(initial);
  }, [initialSig]); // eslint-disable-line react-hooks/exhaustive-deps -- signature of server props

  async function refresh(season = initial.season) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/system/live-bankroll?season=${season}`, {
        cache: "no-store",
      });
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

  // Cold start / soft nav backup — always re-fetch once mounted.
  useEffect(() => {
    void refresh(initial.season);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / season only
  }, [initial.season]);

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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat
              label="Net P&L"
              value={money(data.netProfit)}
              tone={data.netProfit >= 0 ? "win" : "loss"}
            />
            <Stat
              label="ROI"
              value={roiPct(data.netProfit, data.settledStake)}
              tone={
                data.settledStake <= 0
                  ? undefined
                  : data.netProfit >= 0
                    ? "win"
                    : "loss"
              }
            />
            <Stat label="Returned" value={money(data.totalReturned)} />
            <Stat label="Settled stake" value={money(data.settledStake)} />
            <Stat label="Open stake" value={money(data.openStake)} />
          </div>
          <p className="text-xs text-slate-500">
            {data.ticketsHit}/{data.ticketsGraded} graded hit ({hitPct}) ·{" "}
            {data.ticketsPending} pending · {data.ticketsTracked} tickets
            tracked · total staked {money(data.totalStaked)}
          </p>

          {equity.length > 0 ? (
            <div className="rounded-lg border border-surface-border bg-surface/20 p-3">
              <div className="mb-2">
                <h3 className="text-sm font-medium text-white">
                  Cumulative P&amp;L
                </h3>
                <p className="text-[11px] text-slate-500">
                  After each settled System ticket · ROI on settled stake
                </p>
              </div>
              <EquityChart data={equity} />
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-surface-border/80 px-3 py-2 text-xs text-slate-500">
              P&amp;L / ROI chart appears once tickets settle (HIT/MISS). Open
              stake is tracked above; expand a game for per-ticket detail.
            </p>
          )}

          <div className="space-y-5">
            {groups.map((round) => (
              <section key={round.round ?? "na"} className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Round {round.round ?? "—"}
                </h3>
                {round.games.map((game) => (
                  <GameTicketGroup key={game.gameId} game={game} />
                ))}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function GameTicketGroup({ game }: { game: GameGroup }) {
  const gamePnl = game.graded > 0 ? game.returned - game.settledStake : null;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [game.gameId]);

  return (
    <details
      className="rounded-lg border border-surface-border bg-surface/30"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
        <span className="text-slate-600">▸</span>
        <a
          href={`/games/${game.gameId}`}
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-white hover:text-accent"
        >
          {game.home} v {game.away}
        </a>
        <span className="text-[11px] text-slate-500">
          {formatAwst(game.commenceTime)}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-x-3 text-[11px] text-slate-500">
          {game.pending > 0 ? <span>open {money(game.openStake)}</span> : null}
          {game.graded > 0 ? (
            <span>
              {game.hits}/{game.graded} hit
              {gamePnl != null ? (
                <span
                  className={
                    gamePnl >= 0 ? " text-accent-win" : " text-accent-loss"
                  }
                >
                  {" "}
                  · {money(gamePnl)}
                </span>
              ) : null}
            </span>
          ) : (
            <span>{game.tickets.length} tickets</span>
          )}
        </span>
      </summary>
      <div className="overflow-x-auto border-t border-surface-border/60 px-3 pb-2 pt-1">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1 pr-2 font-medium">Strategy</th>
              <th className="py-1 pr-2 font-medium">Stake</th>
              <th className="py-1 pr-2 font-medium">Odds</th>
              <th className="py-1 pr-2 font-medium">Result</th>
              <th className="py-1 font-medium">P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {game.tickets.map((t) => (
              <tr
                key={t.id}
                className="border-t border-surface-border/40 text-slate-300"
              >
                <td className="py-1.5 pr-2 text-white">
                  {t.label}
                  <span className="ml-1.5 text-[10px] uppercase text-slate-600">
                    {t.tier}
                  </span>
                </td>
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
    </details>
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
