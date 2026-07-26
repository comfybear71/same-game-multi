"use client";

import { useCallback, useEffect, useState } from "react";

import { teamColors } from "@/lib/afl/teamColors";
import type {
  LineupReviewPayload,
  LineupReviewPlayer,
} from "@/lib/ingest/lineupReview";

const BAND_STAMP: Record<string, string> = {
  elite: "border-sky-500/45 bg-sky-500/20 text-sky-200",
  above: "border-emerald-500/40 bg-emerald-500/12 text-emerald-200",
  average: "border-amber-500/35 bg-amber-500/10 text-amber-100",
  below: "border-rose-500/35 bg-rose-500/10 text-rose-200",
  unknown: "border-surface-border text-slate-500",
};

const BAND_SHORT: Record<string, string> = {
  elite: "Elite",
  above: "Above",
  average: "Avg",
  below: "Below",
  unknown: "—",
};

const FIELD_ROWS = ["FB", "HB", "C", "HF", "FF", "FOL"] as const;
const ROW_LABEL: Record<string, string> = {
  FB: "Full backs",
  HB: "Half backs",
  C: "Centres",
  HF: "Half forwards",
  FF: "Full forwards",
  FOL: "Followers",
};

function displayPos(p: LineupReviewPlayer): string {
  if (p.status === "interchange") return "INT";
  if (p.status === "emergency") return "EMG";
  return p.position ?? "—";
}

function fmtDisp(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function lastGameHighlight(
  seasonAvg: number | null,
  last: number | null,
): boolean {
  if (seasonAvg == null || last == null || seasonAvg <= 0) return false;
  return Math.abs(last - seasonAvg) / seasonAvg >= 0.12;
}

function PlayerCard({ player }: { player: LineupReviewPlayer }) {
  const c = teamColors(player.team);
  const band = player.band ?? "unknown";
  const bandCls = BAND_STAMP[band] ?? BAND_STAMP.unknown;
  const dim = player.status === "emergency" ? "opacity-55" : "";
  const lastHot = lastGameHighlight(player.seasonDispAvg, player.lastGameDisp);
  const pickPct =
    player.pickBets != null && player.pickBets > 0 && player.pickHits != null
      ? Math.round((player.pickHits / player.pickBets) * 100)
      : null;

  return (
    <div
      className={`rounded-md border border-surface-border/80 bg-surface/40 px-2 py-1.5 ${dim}`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded px-0.5 text-[10px] font-bold tabular-nums"
          style={{ background: c.bg, color: c.fg }}
        >
          {player.jumper ?? "—"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-slate-100">
            {player.playerName}
          </p>
          <p className="text-[10px] leading-tight text-slate-500">
            <span className="text-slate-400">{displayPos(player)}</span>
            {" · "}
            <span className="tabular-nums">{fmtDisp(player.seasonDispAvg)} avg</span>
            {player.lastGameDisp != null ? (
              <>
                {" · "}
                <span
                  className={
                    lastHot
                      ? "font-medium text-amber-200"
                      : "text-slate-500"
                  }
                >
                  Last {fmtDisp(player.lastGameDisp)}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <span
          className={`shrink-0 rounded border px-1 py-px text-[8px] font-semibold uppercase leading-none ${bandCls}`}
          title={BAND_SHORT[band]}
        >
          {BAND_SHORT[band]}
        </span>
        {pickPct != null ? (
          <span
            className={`shrink-0 text-[9px] font-semibold tabular-nums ${
              pickPct < 50 ? "text-accent-loss" : "text-accent-win"
            }`}
            title="Your logged legs (all stats)"
          >
            {player.pickHits}/{player.pickBets}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TeamGrid({
  team,
  field,
  interchange,
  emergency,
}: {
  team: string;
  field: LineupReviewPlayer[];
  interchange: LineupReviewPlayer[];
  emergency: LineupReviewPlayer[];
}) {
  const c = teamColors(team);
  if (field.length + interchange.length + emergency.length === 0) return null;

  return (
    <div>
      <h3
        className="mb-1 text-xs font-bold uppercase tracking-wide"
        style={{ color: c.fg }}
      >
        {team}
        <span className="ml-2 font-normal normal-case text-slate-500">
          {field.length} field + {interchange.length} INT
          {emergency.length > 0 ? ` · ${emergency.length} emg` : ""}
        </span>
      </h3>
      <div className="space-y-2">
        {FIELD_ROWS.map((code) => {
          const row = field.filter((p) => (p.position ?? "").toUpperCase() === code);
          if (row.length === 0) return null;
          return (
            <div key={code}>
              <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600">
                {ROW_LABEL[code]}
              </p>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-3">
                {row.map((p) => (
                  <PlayerCard key={p.lineupId} player={p} />
                ))}
              </div>
            </div>
          );
        })}
        {field.filter(
          (p) =>
            !p.position ||
            !FIELD_ROWS.includes(p.position.toUpperCase() as (typeof FIELD_ROWS)[number]),
        ).length > 0 ? (
          <div>
            <p className="mb-0.5 text-[9px] font-semibold uppercase text-slate-600">
              Other field
            </p>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {field
                .filter(
                  (p) =>
                    !p.position ||
                    !FIELD_ROWS.includes(
                      p.position.toUpperCase() as (typeof FIELD_ROWS)[number],
                    ),
                )
                .map((p) => (
                  <PlayerCard key={p.lineupId} player={p} />
                ))}
            </div>
          </div>
        ) : null}
      </div>
      {interchange.length > 0 ? (
        <div className="mt-2">
          <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
            Interchange ({interchange.length})
          </p>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {interchange.map((p) => (
              <PlayerCard key={p.lineupId} player={p} />
            ))}
          </div>
        </div>
      ) : null}
      {emergency.length > 0 ? (
        <div className="mt-2">
          <p className="mb-0.5 text-[9px] font-semibold uppercase text-amber-500/70">
            Emergency
          </p>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {emergency.map((p) => (
              <PlayerCard key={p.lineupId} player={p} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function LineupReviewPanel({
  gameId,
  refreshKey = 0,
  canApprove = true,
}: {
  gameId: number;
  refreshKey?: number;
  canApprove?: boolean;
}) {
  const [review, setReview] = useState<LineupReviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/lineup/review`);
      const json = (await res.json()) as {
        ok?: boolean;
        review?: LineupReviewPayload;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.review) {
        throw new Error(json.error ?? `Failed (${res.status})`);
      }
      setReview(json.review);
      if (json.review.summary.selected > 0) setExpanded(true);
    } catch (err) {
      setError((err as Error).message);
      setReview(null);
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function onApprove() {
    setApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/lineup/approve`, {
        method: "POST",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        review?: LineupReviewPayload;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Failed (${res.status})`);
      }
      if (json.review) setReview(json.review);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApproving(false);
    }
  }

  if (loading && !review) {
    return <p className="text-xs text-slate-400">Loading squad review…</p>;
  }

  if (!review || review.summary.selected === 0) {
    return null;
  }

  const { summary } = review;

  return (
    <div className="rounded-xl border border-surface-border bg-surface/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-left text-sm font-semibold text-slate-100 hover:text-accent"
          >
            {expanded ? "Squad review ▴" : "Squad review ▾"}
          </button>
          <p className="text-xs text-slate-400">
            {review.home} {summary.homeField}+{summary.homeInt} INT · {review.away}{" "}
            {summary.awayField}+{summary.awayInt} INT
            {review.approved ? (
              <span className="text-accent-win"> · Approved</span>
            ) : (
              <span className="text-accent-pending"> · Awaiting approval</span>
            )}
          </p>
        </div>
        {!review.approved && canApprove ? (
          <button
            type="button"
            className="btn text-sm"
            disabled={approving}
            onClick={() => void onApprove()}
          >
            {approving ? "Saving…" : "Approve lineup"}
          </button>
        ) : review.approved ? (
          <span className="rounded-full border border-accent-win/40 bg-accent-win/10 px-2.5 py-1 text-xs font-medium text-accent-win">
            ✓ Squad locked in
          </span>
        ) : !canApprove ? (
          <span className="text-xs text-slate-500">Approval closed (game started)</span>
        ) : null}
      </div>

      {review.warnings.length > 0 ? (
        <ul className="mt-2 list-inside list-disc text-xs text-accent-pending">
          {review.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {expanded ? (
        <div className="mt-3 grid gap-6 lg:grid-cols-2">
          {review.teams.map((t) => (
            <TeamGrid
              key={t.team}
              team={t.team}
              field={t.field}
              interchange={t.interchange}
              emergency={t.emergency}
            />
          ))}
        </div>
      ) : null}

      {!review.approved ? (
        <p className="mt-3 text-[11px] text-slate-500">
          Target 18 field + 4 INT per team (~22 selected). Badges: Elite / Above / Avg /
          Below (disp). Amber last-game when far from season avg. Green/red fraction =
          your logged multis on that name.
        </p>
      ) : null}

      {error ? <p className="mt-2 text-xs text-accent-loss">{error}</p> : null}
    </div>
  );
}
