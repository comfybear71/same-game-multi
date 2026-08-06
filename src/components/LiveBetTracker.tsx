"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

import { celebrateMultiLand } from "@/lib/confetti";
import {
  dispatchQuickMultiFilled,
  sampleLegs,
  uniqueTrackerLegs,
} from "@/components/trackerQuickMulti";
import type { StatType } from "@/db/schema";

import { LegMarketEditor, type LegMarketPatch } from "@/components/EditLegMarket";
import { LiveRefreshCountdown } from "@/components/LiveRefreshCountdown";
import { teamColors, jumperBadgeStyle } from "@/lib/afl/teamColors";
import type { BetTrackerLeg } from "@/lib/betTypes";
import { playerRecordKey } from "@/lib/betTypes";
import { lineTarget, marginVsTarget, signed, targetLabel } from "@/lib/format";
import { isTrackerStat, STAT_THEME, statThemeFor, type TrackerStat } from "@/lib/statTheme";

type LegState = BetTrackerLeg & { saving?: boolean; error?: string };

function legCleared(
  leg: BetTrackerLeg,
  effectiveValue?: number,
  gameComplete?: boolean,
): boolean {
  if (gameComplete && effectiveValue != null) {
    return effectiveValue > leg.line;
  }
  if (leg.result === "hit") return true;
  if (leg.result === "miss" || leg.result === "void") return false;
  const v = effectiveValue ?? leg.actualValue;
  return v != null && v > leg.line;
}

function legFailed(
  leg: BetTrackerLeg,
  effectiveValue?: number,
  gameComplete?: boolean,
): boolean {
  if (gameComplete && effectiveValue != null) {
    return effectiveValue <= leg.line;
  }
  return leg.result === "miss";
}

/** Every non-void leg on the slip cleared (multi landed). */
function slipLanded(
  slipLegs: BetTrackerLeg[],
  feedByKey?: Record<string, number>,
  gameComplete?: boolean,
): boolean {
  const active = slipLegs.filter((l) => l.result !== "void");
  if (active.length === 0) return false;
  return active.every((leg) =>
    legCleared(leg, legCount(leg, feedByKey, gameComplete), gameComplete),
  );
}

/** Stat groups in scan order while watching. */
const STAT_SORT: Record<string, number> = {
  tackles: 0,
  goals: 1,
  disposals: 2,
  marks: 3,
};

type BarState = "red" | "green" | "orange" | "blue" | "empty";

const BAR_STATE_ORDER: Record<BarState, number> = {
  red: 0,
  green: 1,
  orange: 2,
  blue: 3,
  empty: 4,
};

function legCount(
  leg: BetTrackerLeg,
  feedByKey?: Record<string, number>,
  gameComplete?: boolean,
): number {
  const key = playerRecordKey(leg.playerName ?? "", leg.statType);
  const feed = feedByKey?.[key];

  // Complete games: MC feed matches afl.com.au — wins over stale DB actuals.
  if (gameComplete && feed != null) {
    if (leg.result === "pending" || leg.actualValue == null) return feed;
    if (feed !== leg.actualValue) return feed;
  }

  if (
    (leg.result === "hit" || leg.result === "miss") &&
    leg.actualValue != null
  ) {
    return leg.actualValue;
  }
  const hasManual =
    leg.actualValue != null && (leg.actualValue > 0 || feed == null);
  if (hasManual) return leg.actualValue ?? 0;
  return feed ?? leg.actualValue ?? 0;
}

function progressRatio(
  leg: BetTrackerLeg,
  feedByKey?: Record<string, number>,
  gameComplete?: boolean,
): number {
  const target = lineTarget(leg.line);
  if (target <= 0) return 0;
  return legCount(leg, feedByKey, gameComplete) / target;
}

function compareProgressDesc(
  a: BetTrackerLeg,
  b: BetTrackerLeg,
  feedByKey?: Record<string, number>,
  gameComplete?: boolean,
): number {
  return progressRatio(b, feedByKey, gameComplete) - progressRatio(a, feedByKey, gameComplete);
}

function isAlmostThere(
  current: number,
  target: number,
  statType: string,
  cleared: boolean,
  failed: boolean,
): boolean {
  if (cleared || failed || target <= 0) return false;
  const pct = Math.min(100, (current / target) * 100);
  if (pct >= 80) return true;
  if (statType !== "goals" && current > 0 && current === target - 1) return true;
  return false;
}

function barStateFromCounts(
  current: number,
  target: number,
  statType: string,
  cleared: boolean,
  failed: boolean,
): BarState {
  const overTarget = !failed && current > target && target > 0;
  if (failed || overTarget) return "red";
  if (cleared) return "green";
  if (current === 0) return "empty";
  if (isAlmostThere(current, target, statType, cleared, failed)) return "orange";
  return "blue";
}

function legBarState(
  leg: BetTrackerLeg,
  feedByKey?: Record<string, number>,
  gameComplete?: boolean,
): BarState {
  const count = legCount(leg, feedByKey, gameComplete);
  return barStateFromCounts(
    count,
    lineTarget(leg.line),
    leg.statType,
    legCleared(leg, count, gameComplete),
    legFailed(leg, count, gameComplete),
  );
}

type SortMode =
  | "need"
  | "number"
  | "color"
  | "sportsbet"
  | "paper"
  | "tackles"
  | "goals"
  | "disposals"
  | "marks";

const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: "need", label: "Need" },
  { key: "number", label: "#" },
  { key: "color", label: "Color" },
  { key: "sportsbet", label: "🔒 $$" },
  { key: "paper", label: "Paper" },
  { key: "tackles", label: STAT_THEME.tackles.label },
  { key: "goals", label: STAT_THEME.goals.label },
  { key: "disposals", label: STAT_THEME.disposals.label },
  { key: "marks", label: STAT_THEME.marks.label },
];

const STAT_FILTER_MODES: SortMode[] = ["tackles", "goals", "disposals", "marks"];

const TRACKER_POLL_MS = 30_000;

function legSortGroup(
  leg: BetTrackerLeg,
  feedByKey?: Record<string, number>,
  gameComplete?: boolean,
): number {
  const count = legCount(leg, feedByKey, gameComplete);
  if (legFailed(leg, count, gameComplete)) return 2;
  if (leg.result === "void") return 3;
  if (legCleared(leg, count, gameComplete)) return 1;
  return 0; // still chasing
}

function compareNeed(
  a: BetTrackerLeg,
  b: BetTrackerLeg,
  feedByKey?: Record<string, number>,
  gameComplete?: boolean,
): number {
  return legSortGroup(a, feedByKey, gameComplete) - legSortGroup(b, feedByKey, gameComplete);
}

function compareNumber(a: BetTrackerLeg, b: BetTrackerLeg): number {
  return (a.jumper ?? 9999) - (b.jumper ?? 9999);
}

function compareStat(a: BetTrackerLeg, b: BetTrackerLeg): number {
  const sa = STAT_SORT[a.statType] ?? 99;
  const sb = STAT_SORT[b.statType] ?? 99;
  if (sa !== sb) return sa - sb;
  return (a.playerName ?? "").localeCompare(b.playerName ?? "");
}

function sortTabClass(key: SortMode, active: boolean): string {
  if (isTrackerStat(key)) {
    const theme = STAT_THEME[key];
    return active ? theme.tabActive : theme.tabIdle;
  }
  if (key === "sportsbet") {
    return active
      ? "bg-slate-200 text-surface"
      : "border border-slate-400/50 text-slate-300 hover:bg-slate-500/10";
  }
  if (key === "paper") {
    return active
      ? "bg-violet-500 text-white"
      : "border border-violet-500/45 text-violet-300 hover:bg-violet-500/10";
  }
  return active
    ? "bg-slate-200 text-surface"
    : "border border-surface-border text-slate-400 hover:text-slate-300";
}

function sortTrackerLegs(
  legs: BetTrackerLeg[],
  mode: SortMode,
  colorAsc = true,
  feedByKey?: Record<string, number>,
  gameComplete?: boolean,
): BetTrackerLeg[] {
  return [...legs].sort((a, b) => {
    let cmp = 0;
    switch (mode) {
      case "need":
        cmp = compareNeed(a, b, feedByKey, gameComplete);
        break;
      case "number":
        cmp = compareNumber(a, b);
        break;
      case "color": {
        cmp =
          BAR_STATE_ORDER[legBarState(a, feedByKey, gameComplete)] -
          BAR_STATE_ORDER[legBarState(b, feedByKey, gameComplete)];
        if (!colorAsc) cmp = -cmp;
        break;
      }
      case "tackles":
      case "goals":
      case "disposals":
      case "marks":
      case "sportsbet":
      case "paper": {
        cmp = compareNeed(a, b, feedByKey, gameComplete);
        if (cmp === 0) cmp = compareProgressDesc(a, b, feedByKey, gameComplete);
        if (cmp === 0) cmp = compareNumber(a, b);
        break;
      }
    }
    if (cmp !== 0) return cmp;

    // Tie-breakers: need → number → stat
    cmp = compareNeed(a, b, feedByKey, gameComplete);
    if (cmp !== 0) return cmp;
    cmp = compareNumber(a, b);
    if (cmp !== 0) return cmp;
    return compareStat(a, b);
  });
}

function LegProgressBar({
  current,
  target,
  statType,
  cleared,
  failed,
  voided,
}: {
  current: number;
  target: number;
  statType: string;
  cleared: boolean;
  failed: boolean;
  voided?: boolean;
}) {
  const theme = statThemeFor(statType);
  const state = voided
    ? "empty"
    : barStateFromCounts(current, target, statType, cleared, failed);
  const pct = cleared ? 100 : target > 0 ? Math.min(100, (current / target) * 100) : 0;
  const widthPct = state === "empty" ? 0 : Math.min(100, pct);
  const barColor = voided
    ? "bg-slate-500"
    : state === "red"
      ? "bg-accent-loss"
      : state === "green"
        ? "bg-accent-win"
        : state === "orange"
          ? "bg-accent-pending"
          : state === "blue"
            ? theme?.bar ?? "bg-accent"
            : "bg-surface";
  const markerColor = voided
    ? "bg-slate-400"
    : state === "red"
      ? "bg-accent-loss"
      : state === "green"
        ? "bg-accent-win"
        : state === "orange"
          ? "bg-accent-pending"
          : theme?.marker ?? "bg-accent";
  const barFillStyle =
    state === "blue" && theme ? { backgroundColor: theme.barHex } : undefined;
  const markerFillStyle =
    state === "blue" && theme ? { backgroundColor: theme.markerHex } : undefined;

  return (
    <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface">
      <div
        className={`absolute inset-y-0 left-0 rounded-full transition-all ${barColor}`}
        style={{ width: `${widthPct}%`, ...barFillStyle }}
      />
      {current > 0 && (state === "blue" || state === "orange") ? (
        <div
          className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white ${markerColor}`}
          style={{ left: `${Math.min(100, pct)}%`, ...markerFillStyle }}
        />
      ) : null}
    </div>
  );
}

function LegRow({
  leg: initial,
  feedValue,
  feedActive,
  gameComplete = false,
  quickMultiPick = false,
  onUpdate,
  onMarketChange,
  onRemove,
  onVoid,
  onUnvoid,
}: {
  leg: LegState;
  /** Match Centre count when lineup approved and leg not manually tracked. */
  feedValue?: number | null;
  feedActive?: boolean;
  gameComplete?: boolean;
  /** Part of the current Quick 🔒 random pick preview. */
  quickMultiPick?: boolean;
  onUpdate: (legId: number, actualValue: number) => Promise<void>;
  onMarketChange: (legId: number, patch: LegMarketPatch) => void;
  onRemove: (legId: number) => void;
  onVoid: (legId: number, actualValue: number) => void;
  onUnvoid: (legId: number, actualValue: number) => void;
}) {
  const [count, setCount] = useState(initial.actualValue ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [fixMarket, setFixMarket] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [unvoiding, setUnvoiding] = useState(false);

  useEffect(() => {
    setCount(initial.actualValue ?? 0);
  }, [initial.actualValue, initial.statType, initial.line]);

  const target = lineTarget(initial.line);
  const feedMap =
    feedValue != null
      ? { [playerRecordKey(initial.playerName ?? "", initial.statType)]: feedValue }
      : undefined;
  const displayCount = legCount(initial, feedMap, gameComplete);
  const showingFeed =
    Boolean(feedActive) &&
    initial.result === "pending" &&
    feedValue != null &&
    (initial.actualValue == null || initial.actualValue === 0);
  const isVoid = initial.result === "void";
  const cleared = !isVoid && legCleared(initial, displayCount, gameComplete);
  const failed = legFailed(initial, displayCount, gameComplete);
  const resultFinal =
    initial.result === "hit" || initial.result === "miss" || initial.result === "void";

  const persist = useCallback(
    async (next: number) => {
      const v = Math.max(0, Math.floor(next));
      setCount(v);
      setSaving(true);
      setError(null);
      try {
        await onUpdate(initial.legId, v);
      } catch (err) {
        setError((err as Error).message);
        setCount(initial.actualValue ?? 0);
      } finally {
        setSaving(false);
      }
    },
    [initial.actualValue, initial.legId, onUpdate],
  );

  function bump(delta: number) {
    if (initial.result === "hit" || initial.result === "miss") return;
    void persist(displayCount + delta);
  }

  function commitDraft() {
    const v = draft.trim() === "" ? 0 : Number(draft);
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
      setError("Enter a whole number");
      return;
    }
    setEditing(false);
    void persist(v);
  }

  async function removeThisLeg() {
    const name = initial.playerName ?? "this leg";
    if (!window.confirm(`Remove ${name} (${initial.statType} ${targetLabel(initial.line)})?`)) {
      return;
    }
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/bets/legs/${initial.legId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "remove failed");
      onRemove(initial.legId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemoving(false);
    }
  }

  async function voidThisLeg() {
    const name = initial.playerName ?? "this player";
    if (
      !window.confirm(
        `Void ${name}? Injury/sub — leg drops from the multi but you can still tap +/− to record stats before injury.`,
      )
    ) {
      return;
    }
    setVoiding(true);
    setError(null);
    try {
      const res = await fetch(`/api/bets/legs/${initial.legId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result: "void", actualValue: displayCount }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "void failed");
      onVoid(initial.legId, displayCount);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setVoiding(false);
    }
  }

  async function unvoidThisLeg() {
    const name = initial.playerName ?? "this player";
    if (
      !window.confirm(
        `Undo void on ${name}? The leg will count toward the multi again (keeps the ${count} you've tracked).`,
      )
    ) {
      return;
    }
    setUnvoiding(true);
    setError(null);
    try {
      const res = await fetch(`/api/bets/legs/${initial.legId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result: "pending", actualValue: displayCount }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "undo void failed");
      onUnvoid(initial.legId, displayCount);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUnvoiding(false);
    }
  }

  const c = teamColors(initial.team ?? "");
  const margin =
    displayCount > 0 || initial.actualValue != null
      ? marginVsTarget(displayCount, initial.line)
      : null;
  const marketTheme = statThemeFor(initial.statType);
  const marketLabel = `${initial.statType} ${targetLabel(initial.line)}`;
  const marketClass = marketTheme
    ? `shrink-0 rounded px-1 py-px text-[10px] capitalize ${marketTheme.pill}`
    : "shrink-0 text-[10px] capitalize text-slate-500";
  const locked = !initial.paper;

  const statusIcon =
    initial.result === "hit" || cleared ? (
      <span className="text-accent-win">✓</span>
    ) : initial.result === "miss" ? (
      <span className="text-accent-loss">✗</span>
    ) : isVoid ? (
      <span className="rounded bg-slate-600/60 px-1 text-[9px] font-semibold uppercase tracking-wide text-slate-300">
        Void
      </span>
    ) : null;

  return (
    <li
      className={`flex flex-col rounded-md border bg-surface/30${
        quickMultiPick
          ? " border-amber-400/70 ring-1 ring-amber-400/40 bg-amber-500/[0.06]"
          : initial.paper
            ? " border-violet-500/25"
            : " border-surface-border/50"
      }${isVoid ? " opacity-90" : ""}${error ? " ring-1 ring-accent-loss" : ""}`}
      title={
        error ??
        (quickMultiPick
          ? "In your Quick 🔒 ticket preview — log from Squad board when ready"
          : locked
            ? "Sportsbet slip — +/- tracks live; can't edit market or remove"
            : undefined)
      }
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold"
          style={jumperBadgeStyle(c)}
        >
          {initial.jumper ?? "–"}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 leading-tight">
            <span className="truncate text-xs font-medium text-white">
              {initial.playerName ?? "Player"}
            </span>
            {locked ? (
              <span
                className="shrink-0 text-[11px] text-slate-400"
                title="Sportsbet slip — use +/- while watching; MC auto-fills when live"
                aria-label="Sportsbet slip"
              >
                🔒
              </span>
            ) : (
              <span className="shrink-0 rounded bg-violet-500/15 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-violet-200">
                Paper
              </span>
            )}
            {!resultFinal && !fixMarket && !locked ? (
              <button
                type="button"
                onClick={() => setFixMarket(true)}
                className={`${marketClass} underline decoration-dotted underline-offset-2 hover:opacity-90`}
                title="Fix wrong stat or line"
              >
                {marketLabel}
              </button>
            ) : (
              <span className={marketClass}>{marketLabel}</span>
            )}
            {statusIcon}
            {margin != null && (initial.result === "hit" || initial.result === "miss") ? (
              <span
                className={`shrink-0 text-[10px] ${margin >= 0 ? "text-accent-win" : "text-accent-loss"}`}
              >
                ({signed(margin)})
              </span>
            ) : isVoid && count > 0 ? (
              <span className="shrink-0 text-[10px] text-slate-500">
                · {count} before injury
              </span>
            ) : null}
            {initial.result === "pending" && !fixMarket && !locked ? (
              <>
                <button
                  type="button"
                  onClick={voidThisLeg}
                  disabled={voiding || saving}
                  className="shrink-0 text-[10px] text-slate-500 hover:text-slate-300 disabled:opacity-40"
                  title="Void leg (injury/sub)"
                >
                  Void
                </button>
                <button
                  type="button"
                  onClick={removeThisLeg}
                  disabled={removing}
                  className="shrink-0 text-[10px] text-slate-600 hover:text-accent-loss disabled:opacity-40"
                  title="Remove this leg"
                >
                  ×
                </button>
              </>
            ) : null}
            {isVoid && !locked ? (
              <button
                type="button"
                onClick={unvoidThisLeg}
                disabled={unvoiding || saving}
                className="shrink-0 text-[10px] text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-300 disabled:opacity-40"
                title="Mistapped void — restore leg to the multi"
              >
                Undo void
              </button>
            ) : null}
          </div>
        </div>

        {initial.result === "hit" || initial.result === "miss" ? (
          <span className="w-7 shrink-0 text-center text-sm font-bold tabular-nums text-white">
            {count}
          </span>
        ) : (
          <div className="flex shrink-0 items-center gap-0.5">
            {editing ? (
              <input
                autoFocus
                className="w-9 rounded border border-surface-border bg-surface px-1 py-0.5 text-center text-xs text-white"
                inputMode="numeric"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitDraft();
                  if (e.key === "Escape") setEditing(false);
                }}
                onBlur={commitDraft}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded border border-surface-border text-sm text-slate-300 hover:border-accent hover:text-accent disabled:opacity-40"
                  onClick={() => bump(-1)}
                  disabled={saving || displayCount <= 0}
                  aria-label={`Remove one ${initial.statType}`}
                >
                  −
                </button>
                <button
                  type="button"
                  className={`min-w-[1.25rem] text-center text-sm font-bold tabular-nums hover:text-accent ${
                    showingFeed ? "text-accent" : "text-white"
                  }`}
                  onClick={() => {
                    setDraft(String(displayCount));
                    setEditing(true);
                  }}
                  disabled={saving}
                  title={
                    locked
                      ? showingFeed
                        ? "Match Centre count — tap to override"
                        : "Tap to type count"
                      : showingFeed
                        ? "Match Centre count"
                        : undefined
                  }
                >
                  {displayCount}
                </button>
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded border border-surface-border text-sm text-slate-300 hover:border-accent hover:text-accent disabled:opacity-40"
                  onClick={() => bump(1)}
                  disabled={saving}
                  aria-label={`Add one ${initial.statType}`}
                >
                  +
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 px-2 pb-1.5 pl-8">
        <LegProgressBar
          current={displayCount}
          target={target}
          statType={initial.statType}
          cleared={cleared}
          failed={failed}
          voided={isVoid}
        />
        <span
          className={`shrink-0 text-[10px] tabular-nums ${marketTheme ? "text-slate-400" : "text-slate-500"}`}
        >
          {isVoid ? (
            `${displayCount} tracked`
          ) : (
            <>
              <span className={marketTheme ? "text-slate-300" : undefined}>
                {displayCount}/{target}+
              </span>
              {showingFeed ? (
                <span
                  className={`ml-1 ${marketTheme?.accent ?? "text-accent"}`}
                  title="From Match Centre feed"
                >
                  MC
                </span>
              ) : null}
            </>
          )}
        </span>
      </div>

      {fixMarket && initial.result === "pending" && !locked ? (
        <LegMarketEditor
          legId={initial.legId}
          statType={initial.statType}
          line={initial.line}
          onCancel={() => setFixMarket(false)}
          onSaved={(patch) => {
            onMarketChange(initial.legId, patch);
            setCount(0);
            setFixMarket(false);
          }}
          onRemove={() => {
            setFixMarket(false);
            onRemove(initial.legId);
          }}
        />
      ) : null}
    </li>
  );
}

interface SlipOutcome {
  betId: number;
  status: string;
  hit: number;
  miss: number;
  pending: number;
  total: number;
}

function GameOverSection({
  gameId,
  pending,
  live,
  onRefresh,
  trackerLegs,
  celebratedSlips,
}: {
  gameId: number;
  pending: number;
  live: boolean;
  onRefresh: () => void;
  trackerLegs: BetTrackerLeg[];
  celebratedSlips: MutableRefObject<Set<number>>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [slips, setSlips] = useState<SlipOutcome[] | null>(null);

  async function gameOver() {
    setBusy(true);
    setMsg(null);
    setSlips(null);
    try {
      const res = await fetch(`/api/games/${gameId}/game-over`, { method: "POST" });
      const text = await res.text();
      let json: {
        ok?: boolean;
        error?: string;
        settlement?: {
          hydrated?: number;
          fromStats?: { legsSettled?: number };
          fromLive?: { legsSettled?: number };
        };
        legs?: {
          hit: number;
          miss: number;
          pending: number;
          pendingMissingCounts?: number;
          total: number;
        };
        slips?: SlipOutcome[];
      };
      try {
        json = JSON.parse(text) as typeof json;
      } catch {
        throw new Error(
          res.ok
            ? "Server returned an invalid response"
            : text.slice(0, 120) || "settle failed — try again",
        );
      }
      if (!res.ok || !json.ok) throw new Error(json.error || "settle failed");

      const { legs, slips: slipOutcomes } = json;
      if (!legs || !slipOutcomes) throw new Error("settle failed");
      setSlips(slipOutcomes);

      const totalSettled =
        (json.settlement?.hydrated ?? 0) +
        (json.settlement?.fromStats?.legsSettled ?? 0) +
        (json.settlement?.fromLive?.legsSettled ?? 0);

      if (legs.pending === 0) {
        const voided = slipOutcomes.some((s) => s.status === "void");
        const won = slipOutcomes.some((s) => s.status === "won");
        const lost = slipOutcomes.some((s) => s.status === "lost");
        if (voided) {
          setMsg("Void leg(s) — stake returned. Check the Bets tab.");
        } else if (won) {
          setMsg("Multi won — every leg cleared.");
          const freshWin = slipOutcomes.some(
            (s) => s.status === "won" && !celebratedSlips.current.has(s.betId),
          );
          for (const s of slipOutcomes) {
            if (s.status === "won") celebratedSlips.current.add(s.betId);
          }
          if (freshWin) void celebrateMultiLand();
        } else if (lost) {
          const missSlips = slipOutcomes.filter((s) => s.status === "lost");
          const closest = missSlips[0];
          setMsg(
            closest
              ? `Multi lost — ${closest.miss} leg${closest.miss === 1 ? "" : "s"} missed (${closest.hit}/${closest.total} hit).`
              : "Multi lost.",
          );
        } else {
          setMsg(`All ${legs.total} legs settled.`);
        }
      } else if (totalSettled === 0) {
        if ((legs.pendingMissingCounts ?? 0) > 0) {
          setMsg(
            `Enter final stats for ${legs.pendingMissingCounts} pending leg(s) using + above, then try again.`,
          );
        } else {
          setMsg(
            "Nothing new to settle yet — AFL Tables may not have published stats. Keep tapping + or try again later.",
          );
        }
      } else {
        setMsg(
          `Settled ${totalSettled} leg${totalSettled === 1 ? "" : "s"}. ${legs.pending} still pending — adjust counts above or use the Bets tab.`,
        );
      }

      onRefresh();
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t border-surface-border pt-3">
      <div>
        <button
          type="button"
          className="btn w-full"
          onClick={gameOver}
          disabled={busy}
        >
          {busy ? "Settling…" : "🏁 Game over — settle my bets"}
        </button>
        {live ? (
          <p className="mt-1.5 text-[11px] text-accent-pending">
            Game still live — tap + for each leg, then Game over when full time.
          </p>
        ) : (
          <p className="mt-1.5 text-[11px] text-slate-500">
            After full time, Game over saves <strong className="font-medium text-slate-400">0</strong>{" "}
            for legs you didn&apos;t tap — void legs (stake back) don&apos;t need counts. AFL
            Tables fills learning stats when published.
          </p>
        )}
      </div>

      {msg ? (
        <p
          className={`text-sm ${
            msg.includes("won") ? "text-accent-win" : msg.includes("lost") ? "text-accent-loss" : "text-slate-300"
          }`}
        >
          {msg}
        </p>
      ) : null}

      {slips && slips.length > 0 && pending === 0 ? (
        <ul className="space-y-1 text-xs text-slate-400">
          {slips.map((s) => (
            <li key={s.betId}>
              Slip #{s.betId}:{" "}
              <span
                className={
                  s.status === "won"
                    ? "font-semibold text-accent-win"
                    : s.status === "lost"
                      ? "font-semibold text-accent-loss"
                      : "text-slate-300"
                }
              >
                {s.status}
              </span>
              {" · "}
              {s.hit}/{s.total} legs hit
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function LiveBetTracker({
  legs: initialLegs,
  gameId,
  round = null,
  commenceTimeIso,
  gameComplete = false,
  initialLegFeed = {},
  initialStatsUpdatedAt = null,
  embedded = false,
}: {
  legs: BetTrackerLeg[];
  gameId: number;
  round?: number | null;
  /** AWST kickoff — poll MC from bounce even if Squiggle lags. */
  commenceTimeIso?: string;
  /** Full time — skip live Squiggle poll; bars render from SSR feed + settled actuals. */
  gameComplete?: boolean;
  /** Match Centre counts from server render — instant progress bars on hard refresh. */
  initialLegFeed?: Record<string, number>;
  initialStatsUpdatedAt?: string | null;
  /** When wrapped in CollapsibleSection — drop outer card chrome. */
  embedded?: boolean;
}) {
  const router = useRouter();
  const [legs, setLegs] = useState(initialLegs);
  const [live, setLive] = useState(false);
  const [feedByKey, setFeedByKey] = useState<Record<string, number>>(initialLegFeed);
  const [feedMessage, setFeedMessage] = useState<string | null>(null);
  const [statsUpdatedAt, setStatsUpdatedAt] = useState<string | null>(initialStatsUpdatedAt);
  const [pollChecking, setPollChecking] = useState(false);
  const [pollUpdatedAt, setPollUpdatedAt] = useState<Date | null>(null);
  const [gameTimestr, setGameTimestr] = useState<string | null>(null);
  const [preflightReady, setPreflightReady] = useState<boolean | null>(null);
  const [preflightHints, setPreflightHints] = useState<string[]>([]);
  const [kickedOff, setKickedOff] = useState(false);
  const [syncingMc, setSyncingMc] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("need");
  const [colorSortAsc, setColorSortAsc] = useState(true);
  const celebratedSlips = useRef(new Set<number>());
  const [quickMultiBusy, setQuickMultiBusy] = useState(false);
  const [quickMultiMsg, setQuickMultiMsg] = useState<string | null>(null);
  const [quickMultiHighlight, setQuickMultiHighlight] = useState<Set<string>>(
    () => new Set(),
  );
  const [quickMultiSize, setQuickMultiSize] = useState<5 | 7 | 10 | null>(null);

  useEffect(() => {
    setLegs(initialLegs);
  }, [initialLegs]);

  useEffect(() => {
    const byBet = new Map<number, BetTrackerLeg[]>();
    for (const leg of legs) {
      const list = byBet.get(leg.betId) ?? [];
      list.push(leg);
      byBet.set(leg.betId, list);
    }
    for (const [betId, slipLegs] of byBet) {
      if (celebratedSlips.current.has(betId)) continue;
      if (slipLanded(slipLegs, feedByKey, gameComplete)) {
        celebratedSlips.current.add(betId);
        void celebrateMultiLand();
      }
    }
  }, [legs, feedByKey, gameComplete]);

  useEffect(() => {
    setFeedByKey(initialLegFeed);
    setStatsUpdatedAt(initialStatsUpdatedAt);
  }, [initialLegFeed, initialStatsUpdatedAt]);

  const kickoffMs = commenceTimeIso ? new Date(commenceTimeIso).getTime() : null;

  const applyStatsJson = useCallback((statsJson: Record<string, unknown>) => {
    if (statsJson.ok !== true) return;
    setFeedMessage((statsJson.message as string | null) ?? null);
    setStatsUpdatedAt((statsJson.statsUpdatedAt as string | null) ?? null);
    const preflight = statsJson.preflight as { ready?: boolean; hints?: string[] } | undefined;
    if (preflight) {
      setPreflightReady(preflight.ready === true);
      setPreflightHints(Array.isArray(preflight.hints) ? preflight.hints : []);
    }
    const next: Record<string, number> = {};
    const legFeed = statsJson.legFeed as Record<string, { value?: number | null }> | undefined;
    if (legFeed) {
      for (const [k, v] of Object.entries(legFeed)) {
        if (v?.value != null) next[k] = v.value;
      }
    }
    setFeedByKey(next);
  }, []);

  const refreshMcNow = useCallback(async () => {
    setSyncingMc(true);
    setPollChecking(true);
    try {
      const res = await fetch(`/api/games/${gameId}/live-stats/sync`, { method: "POST" });
      const json = await res.json();
      if (res.ok && json.ok) {
        applyStatsJson(json);
        setPollUpdatedAt(new Date());
      }
    } catch {
      /* best-effort */
    } finally {
      setSyncingMc(false);
      setPollChecking(false);
    }
  }, [applyStatsJson, gameId]);

  useEffect(() => {
    if (gameComplete) {
      const seeded = Object.keys(initialLegFeed).length > 0;
      if (seeded) return;
      let cancelled = false;
      void (async () => {
        try {
          const statsRes = await fetch(`/api/games/${gameId}/live-stats`);
          const statsJson = await statsRes.json();
          if (!cancelled && statsJson.ok) applyStatsJson(statsJson);
        } catch {
          /* best-effort */
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    async function tick() {
      setPollChecking(true);
      try {
        const [liveRes, statsRes] = await Promise.all([
          fetch(`/api/games/${gameId}/live`),
          fetch(`/api/games/${gameId}/live-stats`),
        ]);
        const liveJson = await liveRes.json();
        const statsJson = await statsRes.json();
        if (cancelled) return;

        const kickedOffNow = kickoffMs != null && Date.now() >= kickoffMs;
        setKickedOff(kickedOffNow);
        const isLive =
          liveJson.state?.status === "live" || statsJson.gameLive === true;
        setLive(isLive);
        if (typeof liveJson.state?.timestr === "string" && liveJson.state.timestr) {
          setGameTimestr(liveJson.state.timestr);
        }

        if (statsJson.ok) {
          applyStatsJson(statsJson);
        }

        setPollUpdatedAt(new Date());

        if (isLive || statsJson.gameLive || kickedOffNow) {
          timer = setTimeout(tick, TRACKER_POLL_MS);
        }
      } catch {
        /* best-effort */
      } finally {
        if (!cancelled) setPollChecking(false);
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [gameId, kickoffMs, applyStatsJson, gameComplete, initialLegFeed]);

  const updateCount = useCallback(async (legId: number, actualValue: number) => {
    const res = await fetch(`/api/bets/legs/${legId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actualValue }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || "save failed");
    setLegs((prev) =>
      prev.map((l) => (l.legId === legId ? { ...l, actualValue } : l)),
    );
  }, []);

  const updateMarket = useCallback((legId: number, patch: LegMarketPatch) => {
    setLegs((prev) =>
      prev.map((l) => (l.legId === legId ? { ...l, ...patch, result: "pending" } : l)),
    );
  }, []);

  const removeLeg = useCallback(
    (legId: number) => {
      setLegs((prev) => prev.filter((l) => l.legId !== legId));
      router.refresh();
    },
    [router],
  );

  const voidLeg = useCallback(
    (legId: number, actualValue: number) => {
      setLegs((prev) =>
        prev.map((l) =>
          l.legId === legId ? { ...l, result: "void" as const, actualValue } : l,
        ),
      );
    },
    [],
  );

  const unvoidLeg = useCallback((legId: number, actualValue: number) => {
    setLegs((prev) =>
      prev.map((l) =>
        l.legId === legId ? { ...l, result: "pending" as const, actualValue } : l,
      ),
    );
  }, []);

  const mcActive = live || kickedOff;

  const voids = legs.filter((l) => l.result === "void").length;
  const voidsMissingStats = legs.filter(
    (l) => l.result === "void" && l.actualValue == null,
  ).length;
  const activeLegs = legs.filter((l) => l.result !== "void");
  const quickMultiStatFilter = STAT_FILTER_MODES.includes(sortMode)
    ? (sortMode as TrackerStat)
    : null;
  /** Paper legs only — locked rows are already on the book. Stat tab narrows the pool. */
  const quickMultiPool = useMemo(() => {
    let pool = activeLegs.filter((l) => l.paper);
    if (quickMultiStatFilter) {
      pool = pool.filter((l) => l.statType === quickMultiStatFilter);
    }
    return uniqueTrackerLegs(pool);
  }, [activeLegs, quickMultiStatFilter]);
  const paperLegCount = activeLegs.filter((l) => l.paper).length;
  const lockedLegCount = activeLegs.filter((l) => !l.paper).length;
  const cleared = activeLegs.filter((leg) =>
    legCleared(leg, legCount(leg, feedByKey, gameComplete), gameComplete),
  ).length;
  const pending = legs.filter((l) => l.result === "pending").length;
  const hits = legs.filter((l) => l.result === "hit").length;
  const misses = legs.filter((l) => l.result === "miss").length;
  const allSettled = legs.length > 0 && pending === 0;
  const statProgress = useMemo(() => {
    const totals: Record<TrackerStat, number> = {
      tackles: 0,
      goals: 0,
      disposals: 0,
      marks: 0,
    };
    const clearedByStat: Record<TrackerStat, number> = {
      tackles: 0,
      goals: 0,
      disposals: 0,
      marks: 0,
    };
    for (const leg of legs) {
      if (!isTrackerStat(leg.statType) || leg.result === "void") continue;
      totals[leg.statType]++;
      if (legCleared(leg, legCount(leg, feedByKey, gameComplete), gameComplete)) {
        clearedByStat[leg.statType]++;
      }
    }
    return { totals, cleared: clearedByStat };
  }, [legs, feedByKey, gameComplete]);

  const slipProgress = useMemo(() => {
    let lockedTotal = 0;
    let lockedCleared = 0;
    let paperTotal = 0;
    let paperCleared = 0;
    for (const leg of legs) {
      if (leg.result === "void") continue;
      const hit = legCleared(leg, legCount(leg, feedByKey, gameComplete), gameComplete);
      if (leg.paper) {
        paperTotal++;
        if (hit) paperCleared++;
      } else {
        lockedTotal++;
        if (hit) lockedCleared++;
      }
    }
    return { lockedTotal, lockedCleared, paperTotal, paperCleared };
  }, [legs, feedByKey, gameComplete]);

  const filteredLegs = useMemo(() => {
    if (sortMode === "sportsbet") {
      return legs.filter((l) => !l.paper);
    }
    if (sortMode === "paper") {
      return legs.filter((l) => l.paper);
    }
    if (STAT_FILTER_MODES.includes(sortMode)) {
      return legs.filter((l) => l.statType === sortMode);
    }
    return legs;
  }, [legs, sortMode]);

  const sortedLegs = useMemo(
    () => sortTrackerLegs(filteredLegs, sortMode, colorSortAsc, feedByKey, gameComplete),
    [filteredLegs, sortMode, colorSortAsc, feedByKey, gameComplete],
  );

  function handleSortClick(key: SortMode) {
    if (key === "color" && sortMode === "color") {
      setColorSortAsc((v) => !v);
    } else {
      setSortMode(key);
      if (key === "color") setColorSortAsc(true);
    }
  }

  function buildQuickMulti(n: 5 | 7 | 10) {
    const pool = quickMultiPool;
    const statLabel = quickMultiStatFilter
      ? STAT_THEME[quickMultiStatFilter].label.toLowerCase()
      : null;
    if (pool.length < n) {
      setQuickMultiMsg(
        paperLegCount === 0
          ? `Need ${n} paper legs in tracker — log paper multis first, or use Paper filter.`
          : statLabel
            ? `Only ${pool.length} unique paper ${statLabel} leg${pool.length === 1 ? "" : "s"} — need ${n} for a ${n}-leg ${statLabel} multi.`
            : `Only ${pool.length} unique paper player×stat leg${pool.length === 1 ? "" : "s"} — need ${n} for a ${n}-leg multi.`,
      );
      return;
    }
    setQuickMultiBusy(true);
    setQuickMultiMsg(null);
    try {
      const picked = sampleLegs(pool, n);
      const highlightKeys = picked.map((l) =>
        playerRecordKey(l.playerName ?? "", l.statType),
      );
      setQuickMultiHighlight(new Set(highlightKeys));
      setQuickMultiSize(n);

      dispatchQuickMultiFilled({
        gameId,
        legCount: picked.length,
        highlightKeys,
        legs: picked.map((l) => ({
          playerName: l.playerName ?? "",
          statType: l.statType as StatType,
          line: l.line,
          odds: l.odds,
          prediction: l.prediction,
          team: l.team,
          jumper: l.jumper,
        })),
      });

      setQuickMultiMsg(
        statLabel
          ? `Random ${picked.length}-leg 🔒 ${statLabel} preview — highlighted here & on Your ticket. Tap ${n} again for another mix, then Log this multi.`
          : `Random ${picked.length}-leg 🔒 preview — highlighted here & on Your ticket below. Tap ${n} again for another mix, then Log this multi.`,
      );
    } finally {
      setQuickMultiBusy(false);
    }
  }

  const showLiveBar = live || (kickedOff && (gameTimestr != null || pollUpdatedAt != null));
  const pollTitle = statsUpdatedAt
    ? `Match Centre synced ${new Date(statsUpdatedAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })} · polls every ${TRACKER_POLL_MS / 1000}s`
    : `Polls every ${TRACKER_POLL_MS / 1000}s`;

  return (
    <section
      className={
        embedded
          ? live
            ? "rounded-lg border border-accent/40 p-2 sm:p-3"
            : ""
          : `card ${live ? "border-accent/40" : "border-accent/20"}`
      }
    >
      {showLiveBar ? (
        <div className="mb-3 flex flex-col gap-3 border-b border-surface-border/40 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
            {live ? (
              <span className="whitespace-nowrap text-xs font-medium text-accent-loss">
                ● Live
                <LiveRefreshCountdown
                  checking={pollChecking || syncingMc}
                  lastUpdatedAt={pollUpdatedAt}
                  intervalMs={TRACKER_POLL_MS}
                  title={pollTitle}
                  className="text-accent-loss/70"
                />
              </span>
            ) : (
              <span className="text-xs font-medium text-slate-400">In progress</span>
            )}
            {gameTimestr ? (
              <span className="text-sm font-semibold tabular-nums text-white">{gameTimestr}</span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-4 sm:gap-5">
            {live ? (
              <button
                type="button"
                onClick={() => void refreshMcNow()}
                disabled={syncingMc}
                className="rounded border border-surface-border px-3 py-1 text-xs font-medium text-slate-300 hover:bg-surface-border/40 disabled:opacity-50"
              >
                {syncingMc ? "Syncing…" : "Refresh MC"}
              </button>
            ) : null}
            <div className="text-right">
              <div className="text-lg font-bold leading-tight text-white">
                {cleared}
                <span className="text-slate-500"> / </span>
                {activeLegs.length}
              </div>
              <div className="text-[11px] text-slate-400">
                {voids > 0 ? `${voids} void · ` : ""}
                legs cleared
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {embedded ? null : (
              <h2 className="text-sm font-semibold uppercase tracking-wide text-accent">
                Your bets in this game
              </h2>
            )}
            <p className="mt-0.5 text-xs text-slate-500">
              {voids > 0
                ? "Void legs still accept +/− — record stats before injury."
                : preflightReady === false
                  ? "Fix pre-bounce checklist below before bounce — MC after first play."
                  : "Tap +/− on any leg while watching · 🔒 = Sportsbet slip · MC auto after bounce."}
            </p>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-white">
              {cleared}
              <span className="text-slate-500"> / </span>
              {activeLegs.length}
            </div>
            <div className="text-[11px] text-slate-400">
              {voids > 0 ? `${voids} void · ` : ""}
              legs cleared
            </div>
          </div>
        </div>
      )}

      {!showLiveBar && !live && preflightReady === false && preflightHints.length > 0 ? (
        <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-xs text-amber-100">
          <p className="font-medium text-amber-50">Before bounce — live stats checklist</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-amber-100/90">
            {preflightHints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!showLiveBar && !live && preflightReady === true && preflightHints.length > 0 ? (
        <p className="mb-2 text-xs text-emerald-200/90">{preflightHints[0]}</p>
      ) : null}

      {activeLegs.length > 0 && paperLegCount > 0 && lockedLegCount > 0 ? (
        <p className="text-[10px] text-slate-500">
          Tap <span className="text-slate-300">🔒 $$</span> or{" "}
          <span className="text-violet-300">Paper</span> to filter by slip type
        </p>
      ) : null}

      <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-1">
        {SORT_OPTIONS.map((opt) => {
          const total = isTrackerStat(opt.key) ? statProgress.totals[opt.key] : 0;
          const statCleared = isTrackerStat(opt.key) ? statProgress.cleared[opt.key] : 0;
          let label = opt.label;
          if (opt.key === "color" && sortMode === "color") {
            label = `Color ${colorSortAsc ? "↓" : "↑"}`;
          } else if (total > 0 && isTrackerStat(opt.key)) {
            label = `${opt.label} ${statCleared}/${total}`;
          } else if (opt.key === "sportsbet" && slipProgress.lockedTotal > 0) {
            label = `🔒 $$ ${slipProgress.lockedCleared}/${slipProgress.lockedTotal}`;
          } else if (opt.key === "paper" && slipProgress.paperTotal > 0) {
            label = `Paper ${slipProgress.paperCleared}/${slipProgress.paperTotal}`;
          }
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => handleSortClick(opt.key)}
              className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium ${sortTabClass(opt.key, sortMode === opt.key)}`}
            >
              {label}
            </button>
          );
        })}
        {paperLegCount > 0 ? (
          <div className="ml-auto flex shrink-0 items-center gap-1 border-l border-surface-border/60 pl-2">
            <span className="hidden text-[10px] text-slate-500 sm:inline">Quick 🔒</span>
            {([5, 7, 10] as const).map((n) => (
              <button
                key={n}
                type="button"
                title={
                  quickMultiPool.length < n
                    ? quickMultiStatFilter
                      ? `Need ${n} unique paper ${STAT_THEME[quickMultiStatFilter].label.toLowerCase()} legs (have ${quickMultiPool.length})`
                      : `Need ${n} unique paper player×stat legs (have ${quickMultiPool.length})`
                    : quickMultiStatFilter
                      ? `Random ${n}-leg ${STAT_THEME[quickMultiStatFilter].label.toLowerCase()} preview — tap again to re-roll`
                      : `Random ${n}-leg Sportsbet preview from any stat — tap again to re-roll`
                }
                disabled={quickMultiPool.length < n || quickMultiBusy}
                onClick={() => buildQuickMulti(n)}
                className={`min-w-[1.75rem] rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums disabled:cursor-not-allowed disabled:opacity-40 ${
                  quickMultiSize === n
                    ? "border-amber-300 bg-amber-500/25 text-amber-50 ring-1 ring-amber-400/50"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {quickMultiMsg ? (
        <p
          className={`text-[11px] ${
            quickMultiMsg.includes("preview") ? "text-accent-win" : "text-accent-loss"
          }`}
        >
          {quickMultiMsg}
        </p>
      ) : null}
      {isTrackerStat(sortMode) ? (
        <p className="text-[10px] text-slate-500">
          {statProgress.cleared[sortMode]}/{statProgress.totals[sortMode]}{" "}
          {STAT_THEME[sortMode].label.toLowerCase()} legs cleared · sorted by need then closest
          to the line
        </p>
      ) : null}
      {sortMode === "sportsbet" ? (
        <p className="text-[10px] text-slate-500">
          {slipProgress.lockedCleared}/{slipProgress.lockedTotal} Sportsbet legs cleared · locked
          on the book · sorted by need then closest to the line
        </p>
      ) : null}
      {sortMode === "paper" ? (
        <p className="text-[10px] text-slate-500">
          {slipProgress.paperCleared}/{slipProgress.paperTotal} paper legs cleared · editable ·
          sorted by need then closest to the line
        </p>
      ) : null}
      {sortMode === "color" ? (
        <p className="text-[10px] text-slate-500">
          {colorSortAsc
            ? "Red → green → orange → blue → empty — tap Color again to reverse"
            : "Empty → blue → orange → green → red"}
        </p>
      ) : null}

      {feedMessage && live ? (
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-100">
          <p>{feedMessage}</p>
          {!statsUpdatedAt ? (
            <button
              type="button"
              onClick={() => void refreshMcNow()}
              disabled={syncingMc}
              className="mt-1.5 rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-50 hover:bg-amber-500/30 disabled:opacity-50"
            >
              {syncingMc ? "Pulling Match Centre…" : "Pull Match Centre now"}
            </button>
          ) : null}
        </div>
      ) : null}

      <ul className="mt-2 max-h-[75vh] space-y-1 overflow-y-auto">
        {sortedLegs.map((leg) => {
          const legKey = playerRecordKey(leg.playerName ?? "", leg.statType);
          return (
            <LegRow
              key={leg.legId}
              leg={leg}
              gameComplete={gameComplete}
              quickMultiPick={quickMultiHighlight.has(legKey)}
              feedValue={feedByKey[legKey] ?? null}
              feedActive={mcActive}
              onUpdate={updateCount}
              onMarketChange={updateMarket}
              onRemove={removeLeg}
              onVoid={voidLeg}
              onUnvoid={unvoidLeg}
            />
          );
        })}
      </ul>

      {voidsMissingStats > 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          {voidsMissingStats} void leg{voidsMissingStats === 1 ? "" : "s"} — optional +/− for
          pre-injury stats (learning only; stake already returned).
        </p>
      ) : null}

      {pending > 0 && live ? (
        <p className="mt-3 text-xs text-slate-500">
          Counts save as you tap. After full time, tap Game over to settle.
        </p>
      ) : null}

      {allSettled ? (
        <div className="mt-4 border-t border-surface-border pt-3">
          <p
            className={`text-sm font-medium ${
              voids > 0
                ? "text-slate-300"
                : misses === 0
                  ? "text-accent-win"
                  : "text-accent-loss"
            }`}
          >
            {voids > 0
              ? `${voids} injured leg${voids === 1 ? "" : "s"} voided — stake returned on Bets.`
              : misses === 0
                ? `All ${legs.length} legs hit — multi cleared.`
                : `${hits}/${activeLegs.length} active legs hit — multi lost (${misses} missed).`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Full details on the Bets page.
          </p>
        </div>
      ) : legs.length > 0 ? (
        <GameOverSection
          gameId={gameId}
          pending={pending}
          live={live}
          onRefresh={() => router.refresh()}
          trackerLegs={legs}
          celebratedSlips={celebratedSlips}
        />
      ) : null}
    </section>
  );
}
