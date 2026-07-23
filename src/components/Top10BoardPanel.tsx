"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SystemBookPanel } from "@/components/SystemBookPanel";
import type { StatType } from "@/db/schema";
import { teamColors } from "@/lib/afl/teamColors";
import { lineTarget, targetLabel } from "@/lib/format";
import { minLineTarget } from "@/lib/predictions/modelLine";
import { clearProbability } from "@/lib/predictions/probability";
import type { HelmSuggestion } from "@/lib/predictions/helmSuggest";
import type { SuggestedLeg } from "@/lib/predictions/suggest";
import {
  MAX_LEGS,
  MIN_LEGS,
} from "@/lib/predictions/suggestLimits";
import type { Top10BoardResponse, Top10Row } from "@/lib/predictions/top10Board";

const MARKETS: { key: StatType; label: string; short: string }[] = [
  { key: "disposals", label: "Disposals", short: "Disp" },
  { key: "marks", label: "Marks", short: "Marks" },
  { key: "tackles", label: "Tackles", short: "Tck" },
  { key: "goals", label: "Goals", short: "Goals" },
];

const HELM_FOCUSES: { key: StatType | "any"; label: string }[] = [
  { key: "any", label: "Any" },
  { key: "disposals", label: "Disposals" },
  { key: "marks", label: "Marks" },
  { key: "tackles", label: "Tackles" },
  { key: "goals", label: "Goals" },
];

type TicketLeg = Top10Row & { target: number; helmWhy?: string };

function toTicketLeg(row: Top10Row, helmWhy?: string): TicketLeg {
  return { ...row, target: lineTarget(row.line), helmWhy };
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

function suggestedToTicketLeg(
  leg: SuggestedLeg,
  board: Top10BoardResponse | null,
  why?: string,
): TicketLeg {
  const row = board
    ? board.markets
        .flatMap((m) => [...m.home.rows, ...m.away.rows])
        .find((r) => r.playerId === leg.playerId && r.statType === leg.statType)
    : undefined;
  return {
    rank: row?.rank ?? 99,
    playerId: leg.playerId,
    playerName: leg.playerName,
    jumper: leg.jumper ?? row?.jumper ?? null,
    team: leg.team,
    statType: leg.statType,
    line: leg.line,
    odds: leg.odds,
    prediction: leg.prediction,
    seasonAvg: leg.seasonAvg ?? row?.seasonAvg ?? null,
    lastGame: row?.lastGame ?? leg.recentForm[0] ?? null,
    recentForm: leg.recentForm,
    fantasyAvg: leg.fantasyAvg,
    benchmark: (leg.benchmark ?? row?.benchmark ?? "unknown") as Top10Row["benchmark"],
    reason: row?.reason ?? "",
    availableRungs: row?.availableRungs ?? [],
    history: leg.history,
    news: leg.news,
    target: lineTarget(leg.line),
    helmWhy: why,
  };
}

export function Top10BoardPanel({
  gameId,
  round = null,
  embedded = false,
  /** Bumps when server-side predictions change (e.g. after Generate predictions). */
  refreshKey = 0,
}: {
  gameId: number;
  round?: number | null;
  embedded?: boolean;
  refreshKey?: number;
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

  // Helm Suggest
  const [helmFocus, setHelmFocus] = useState<StatType | "any">("any");
  const [helmLegs, setHelmLegs] = useState(5);
  const [helmBusy, setHelmBusy] = useState(false);
  const [helmError, setHelmError] = useState<string | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const [openWhyKey, setOpenWhyKey] = useState<string | null>(null);

  // + Add player
  const [addOpen, setAddOpen] = useState(false);
  const [candidates, setCandidates] = useState<SuggestedLeg[]>([]);
  const [candLoading, setCandLoading] = useState(false);
  const [swapLegKey, setSwapLegKey] = useState<string | null>(null);

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
  }, [load, refreshKey]);

  useEffect(() => {
    function onPredictionsGenerated(e: Event) {
      const detail = (e as CustomEvent<{ gameId: number }>).detail;
      if (detail?.gameId === gameId) void load();
    }
    window.addEventListener("sgm:predictions-generated", onPredictionsGenerated);
    return () =>
      window.removeEventListener("sgm:predictions-generated", onPredictionsGenerated);
  }, [gameId, load]);

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
    setThinking(null);
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

  async function runHelmSuggest() {
    setHelmBusy(true);
    setHelmError(null);
    try {
      const res = await fetch(
        `/api/games/${gameId}/top10/suggest?focus=${helmFocus}&legs=${helmLegs}`,
      );
      const json = (await res.json()) as {
        ok?: boolean;
        suggestion?: HelmSuggestion;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.suggestion) {
        throw new Error(json.error || "Helm suggest failed");
      }
      const s = json.suggestion;
      const whyByKey = new Map(
        s.legReasons.map((r) => [`${r.playerId}:${r.statType}`, r.why] as const),
      );
      setTicket(
        s.legs.map((l) =>
          suggestedToTicketLeg(l, board, whyByKey.get(`${l.playerId}:${l.statType}`)),
        ),
      );
      setThinking(s.thinking);
      setThinkingOpen(true);
      setLogSuccess(null);
    } catch (err) {
      setHelmError((err as Error).message);
    } finally {
      setHelmBusy(false);
    }
  }

  async function openAddPlayer(forSwapKey?: string | null) {
    setSwapLegKey(forSwapKey ?? null);
    setAddOpen(true);
    if (candidates.length > 0) return;
    setCandLoading(true);
    try {
      const res = await fetch(`/api/games/${gameId}/candidates`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed to load players");
      setCandidates(json.legs as SuggestedLeg[]);
    } catch {
      setCandidates([]);
    } finally {
      setCandLoading(false);
    }
  }

  function addOrSwapCandidate(leg: SuggestedLeg) {
    const key = legKey(leg.playerId, leg.statType);
    const asTicket = suggestedToTicketLeg(leg, board, "Added from picker");
    if (swapLegKey) {
      setTicket((prev) =>
        prev.map((l) => (legKey(l.playerId, l.statType) === swapLegKey ? asTicket : l)),
      );
      setSwapLegKey(null);
    } else if (!ticketKeys.has(key) && ticket.length < MAX_LEGS) {
      setTicket((prev) => [...prev, asTicket]);
    }
    setAddOpen(false);
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
      setThinking(null);
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

  const filteredCandidates = useMemo(() => {
    const focus = swapLegKey
      ? (swapLegKey.split(":")[1] as StatType | undefined)
      : helmFocus === "any"
        ? null
        : helmFocus;
    let list = candidates;
    if (focus) list = list.filter((c) => c.statType === focus);
    return [...list].sort((a, b) => (b.seasonAvg ?? 0) - (a.seasonAvg ?? 0));
  }, [candidates, helmFocus, swapLegKey]);

  return (
    <section className={`${embedded ? "" : "card "}space-y-5`}>
      {!embedded ? (
        <div>
          <h2 className="text-lg font-semibold text-white">Top 10 hub</h2>
          <p className="text-sm text-slate-400">
            DIY boards, Helm Suggest, and System portfolio — one place to build and
            question picks.
          </p>
        </div>
      ) : null}

      {/* ── Boards + DIY ── */}
      <div className="space-y-3">
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
          <p className="text-sm text-slate-400">
            No predictions yet — generate predictions to unlock Top 10 boards and Helm
            Suggest. System portfolio below still works for locked stakes.
          </p>
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
      </div>

      {/* ── Helm Suggest ── */}
      <div className="rounded-xl border border-sky-500/30 bg-sky-500/[0.04] p-3 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-sky-300">
              Helm Suggest
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Seed a personal ticket from Top 10 — see thinking, then change anything.
            </p>
          </div>
          <button
            type="button"
            className="rounded-md bg-sky-500/90 px-3 py-1.5 text-xs font-semibold text-surface disabled:opacity-40"
            onClick={() => void runHelmSuggest()}
            disabled={helmBusy || !marketBoard}
          >
            {helmBusy ? "Thinking…" : "Suggest"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {HELM_FOCUSES.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setHelmFocus(f.key)}
              className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${
                helmFocus === f.key
                  ? "bg-sky-400/20 text-sky-200"
                  : "border border-surface-border text-slate-400"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-1 text-[11px] uppercase tracking-wide text-slate-500">
            Legs
          </span>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-surface-border text-slate-300 disabled:opacity-40"
            onClick={() => setHelmLegs((n) => Math.max(MIN_LEGS, n - 1))}
            disabled={helmLegs <= MIN_LEGS || helmBusy}
          >
            −
          </button>
          <span className="w-5 text-center text-sm font-semibold text-white">
            {helmLegs}
          </span>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-surface-border text-slate-300 disabled:opacity-40"
            onClick={() => setHelmLegs((n) => Math.min(MAX_LEGS, n + 1))}
            disabled={helmLegs >= MAX_LEGS || helmBusy}
          >
            +
          </button>
        </div>

        {helmError ? <p className="text-sm text-accent-loss">{helmError}</p> : null}

        {thinking ? (
          <div className="rounded-lg border border-sky-500/20 bg-surface/50 p-2.5">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-left"
              onClick={() => setThinkingOpen((o) => !o)}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">
                Helm thinking
              </span>
              <span className="text-[11px] text-slate-500">
                {thinkingOpen ? "Hide" : "Show"}
              </span>
            </button>
            {thinkingOpen ? (
              <p className="mt-1.5 text-sm leading-snug text-slate-300">{thinking}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── Personal ticket ── */}
      <div className="rounded-xl border border-surface-border bg-surface/40 p-3 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Your ticket · {ticket.length} leg{ticket.length === 1 ? "" : "s"}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="text-[11px] text-sky-400 hover:text-sky-300"
              onClick={() => void openAddPlayer(null)}
            >
              + Add player
            </button>
            {ticket.length > 0 ? (
              <button
                type="button"
                className="text-[11px] text-slate-500 hover:text-slate-300"
                onClick={() => {
                  setTicket([]);
                  setThinking(null);
                }}
              >
                Clear all
              </button>
            ) : null}
          </div>
        </div>

        {ticket.length === 0 ? (
          <p className="text-sm text-slate-400">
            Tap boards above, run Helm Suggest, or + Add player.
          </p>
        ) : (
          <ul className="space-y-2">
            {ticket.map((l) => {
              const c = teamColors(l.team);
              const key = legKey(l.playerId, l.statType);
              return (
                <li key={key} className="rounded-lg border border-surface-border/60 p-2">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs font-bold"
                      style={{ background: c.bg, color: c.fg }}
                    >
                      {l.jumper ?? "–"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-white">
                        {l.playerName}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-400">
                        <span className="capitalize">{l.statType}</span>
                        <span className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            className="flex h-5 w-5 items-center justify-center rounded border border-surface-border text-slate-300 disabled:opacity-40"
                            onClick={() => changeTarget(l.playerId, l.statType, -1)}
                            disabled={l.target <= minLineTarget(l.statType)}
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
                      className="text-[11px] text-sky-400 hover:text-sky-300"
                      onClick={() => void openAddPlayer(key)}
                    >
                      Swap
                    </button>
                    <button
                      type="button"
                      className="text-slate-500 hover:text-accent-loss"
                      onClick={() => removeLeg(l.playerId, l.statType)}
                      aria-label={`Remove ${l.playerName}`}
                    >
                      ✕
                    </button>
                  </div>
                  {l.helmWhy ? (
                    <button
                      type="button"
                      className="mt-1.5 w-full text-left text-[11px] leading-snug text-slate-500 hover:text-slate-400"
                      onClick={() =>
                        setOpenWhyKey((k) => (k === key ? null : key))
                      }
                    >
                      {openWhyKey === key ? l.helmWhy : `Why · ${l.helmWhy.slice(0, 72)}${l.helmWhy.length > 72 ? "…" : ""}`}
                    </button>
                  ) : null}
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

      {/* ── System portfolio (in-hub) ── */}
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.03] p-3 space-y-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
            System portfolio
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Any / focus / FUN tickets from the Lab playbook — question legs, swap from
            Top 10, then lock stake + odds.
          </p>
        </div>
        <SystemBookPanel gameId={gameId} embedded top10Board={board} />
      </div>

      {/* Add / swap picker */}
      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center">
          <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl border border-surface-border bg-surface-card shadow-xl">
            <div className="flex items-center justify-between border-b border-surface-border px-3 py-2">
              <div className="text-sm font-semibold text-white">
                {swapLegKey ? "Swap leg" : "Add player"}
              </div>
              <button
                type="button"
                className="text-slate-400 hover:text-white"
                onClick={() => {
                  setAddOpen(false);
                  setSwapLegKey(null);
                }}
              >
                ✕
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {candLoading ? (
                <p className="p-3 text-sm text-slate-400">Loading…</p>
              ) : filteredCandidates.length === 0 ? (
                <p className="p-3 text-sm text-slate-400">No candidates.</p>
              ) : (
                <ul className="divide-y divide-surface-border">
                  {filteredCandidates.slice(0, 40).map((c) => {
                    const key = legKey(c.playerId, c.statType);
                    const onTicket = ticketKeys.has(key);
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          disabled={onTicket && !swapLegKey}
                          onClick={() => addOrSwapCandidate(c)}
                          className="flex w-full items-center gap-2 px-2 py-2 text-left hover:bg-surface/60 disabled:opacity-40"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-white">
                              {c.playerName}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              <span className="capitalize">{c.statType}</span>{" "}
                              {targetLabel(c.line)}
                              {c.seasonAvg != null
                                ? ` · avg ${Math.round(c.seasonAvg * 10) / 10}`
                                : ""}
                              {` · ${Math.round(c.confidence * 100)}%`}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
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
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                      {row.reason}
                    </p>
                    {row.news &&
                    (row.news.status === "test" || row.news.status === "managed") ? (
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
