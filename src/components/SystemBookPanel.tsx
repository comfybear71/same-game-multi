"use client";

import { useCallback, useEffect, useState } from "react";

import { lineTarget } from "@/lib/format";
import { minLineTarget } from "@/lib/predictions/modelLine";
import type {
  CardStyle,
  ChooserBook,
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

const CARD_RING: Record<string, string> = {
  green: "border-emerald-500/60 bg-emerald-500/[0.07] ring-emerald-400/40",
  orange: "border-orange-500/60 bg-orange-500/[0.07] ring-orange-400/40",
  sky: "border-sky-500/60 bg-sky-500/[0.07] ring-sky-400/40",
};

const CARD_TITLE: Record<string, string> = {
  green: "text-emerald-300",
  orange: "text-orange-300",
  sky: "text-sky-300",
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
  const [chooser, setChooser] = useState<ChooserBook | null>(null);
  const [selections, setSelections] = useState<Record<string, CardStyle>>({});
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

  async function generate(nextSelections?: Record<string, CardStyle>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/system-book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chooser: true,
          selections: nextSelections ?? selections,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        tickets?: SystemTicketView[];
        metrics?: PortfolioMetrics;
        chooser?: ChooserBook;
        selections?: Record<string, CardStyle>;
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `Failed (${res.status})`);
      setTickets(json.tickets ?? []);
      setMetrics(json.metrics ?? null);
      setChooser(json.chooser ?? null);
      setSelections(json.selections ?? {});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pickCard(strategyKey: string, style: CardStyle) {
    const next = { ...selections, [strategyKey]: style };
    setSelections(next);
    await generate(next);
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
      // Rebuild chooser so cards drop the EMG player
      await generate(selections);
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
  const ticketByKey = new Map(tickets.map((t) => [t.strategyKey, t]));

  return (
    <section className={embedded ? "space-y-3" : "card space-y-3"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {embedded ? (
          <p className="text-sm text-slate-400">
            Pick a card per multi (green edge / orange hot / sky spread), nudge
            lines, then save stake + odds —{" "}
            <span className="text-slate-300">🔒 locks</span> that ticket.
          </p>
        ) : (
          <div>
            <h2 className="text-lg font-semibold text-white">System book</h2>
            <p className="text-sm text-slate-400">
              Three cards per multi — green = best edge, orange = last-week hot,
              sky = spread. Tap a card to select it, then place and lock.
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-surface disabled:opacity-40"
        >
          {busy ? "Building…" : tickets.length || chooser ? "Refresh portfolio" : "Generate portfolio"}
        </button>
      </div>

      {loading ? <p className="text-sm text-slate-400">Loading…</p> : null}
      {error ? <p className="text-sm text-accent-loss">{error}</p> : null}

      {!loading && tickets.length === 0 && !chooser && !error ? (
        <p className="text-sm text-slate-500">
          No system tickets yet. Refresh AI policy on Review if needed, then generate
          here.
        </p>
      ) : null}

      {tickets.length > 0 || chooser ? (
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
          {chooser ? (
            <p className="text-slate-500">
              Chooser on — selected cards are what you place. Refresh rebuilds all
              three styles.
            </p>
          ) : null}
        </div>
      ) : null}

      {chooser ? (
        <div className="space-y-5">
          {chooser.slots.map((slot) => {
            const selected = selections[slot.strategyKey] ?? "edge";
            const persisted = ticketByKey.get(slot.strategyKey);
            const placed = persisted ? isPlacedTicket(persisted) : false;
            const open = persisted != null && openId === persisted.id;
            return (
              <div key={slot.strategyKey} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-white">{slot.label}</h3>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${TIER_BADGE[slot.tier] ?? TIER_BADGE.low}`}
                  >
                    {slot.tier}
                  </span>
                  {placed ? (
                    <span className="rounded-full border border-amber-500/45 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                      🔒 Locked
                    </span>
                  ) : null}
                </div>

                <div className="grid gap-2 md:grid-cols-3">
                  {slot.cards.map((card) => {
                    const isSelected = selected === card.style;
                    return (
                      <button
                        key={card.style}
                        type="button"
                        disabled={busy || placed}
                        onClick={() => void pickCard(slot.strategyKey, card.style)}
                        className={`rounded-lg border px-2.5 py-2 text-left transition ${
                          CARD_RING[card.colour]
                        } ${
                          isSelected
                            ? "ring-2"
                            : "opacity-80 hover:opacity-100"
                        } disabled:cursor-not-allowed`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={`text-xs font-semibold uppercase tracking-wide ${CARD_TITLE[card.colour]}`}
                          >
                            {card.title}
                          </span>
                          {isSelected ? (
                            <span className="text-[10px] font-semibold text-white">
                              SELECTED
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-[10px] leading-snug text-slate-400">
                          {card.why}
                        </p>
                        <p className="mt-1.5 text-[11px] text-slate-300">
                          model {pct(card.modelledChance)} · est{" "}
                          {card.estOdds != null ? card.estOdds.toFixed(2) : "—"}
                          {card.sharedNames.length > 0
                            ? ` · shared: ${card.sharedNames.slice(0, 3).join(", ")}`
                            : ""}
                        </p>
                        <ul className="mt-1.5 space-y-0.5">
                          {card.legs.map((l) => (
                            <li
                              key={`${l.playerId}:${l.statType}:${l.line}`}
                              className="flex flex-wrap items-center gap-x-1 text-[11px] text-slate-200"
                            >
                              <span className="font-medium text-white">
                                {l.playerName}
                              </span>
                              <span className="capitalize text-slate-500">
                                {l.statType}
                              </span>
                              <span className="tabular-nums text-slate-400">
                                {lineTarget(l.line)}+
                              </span>
                              <span className="tabular-nums text-slate-500">
                                {Math.round(l.confidence * 100)}%
                              </span>
                              {l.edge != null ? (
                                <span
                                  className={
                                    l.edge >= 0
                                      ? "text-emerald-400"
                                      : "text-rose-400"
                                  }
                                >
                                  {l.edge >= 0 ? "+" : ""}
                                  {Math.round(l.edge * 1000) / 10}%
                                </span>
                              ) : null}
                              {l.leaderRank != null ? (
                                <span className="text-orange-300">HOT</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </button>
                    );
                  })}
                </div>

                {persisted ? (
                  <div className="rounded-lg border border-surface-border/70 bg-surface/30 px-3 py-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 text-left"
                      onClick={() =>
                        setOpenId(open ? null : persisted.id)
                      }
                    >
                      <span className="text-[11px] text-slate-400">
                        Selected ticket — stake / lines / EMG
                      </span>
                      <span className="text-slate-500">{open ? "▴" : "▾"}</span>
                    </button>
                    {open ? (
                      <div className="mt-2 space-y-2 border-t border-surface-border/50 pt-2">
                        <PlacementForm
                          ticket={persisted}
                          placed={placed}
                          saving={savingId === persisted.id}
                          onSave={(stake, odds) =>
                            void savePlacement(persisted.id, stake, odds)
                          }
                        />
                        <TicketLegs
                          ticket={persisted}
                          placed={placed}
                          busy={busy}
                          excludingName={excludingName}
                          nudgingLegId={nudgingLegId}
                          onNudge={(id, target) => void nudgeLeg(id, target)}
                          onExclude={(name, team) =>
                            void excludePlayer(name, team)
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
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
                      <span className="text-sm font-medium text-white">
                        {t.label}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${TIER_BADGE[t.tier] ?? TIER_BADGE.low}`}
                      >
                        {t.tier}
                      </span>
                      {placed ? (
                        <span className="rounded-full border border-amber-500/45 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                          🔒 Locked
                        </span>
                      ) : (
                        <span className="rounded-full border border-surface-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                          Not placed
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {t.legsTotal} legs · model {pct(t.modelledChance)} · est{" "}
                      {t.estOdds != null ? `${t.estOdds.toFixed(2)}` : "—"}
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
                      onSave={(stake, odds) =>
                        void savePlacement(t.id, stake, odds)
                      }
                    />
                    <TicketLegs
                      ticket={t}
                      placed={placed}
                      busy={busy}
                      excludingName={excludingName}
                      nudgingLegId={nudgingLegId}
                      onNudge={(id, target) => void nudgeLeg(id, target)}
                      onExclude={(name, team) => void excludePlayer(name, team)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TicketLegs({
  ticket,
  placed,
  busy,
  excludingName,
  nudgingLegId,
  onNudge,
  onExclude,
}: {
  ticket: SystemTicketView;
  placed: boolean;
  busy: boolean;
  excludingName: string | null;
  nudgingLegId: number | null;
  onNudge: (legId: number, target: number) => void;
  onExclude: (playerName: string, team: string | null) => void;
}) {
  const locked = placed || ticket.slipHit != null || ticket.gradedAt != null;
  return (
    <>
      <ul className="space-y-2">
        {ticket.legs.map((l) => {
          const target = lineTarget(l.line);
          const floor = minLineTarget(l.statType);
          const club =
            l.team != null ? (TEAM_SHORT[l.team] ?? l.team) : null;
          const band = l.benchmark ?? null;
          return (
            <li
              key={l.id}
              className="rounded-md border border-surface-border/50 bg-surface/30 px-2 py-1.5 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 sm:flex-nowrap">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-slate-100">
                  <span className="shrink-0 font-medium text-white">
                    {l.playerName}
                  </span>
                  <span className="shrink-0 capitalize text-slate-400">
                    {l.statType}
                  </span>
                  {club ? (
                    <span className="shrink-0 text-slate-500">{club}</span>
                  ) : null}
                  {l.seasonAvg != null ? (
                    <span
                      className={`shrink-0 rounded border px-1 py-px font-semibold tabular-nums ${
                        band
                          ? BAND_STAMP[band]
                          : "border-surface-border text-slate-400"
                      }`}
                    >
                      {l.seasonAvg}
                    </span>
                  ) : null}
                  {band ? (
                    <span
                      className={`shrink-0 rounded border px-1 py-px text-[10px] font-semibold uppercase tracking-wide ${BAND_STAMP[band]}`}
                    >
                      {BAND_LABEL[band] ?? band}
                    </span>
                  ) : null}
                  {l.edgeBadge ? (
                    <span
                      className={`shrink-0 rounded border px-1 py-px text-[10px] font-semibold uppercase tracking-wide ${
                        l.edgeBadge.edge >= 0
                          ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-200"
                          : "border-rose-500/45 bg-rose-500/15 text-rose-200"
                      }`}
                      title={`Model ${Math.round(l.edgeBadge.modelPct * 100)}% vs implied ${Math.round(l.edgeBadge.impliedPct * 100)}%`}
                    >
                      EDGE{" "}
                      {l.edgeBadge.edge >= 0 ? "+" : ""}
                      {Math.round(l.edgeBadge.edge * 1000) / 10}%
                    </span>
                  ) : null}
                  {l.hotBadge ? (
                    <span
                      className="shrink-0 rounded border border-orange-500/40 bg-orange-500/15 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-orange-200"
                      title={l.hotBadge.label}
                    >
                      HOT · {l.hotBadge.label}
                    </span>
                  ) : null}
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5">
                  <span className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center rounded border border-surface-border text-slate-300 disabled:opacity-40"
                      disabled={
                        locked || nudgingLegId === l.id || target <= floor
                      }
                      onClick={() => onNudge(l.id, target - 1)}
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
                      onClick={() => onNudge(l.id, target + 1)}
                      aria-label={`Raise ${l.playerName} target`}
                    >
                      +
                    </button>
                  </span>
                  <span className="tabular-nums text-slate-400">
                    {Math.round(l.confidence * 100)}%
                  </span>
                  {!locked ? (
                    <button
                      type="button"
                      disabled={excludingName != null || busy}
                      onClick={() => onExclude(l.playerName, l.team)}
                      className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-400 hover:bg-amber-500/10 disabled:opacity-40"
                    >
                      {excludingName === l.playerName ? "…" : "EMG"}
                    </button>
                  ) : null}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-[10px] text-slate-600">
        {locked
          ? "🔒 Locked ticket — lines and EMG are frozen."
          : "Use +/− for Sportsbet lines. Tap EMG if they’re an emergency."}
      </p>
    </>
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
          disabled={inputsLocked || saving}
          onChange={(e) => setStake(e.target.value)}
          placeholder="e.g. 1.25"
          className="mt-0.5 block w-24 rounded border border-surface-border bg-surface px-2 py-1 text-sm text-white"
        />
      </label>
      <label className="text-[11px] text-slate-500">
        Bookie odds
        <input
          type="number"
          inputMode="decimal"
          min={1}
          step="0.01"
          value={odds}
          disabled={inputsLocked || saving}
          onChange={(e) => setOdds(e.target.value)}
          placeholder={
            ticket.estOdds != null ? `est ${ticket.estOdds.toFixed(2)}` : "e.g. 4.50"
          }
          className="mt-0.5 block w-28 rounded border border-surface-border bg-surface px-2 py-1 text-sm text-white"
        />
      </label>
      {inputsLocked ? (
        <button
          type="button"
          className="rounded border border-surface-border px-2 py-1 text-xs text-slate-300"
          onClick={() => setEditingLocked(true)}
        >
          Edit
        </button>
      ) : (
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-accent px-2 py-1 text-xs font-semibold text-surface disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save & lock"}
        </button>
      )}
      <p className="basis-full text-[10px] text-slate-600">
        Enter after you place at the bookie. That locks the ticket. Refresh
        portfolio keeps locked stake/odds.
      </p>
    </form>
  );
}
