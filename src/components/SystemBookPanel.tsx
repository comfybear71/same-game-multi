"use client";

import { useCallback, useEffect, useState } from "react";

import { lineTarget } from "@/lib/format";
import { minLineTarget } from "@/lib/predictions/modelLine";
import type {
  PortfolioMetrics,
  SystemTicketView,
} from "@/lib/system/portfolio";

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n * 1000) / 10}%`;
}

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `$${n.toFixed(2)}`;
}

const TIER_BADGE: Record<string, string> = {
  banker: "border-emerald-500/40 text-emerald-400",
  balanced: "border-sky-500/40 text-sky-400",
  low: "border-surface-border text-slate-500",
  fun: "border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-300",
};

const BAND_STAMP: Record<string, string> = {
  elite: "border-sky-500/50 bg-sky-500/25 text-sky-200",
  above: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
  average: "border-amber-500/35 bg-amber-500/10 text-amber-100",
  below: "border-rose-500/35 bg-rose-500/10 text-rose-200",
};

const BAND_LABEL: Record<string, string> = {
  elite: "Elite",
  above: "Above avg",
  average: "Average",
  below: "Below avg",
};

const TEAM_SHORT: Record<string, string> = {
  Adelaide: "Adel",
  "Brisbane Lions": "Bris",
  Carlton: "Carl",
  Collingwood: "Coll",
  Essendon: "Ess",
  Fremantle: "Freo",
  Geelong: "Geel",
  "Gold Coast": "GC",
  "Greater Western Sydney": "GWS",
  Hawthorn: "Haw",
  Melbourne: "Melb",
  "North Melbourne": "North",
  "Port Adelaide": "Port",
  Richmond: "Rich",
  "St Kilda": "StK",
  Sydney: "Syd",
  "West Coast": "WCE",
  "Western Bulldogs": "Dogs",
};

export function SystemBookPanel({
  gameId,
  embedded = false,
}: {
  gameId: number;
  /** When wrapped in CollapsibleSection — drop outer card + title block. */
  embedded?: boolean;
}) {
  const [tickets, setTickets] = useState<SystemTicketView[]>([]);
  const [metrics, setMetrics] = useState<PortfolioMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [nudgingLegId, setNudgingLegId] = useState<number | null>(null);
  const [excludingName, setExcludingName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/system-book`);
      const json = (await res.json()) as {
        ok?: boolean;
        tickets?: SystemTicketView[];
        metrics?: PortfolioMetrics;
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `Failed (${res.status})`);
      setTickets(json.tickets ?? []);
      setMetrics(json.metrics ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/system-book`, { method: "POST" });
      const json = (await res.json()) as {
        ok?: boolean;
        tickets?: SystemTicketView[];
        metrics?: PortfolioMetrics;
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `Failed (${res.status})`);
      setTickets(json.tickets ?? []);
      setMetrics(json.metrics ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function excludePlayer(playerName: string, team: string | null) {
    if (
      !confirm(
        `Mark ${playerName} as emergency and rebuild the System book? They’ll be removed from all tickets.`,
      )
    ) {
      return;
    }
    setExcludingName(playerName);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/system-book`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          excludePlayer: { playerName, team },
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        tickets?: SystemTicketView[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Failed (${res.status})`);
      }
      setTickets(json.tickets ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExcludingName(null);
    }
  }

  async function nudgeLeg(legId: number, target: number) {
    setNudgingLegId(legId);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/system-book`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legId, target }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        ticket?: SystemTicketView;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.ticket) {
        throw new Error(json.error ?? `Failed (${res.status})`);
      }
      setTickets((prev) =>
        prev.map((t) => (t.id === json.ticket!.id ? json.ticket! : t)),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setNudgingLegId(null);
    }
  }

  async function savePlacement(
    ticketId: number,
    stakeStr: string,
    oddsStr: string,
  ) {
    setSavingId(ticketId);
    setError(null);
    try {
      const stake =
        stakeStr.trim() === "" ? null : Number(stakeStr.replace(/[^0-9.]/g, ""));
      const placedOdds =
        oddsStr.trim() === "" ? null : Number(oddsStr.replace(/[^0-9.]/g, ""));
      const res = await fetch(`/api/games/${gameId}/system-book`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, stake, placedOdds }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        ticket?: SystemTicketView;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.ticket) {
        throw new Error(json.error ?? `Failed (${res.status})`);
      }
      setTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? json.ticket! : t)),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  const graded = tickets.filter((t) => t.slipHit != null);
  const hits = graded.filter((t) => t.slipHit).length;
  const gameStake = tickets.reduce((s, t) => s + (t.stake ?? 0), 0);

  return (
    <section className={embedded ? "space-y-3" : "card space-y-3"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {embedded ? (
          <p className="text-sm text-slate-400">
            Nudge lines, place at Sportsbet, then save stake + odds —{" "}
            <span className="text-slate-300">🔒 locks</span> that ticket (no
            cancel at the bookie).
          </p>
        ) : (
          <div>
            <h2 className="text-lg font-semibold text-white">System book</h2>
            <p className="text-sm text-slate-400">
              Follow the helm 100%: generate after predictions, nudge each leg to
              the Sportsbet line if needed, place, then enter bookie odds + stake.
              Saved tickets lock — Sportsbet won&apos;t let you cancel.
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-surface disabled:opacity-40"
        >
          {busy ? "Building…" : tickets.length ? "Refresh portfolio" : "Generate portfolio"}
        </button>
      </div>

      {loading ? <p className="text-sm text-slate-400">Loading…</p> : null}
      {error ? <p className="text-sm text-accent-loss">{error}</p> : null}

      {!loading && tickets.length === 0 && !error ? (
        <p className="text-sm text-slate-500">
          No system tickets yet. Refresh AI policy on Review if needed, then generate
          here.
        </p>
      ) : null}

      {tickets.length > 0 ? (
        <div className="space-y-1 text-xs text-slate-400">
          <p>
            {graded.length > 0
              ? `Graded: ${hits}/${graded.length} slips hit · `
              : null}
            Game stake logged: {money(gameStake > 0 ? gameStake : null)}
            {tickets.some(isPlacedTicket)
              ? ` · 🔒 ${tickets.filter(isPlacedTicket).length} locked`
              : ""}
          </p>
          {metrics ? (
            <p className="text-slate-500">
              Book spread: ~{metrics.effectiveIndependentBets.toFixed(2)}{" "}
              independent bets
              {metrics.ticketCount > 0
                ? ` across ${metrics.ticketCount} tickets`
                : ""}
              {" · "}max appearances {metrics.maxAppearances}
              {metrics.bookLeanWarning ? (
                <span className="text-amber-300/90">
                  {" · "}
                  {metrics.bookLeanWarning}
                </span>
              ) : metrics.bookLeanClub ? (
                ` · lean ${metrics.bookLeanPct}% ${metrics.bookLeanClub}`
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      <ul className="space-y-2">
        {tickets.map((t) => {
          const open = openId === t.id;
          const placed = isPlacedTicket(t);
          return (
            <li
              key={t.id}
              className={`rounded-lg border bg-surface/40 ${
                placed
                  ? "border-amber-500/35 bg-amber-500/[0.04]"
                  : "border-surface-border"
              }`}
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                onClick={() => setOpenId(open ? null : t.id)}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">{t.label}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${TIER_BADGE[t.tier] ?? TIER_BADGE.low}`}
                    >
                      {t.tier}
                    </span>
                    {placed ? (
                      <span
                        className="rounded-full border border-amber-500/45 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200"
                        title="Stake + odds saved — already placed at Sportsbet"
                      >
                        🔒 Locked
                      </span>
                    ) : (
                      <span className="rounded-full border border-surface-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                        Not placed
                      </span>
                    )}
                    {t.slipHit === true ? (
                      <span className="text-[10px] font-semibold text-accent-win">HIT</span>
                    ) : null}
                    {t.slipHit === false ? (
                      <span className="text-[10px] font-semibold text-accent-loss">MISS</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {t.legsTotal} legs · model {pct(t.modelledChance)} · est{" "}
                    {t.estOdds != null ? `${t.estOdds.toFixed(2)}` : "—"}
                    {t.stake != null ? ` · $${t.stake.toFixed(2)}` : ""}
                    {t.placedOdds != null ? ` @ ${t.placedOdds.toFixed(2)}` : ""}
                    {t.slipHit != null
                      ? ` · ${t.legsHit}/${t.legsTotal} legs`
                      : ""}
                    {t.slipHit === true && t.cashReturn > 0
                      ? ` · ret ${money(t.cashReturn)}`
                      : ""}
                  </p>
                </div>
                <span className="text-slate-500">{open ? "▴" : "▾"}</span>
              </button>
              {open ? (
                <div className="space-y-2 border-t border-surface-border/60 px-3 py-2">
                  <PlacementForm
                    ticket={t}
                    placed={placed}
                    saving={savingId === t.id}
                    onSave={(stake, odds) => void savePlacement(t.id, stake, odds)}
                  />
                  <ul className="space-y-2">
                    {t.legs.map((l) => {
                      const target = lineTarget(l.line);
                      const floor = minLineTarget(l.statType);
                      // Placed at bookie or already graded — no line/EMG edits.
                      const locked =
                        placed || t.slipHit != null || t.gradedAt != null;
                      const club =
                        l.team != null
                          ? (TEAM_SHORT[l.team] ?? l.team)
                          : null;
                      const band = l.benchmark ?? null;
                      return (
                        <li
                          key={l.id}
                          className="rounded-md border border-surface-border/50 bg-surface/30 px-2 py-1.5 text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 sm:flex-nowrap">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-slate-100 sm:flex-nowrap sm:overflow-hidden">
                              <span className="shrink-0 font-medium text-white">
                                {l.playerName}
                              </span>
                              <span className="shrink-0 capitalize text-slate-400">
                                {l.statType}
                              </span>
                              <span className="shrink-0 text-slate-600">·</span>
                              <span className="shrink-0 text-slate-500">
                                {l.position ?? "UNK"}
                              </span>
                              {club ? (
                                <>
                                  <span className="shrink-0 text-slate-600">
                                    ·
                                  </span>
                                  <span className="shrink-0 text-slate-500">
                                    {club}
                                  </span>
                                </>
                              ) : null}
                              {l.seasonAvg != null ? (
                                <span
                                  className={`shrink-0 rounded border px-1 py-px font-semibold tabular-nums ${
                                    band
                                      ? BAND_STAMP[band]
                                      : "border-surface-border text-slate-400"
                                  }`}
                                  title="Season average (Leaders)"
                                >
                                  {l.seasonAvg}
                                </span>
                              ) : null}
                              {band ? (
                                <span
                                  className={`shrink-0 rounded border px-1 py-px text-[10px] font-semibold uppercase tracking-wide ${BAND_STAMP[band]}`}
                                >
                                  {BAND_LABEL[band] ?? band}
                                  {l.percentile != null ? (
                                    <span className="ml-0.5 font-normal opacity-70">
                                      p{Math.round(l.percentile)}
                                    </span>
                                  ) : null}
                                </span>
                              ) : null}
                            </div>
                            <span className="inline-flex shrink-0 items-center gap-1.5">
                              <span className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  className="flex h-5 w-5 items-center justify-center rounded border border-surface-border text-slate-300 disabled:opacity-40"
                                  disabled={
                                    locked ||
                                    nudgingLegId === l.id ||
                                    target <= floor
                                  }
                                  onClick={() => void nudgeLeg(l.id, target - 1)}
                                  aria-label={`Lower ${l.playerName} target`}
                                >
                                  −
                                </button>
                                <span className="min-w-[2.5ch] text-center text-sm font-semibold text-white">
                                  {target}+
                                </span>
                                <button
                                  type="button"
                                  className="flex h-5 w-5 items-center justify-center rounded border border-surface-border text-slate-300 disabled:opacity-40"
                                  disabled={locked || nudgingLegId === l.id}
                                  onClick={() => void nudgeLeg(l.id, target + 1)}
                                  aria-label={`Raise ${l.playerName} target`}
                                >
                                  +
                                </button>
                              </span>
                              <span className="tabular-nums text-slate-400">
                                {Math.round(l.confidence * 100)}%
                                {l.actualValue != null
                                  ? ` · got ${l.actualValue}${l.hit ? " ✓" : " ✗"}`
                                  : ""}
                              </span>
                              {!locked ? (
                                <button
                                  type="button"
                                  disabled={excludingName != null || busy}
                                  onClick={() =>
                                    void excludePlayer(l.playerName, l.team)
                                  }
                                  className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-400 hover:bg-amber-500/10 disabled:opacity-40"
                                  title="Mark as emergency and rebuild book"
                                >
                                  {excludingName === l.playerName
                                    ? "…"
                                    : "EMG"}
                                </button>
                              ) : null}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-[10px] text-slate-600">
                    {placed
                      ? "🔒 Locked ticket — lines and EMG are frozen (already at Sportsbet)."
                      : "Use +/− for Sportsbet lines. Tap EMG on a leg if they’re an emergency / not playing — rebuilds the book without them."}
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function isPlacedTicket(t: Pick<SystemTicketView, "stake" | "placedOdds">): boolean {
  return t.stake != null && t.stake > 0 && t.placedOdds != null && t.placedOdds > 1;
}

function PlacementForm({
  ticket,
  placed,
  saving,
  onSave,
}: {
  ticket: SystemTicketView;
  placed: boolean;
  saving: boolean;
  onSave: (stake: string, odds: string) => void;
}) {
  const [stake, setStake] = useState(
    ticket.stake != null ? String(ticket.stake) : "",
  );
  const [odds, setOdds] = useState(
    ticket.placedOdds != null ? String(ticket.placedOdds) : "",
  );
  const [editingLocked, setEditingLocked] = useState(false);
  const inputsLocked = placed && !editingLocked;

  useEffect(() => {
    setStake(ticket.stake != null ? String(ticket.stake) : "");
    setOdds(ticket.placedOdds != null ? String(ticket.placedOdds) : "");
    setEditingLocked(false);
  }, [ticket.id, ticket.stake, ticket.placedOdds]);

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (inputsLocked) return;
        onSave(stake, odds);
        setEditingLocked(false);
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <label className="text-[11px] text-slate-500">
        Stake $
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={stake}
          disabled={inputsLocked}
          onChange={(e) => setStake(e.target.value)}
          placeholder="e.g. 1.25"
          className="mt-0.5 block w-24 rounded border border-surface-border bg-surface px-2 py-1 text-xs text-white disabled:opacity-60"
        />
      </label>
      <label className="text-[11px] text-slate-500">
        Bookie odds
        <input
          type="number"
          inputMode="decimal"
          min={1.01}
          step="0.01"
          value={odds}
          disabled={inputsLocked}
          onChange={(e) => setOdds(e.target.value)}
          placeholder={ticket.estOdds != null ? `est ${ticket.estOdds.toFixed(2)}` : "e.g. 4.50"}
          className="mt-0.5 block w-24 rounded border border-surface-border bg-surface px-2 py-1 text-xs text-white disabled:opacity-60"
        />
      </label>
      {inputsLocked ? (
        <button
          type="button"
          onClick={() => setEditingLocked(true)}
          className="rounded-md border border-amber-500/40 px-2.5 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/10"
        >
          Correct entry
        </button>
      ) : (
        <button
          type="submit"
          disabled={saving}
          className="rounded-md border border-surface-border px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {saving ? "Saving…" : placed ? "Update locked" : "Save & lock"}
        </button>
      )}
      <p className="basis-full text-[10px] text-slate-600">
        {placed
          ? "🔒 Already placed at Sportsbet — locked here too. Use Correct entry only for a typo."
          : "Enter after you place at the bookie. That locks the ticket. Refresh portfolio keeps locked stake/odds."}
      </p>
    </form>
  );
}
