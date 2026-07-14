"use client";

import { useCallback, useEffect, useState } from "react";

import { lineTarget } from "@/lib/format";
import type { SystemTicketView } from "@/lib/system/portfolio";

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
};

export function SystemBookPanel({ gameId }: { gameId: number }) {
  const [tickets, setTickets] = useState<SystemTicketView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/system-book`);
      const json = (await res.json()) as {
        ok?: boolean;
        tickets?: SystemTicketView[];
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `Failed (${res.status})`);
      setTickets(json.tickets ?? []);
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
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `Failed (${res.status})`);
      setTickets(json.tickets ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
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
    <section className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">System book</h2>
          <p className="text-sm text-slate-400">
            Follow the helm 100%: generate after predictions, place every ticket,
            then enter bookie odds + stake so Review can tally the season bank.
          </p>
        </div>
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
        <p className="text-xs text-slate-400">
          {graded.length > 0
            ? `Graded: ${hits}/${graded.length} slips hit · `
            : null}
          Game stake logged: {money(gameStake > 0 ? gameStake : null)}
        </p>
      ) : null}

      <ul className="space-y-2">
        {tickets.map((t) => {
          const open = openId === t.id;
          return (
            <li
              key={t.id}
              className="rounded-lg border border-surface-border bg-surface/40"
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
                    saving={savingId === t.id}
                    onSave={(stake, odds) => void savePlacement(t.id, stake, odds)}
                  />
                  <ul className="space-y-1">
                    {t.legs.map((l) => (
                      <li
                        key={l.id}
                        className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
                      >
                        <span className="text-slate-200">
                          {l.playerName}{" "}
                          <span className="text-slate-500">
                            {lineTarget(l.line)} {l.statType}
                          </span>
                        </span>
                        <span className="tabular-nums text-slate-400">
                          {Math.round(l.confidence * 100)}%
                          {l.actualValue != null
                            ? ` · got ${l.actualValue}${l.hit ? " ✓" : " ✗"}`
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PlacementForm({
  ticket,
  saving,
  onSave,
}: {
  ticket: SystemTicketView;
  saving: boolean;
  onSave: (stake: string, odds: string) => void;
}) {
  const [stake, setStake] = useState(
    ticket.stake != null ? String(ticket.stake) : "",
  );
  const [odds, setOdds] = useState(
    ticket.placedOdds != null ? String(ticket.placedOdds) : "",
  );

  useEffect(() => {
    setStake(ticket.stake != null ? String(ticket.stake) : "");
    setOdds(ticket.placedOdds != null ? String(ticket.placedOdds) : "");
  }, [ticket.id, ticket.stake, ticket.placedOdds]);

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(stake, odds);
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
          onChange={(e) => setStake(e.target.value)}
          placeholder="e.g. 1.25"
          className="mt-0.5 block w-24 rounded border border-surface-border bg-surface px-2 py-1 text-xs text-white"
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
          onChange={(e) => setOdds(e.target.value)}
          placeholder={ticket.estOdds != null ? `est ${ticket.estOdds.toFixed(2)}` : "e.g. 4.50"}
          className="mt-0.5 block w-24 rounded border border-surface-border bg-surface px-2 py-1 text-xs text-white"
        />
      </label>
      <button
        type="submit"
        disabled={saving}
        className="rounded-md border border-surface-border px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-accent hover:text-accent disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <p className="basis-full text-[10px] text-slate-600">
        Enter after you place at the bookie. Refresh portfolio keeps these values.
      </p>
    </form>
  );
}
