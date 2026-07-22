"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { StatType } from "@/db/schema";
import { teamColors } from "@/lib/afl/teamColors";
import { lineTarget, targetLabel } from "@/lib/format";
import { minLineTarget } from "@/lib/predictions/modelLine";
import { clearProbability } from "@/lib/predictions/probability";
import { MAX_LEGS } from "@/lib/predictions/suggestLimits";
import type { Top10BoardResponse, Top10Row } from "@/lib/predictions/top10Board";

const MARKETS: { key: StatType; label: string; short: string }[] = [
  { key: "disposals", label: "Disposals", short: "Disp" },
  { key: "marks", label: "Marks", short: "Marks" },
  { key: "tackles", label: "Tackles", short: "Tck" },
  { key: "goals", label: "Goals", short: "Goals" },
];

type TicketLeg = Top10Row & { target: number };

function toTicketLeg(row: Top10Row): TicketLeg {
  return { ...row, target: lineTarget(row.line) };
}

function legKey(playerId: number, statType: string): string {
  return `${playerId}:${statType}`;
}

function legConfidence(l: TicketLeg): number {
  return clearProbability({
    prediction: l.prediction,
    line: l.target - 0.5,
    form: l.recentForm ?? [],
  });
}

function combinedChance(legs: TicketLeg[]): number | null {
  if (legs.length === 0) return null;
  return legs.reduce((acc, l) => acc * legConfidence(l), 1);
}

export function Top10BoardPanel({
  gameId,
  round = null,
  embedded = false,
}: {
  gameId: number;
  round?: number | null;
  embedded?: boolean;
}) {
  const router = useRouter();
  const [market, setMarket] = useState<StatType>("disposals");
  const [board, setBoard] = useState<Top10BoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketLeg[]>([]);
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logSuccess, setLogSuccess] = useState<string | null>(null);
  const [totalOdds, setTotalOdds] = useState("");
  const [totalStake, setTotalStake] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/top10`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed to load boards");
      setBoard(json as Top10BoardResponse);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    void load();
  }, [load]);

  const marketBoard = useMemo(
    () => board?.markets.find((m) => m.statType === market) ?? null,
    [board, market],
  );

  const ticketKeys = useMemo(
    () => new Set(ticket.map((l) => legKey(l.playerId, l.statType))),
    [ticket],
  );

  const ticketChance = combinedChance(ticket);

  function toggleRow(row: Top10Row) {
    const key = legKey(row.playerId, row.statType);
    if (ticketKeys.has(key)) {
      setTicket((prev) => prev.filter((l) => legKey(l.playerId, l.statType) !== key));
      return;
    }
    if (ticket.length >= MAX_LEGS) return;
    setTicket((prev) => [...prev, toTicketLeg(row)]);
  }

  function changeTarget(playerId: number, statType: StatType, delta: number) {
    const floor = minLineTarget(statType);
    setTicket((prev) =>
      prev.map((l) => {
        if (l.playerId !== playerId || l.statType !== statType) return l;
        return { ...l, target: Math.max(floor, l.target + delta) };
      }),
    );
  }

  function removeLeg(playerId: number, statType: StatType) {
    setTicket((prev) =>
      prev.filter((l) => !(l.playerId === playerId && l.statType === statType)),
    );
  }

  async function logMulti() {
    if (ticket.length === 0) return;
    setLogging(true);
    setLogError(null);
    setLogSuccess(null);
    try {
      const res = await fetch("/api/bets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gameId,
          round: round ?? undefined,
          totalOdds: totalOdds ? Number(totalOdds) : undefined,
          totalStake: totalStake ? Number(totalStake) : undefined,
          status: "pending",
          legs: ticket.map((l) => ({
            playerName: l.playerName,
            statType: l.statType,
            line: l.target - 0.5,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "save failed");
      setTicket([]);
      setTotalOdds("");
      setLogSuccess(`Saved ${json.legs ?? ticket.length} legs — build another or open Bets.`);
      router.refresh();
    } catch (err) {
      setLogError((err as Error).message);
    } finally {
      setLogging(false);
    }
  }

  const oddsHint =
    board?.oddsSource === "none"
      ? "No harvested odds for this fixture — lines show, prices are — until harvest:odds runs."
      : board?.oddsSource === "snapshots"
        ? "Prices from latest odds snapshot."
        : "Prices from bookmaker_lines fallback.";

  return (
    <section className={`${embedded ? "" : "card "}space-y-4`}>
      {!embedded ? (
        <div>
          <h2 className="text-lg font-semibold text-white">Top 10 boards</h2>
          <p className="text-sm text-slate-400">
            Pick from ranked shortlists — tap a row to add. Default lines sit near season
            avg, not the top rung.
          </p>
        </div>
      ) : null}

      {/* Market tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {MARKETS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMarket(m.key)}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${
              market === m.key
                ? "bg-accent/20 text-accent"
                : "bg-surface text-slate-400 hover:text-slate-200"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading boards…</p>
      ) : error ? (
        <p className="text-sm text-accent-loss">{error}</p>
      ) : !marketBoard ? (
        <p className="text-sm text-slate-400">No predictions for this game yet.</p>
      ) : (
        <>
          <p className="text-[11px] text-slate-500">{oddsHint}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <TeamBoard
              side={marketBoard.home}
              statType={market}
              selectedKeys={ticketKeys}
              onToggle={toggleRow}
              atMax={ticket.length >= MAX_LEGS}
            />
            <TeamBoard
              side={marketBoard.away}
              statType={market}
              selectedKeys={ticketKeys}
              onToggle={toggleRow}
              atMax={ticket.length >= MAX_LEGS}
            />
          </div>
        </>
      )}

      {/* Ticket builder */}
      <div className="rounded-xl border border-surface-border bg-surface/40 p-3 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Your ticket · {ticket.length} leg{ticket.length === 1 ? "" : "s"}
          </div>
          {ticket.length > 0 ? (
            <button
              type="button"
              className="text-[11px] text-slate-500 hover:text-slate-300"
              onClick={() => setTicket([])}
            >
              Clear all
            </button>
          ) : null}
        </div>

        {ticket.length === 0 ? (
          <p className="text-sm text-slate-400">
            Tap players on the boards above to build your multi.
          </p>
        ) : (
          <ul className="space-y-2">
            {ticket.map((l) => {
              const c = teamColors(l.team);
              return (
                <li key={legKey(l.playerId, l.statType)} className="flex items-center gap-3">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs font-bold"
                    style={{ background: c.bg, color: c.fg }}
                  >
                    {l.jumper ?? "–"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{l.playerName}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-400">
                      <span className="capitalize">{l.statType}</span>
                      <span className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          className="flex h-5 w-5 items-center justify-center rounded border border-surface-border text-slate-300 disabled:opacity-40"
                          onClick={() => changeTarget(l.playerId, l.statType, -1)}
                          disabled={l.target <= minLineTarget(l.statType)}
                          aria-label={`Lower ${l.playerName} target`}
                        >
                          −
                        </button>
                        <span className="min-w-[2.5ch] text-center text-sm font-semibold text-slate-200">
                          {l.target}+
                        </span>
                        <button
                          type="button"
                          className="flex h-5 w-5 items-center justify-center rounded border border-surface-border text-slate-300"
                          onClick={() => changeTarget(l.playerId, l.statType, 1)}
                          aria-label={`Raise ${l.playerName} target`}
                        >
                          +
                        </button>
                      </span>
                      {l.odds != null ? <span>· ${l.odds.toFixed(2)}</span> : null}
                      <span className="text-slate-500">
                        · {Math.round(legConfidence(l) * 100)}% model
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-slate-500 hover:text-accent-loss"
                    onClick={() => removeLeg(l.playerId, l.statType)}
                    aria-label={`Remove ${l.playerName}`}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap gap-3 border-t border-surface-border pt-3">
          <label className="block text-sm">
            <span className="text-slate-400">Total odds</span>
            <input
              className="input mt-1 w-24"
              inputMode="decimal"
              placeholder="301"
              value={totalOdds}
              onChange={(e) => setTotalOdds(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Stake $</span>
            <input
              className="input mt-1 w-20"
              inputMode="decimal"
              value={totalStake}
              onChange={(e) => setTotalStake(e.target.value)}
            />
          </label>
        </div>

        {logError ? <p className="text-sm text-accent-loss">{logError}</p> : null}
        {logSuccess ? <p className="text-sm text-accent-win">{logSuccess}</p> : null}

        <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-surface-border bg-surface-card/95 p-3 shadow-lg backdrop-blur sm:bottom-2">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              Ready to log
            </div>
            <div className="mt-0.5 text-sm text-slate-300">
              Modelled chance{" "}
              <span className="font-bold tabular-nums text-white">
                {ticketChance != null ? `${Math.round(ticketChance * 100)}%` : "—"}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="btn shrink-0"
            onClick={() => void logMulti()}
            disabled={logging || ticket.length === 0}
          >
            {logging ? "Logging…" : "Log this multi"}
          </button>
        </div>
      </div>
    </section>
  );
}

function TeamBoard({
  side,
  statType,
  selectedKeys,
  onToggle,
  atMax,
}: {
  side: { team: string; rows: Top10Row[] };
  statType: StatType;
  selectedKeys: Set<string>;
  onToggle: (row: Top10Row) => void;
  atMax: boolean;
}) {
  const c = teamColors(side.team);
  const label = MARKETS.find((m) => m.key === statType)?.short ?? statType;

  return (
    <div className="rounded-xl border border-surface-border overflow-hidden">
      <div
        className="px-3 py-2 text-sm font-semibold text-white"
        style={{ background: `${c.bg}33`, borderBottom: `2px solid ${c.bg}` }}
      >
        {side.team} · Top 10 {label}
      </div>
      {side.rows.length === 0 ? (
        <p className="p-3 text-sm text-slate-500">No {statType} projections yet.</p>
      ) : (
        <ul className="divide-y divide-surface-border">
          {side.rows.map((row) => {
            const key = legKey(row.playerId, row.statType);
            const selected = selectedKeys.has(key);
            const disabled = !selected && atMax;
            return (
              <li key={key}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onToggle(row)}
                  className={`flex w-full items-start gap-2 px-3 py-2.5 text-left transition ${
                    selected
                      ? "bg-accent/10 ring-1 ring-inset ring-accent/40"
                      : disabled
                        ? "opacity-40"
                        : "hover:bg-surface/60"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
                      selected ? "bg-accent text-surface" : "bg-surface text-slate-400"
                    }`}
                  >
                    {selected ? "✓" : row.rank}
                  </span>
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold"
                    style={{ background: c.bg, color: c.fg }}
                  >
                    {row.jumper ?? "–"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="truncate text-sm font-medium text-white">
                        {row.playerName}
                      </span>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-slate-200">
                        {targetLabel(row.line)}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-slate-400">
                        {row.odds != null ? `$${row.odds.toFixed(2)}` : "—"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{row.reason}</p>
                    {row.news && (row.news.status === "test" || row.news.status === "managed") ? (
                      <span className="text-[10px] font-semibold uppercase text-accent-pending">
                        {row.news.status}
                      </span>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
