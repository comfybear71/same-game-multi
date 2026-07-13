"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { LegMarketEditor, type LegMarketPatch } from "@/components/EditLegMarket";
import { teamColors } from "@/lib/afl/teamColors";
import type { BetTrackerLeg } from "@/lib/betTypes";
import { lineTarget, marginVsTarget, signed, targetLabel } from "@/lib/format";

type LegState = BetTrackerLeg & { saving?: boolean; error?: string };

function legCleared(leg: BetTrackerLeg): boolean {
  if (leg.result === "hit") return true;
  if (leg.result === "miss" || leg.result === "void") return false;
  return leg.actualValue != null && leg.actualValue > leg.line;
}

function legFailed(leg: BetTrackerLeg): boolean {
  return leg.result === "miss";
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

function legCount(leg: BetTrackerLeg): number {
  return leg.actualValue ?? 0;
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

function legBarState(leg: BetTrackerLeg): BarState {
  return barStateFromCounts(
    legCount(leg),
    lineTarget(leg.line),
    leg.statType,
    legCleared(leg),
    legFailed(leg),
  );
}

type SortMode = "need" | "number" | "color" | "tackles" | "goals" | "disposals" | "marks";

const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: "need", label: "Need" },
  { key: "number", label: "#" },
  { key: "color", label: "Color" },
  { key: "tackles", label: "Tackles" },
  { key: "goals", label: "Goals" },
  { key: "disposals", label: "Disposals" },
  { key: "marks", label: "Marks" },
];

function legSortGroup(leg: BetTrackerLeg): number {
  if (leg.result === "miss") return 2;
  if (leg.result === "void") return 3;
  if (leg.result === "hit" || legCleared(leg)) return 1;
  return 0; // still chasing
}

function compareNeed(a: BetTrackerLeg, b: BetTrackerLeg): number {
  return legSortGroup(a) - legSortGroup(b);
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

function statPriority(statType: string, focus: SortMode): number {
  if (focus === "tackles" || focus === "goals" || focus === "disposals" || focus === "marks") {
    return statType === focus ? 0 : 1;
  }
  return 0;
}

function sortTrackerLegs(
  legs: BetTrackerLeg[],
  mode: SortMode,
  colorAsc = true,
): BetTrackerLeg[] {
  return [...legs].sort((a, b) => {
    let cmp = 0;
    switch (mode) {
      case "need":
        cmp = compareNeed(a, b);
        break;
      case "number":
        cmp = compareNumber(a, b);
        break;
      case "color": {
        cmp = BAR_STATE_ORDER[legBarState(a)] - BAR_STATE_ORDER[legBarState(b)];
        if (!colorAsc) cmp = -cmp;
        break;
      }
      case "tackles":
      case "goals":
      case "disposals":
      case "marks": {
        const pa = statPriority(a.statType, mode);
        const pb = statPriority(b.statType, mode);
        if (pa !== pb) cmp = pa - pb;
        else cmp = compareStat(a, b);
        break;
      }
    }
    if (cmp !== 0) return cmp;

    // Tie-breakers: need → number → stat
    cmp = compareNeed(a, b);
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
  const state = voided
    ? "empty"
    : barStateFromCounts(current, target, statType, cleared, failed);
  const pct = cleared ? 100 : target > 0 ? Math.min(100, (current / target) * 100) : 0;
  const barColor = voided
    ? "bg-slate-500"
    : state === "red"
      ? "bg-accent-loss"
      : state === "green"
        ? "bg-accent-win"
        : state === "orange"
          ? "bg-accent-pending"
          : state === "blue"
            ? "bg-accent"
            : "bg-surface";
  const markerColor = voided
    ? "bg-slate-400"
    : state === "red"
      ? "bg-accent-loss"
      : state === "green"
        ? "bg-accent-win"
        : state === "orange"
          ? "bg-accent-pending"
          : "bg-accent";

  return (
    <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface">
      <div
        className={`absolute inset-y-0 left-0 rounded-full transition-all ${barColor}`}
        style={{ width: `${state === "empty" ? 0 : Math.min(100, pct)}%` }}
      />
      {current > 0 && (state === "blue" || state === "orange") ? (
        <div
          className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white ${markerColor}`}
          style={{ left: `${Math.min(100, pct)}%` }}
        />
      ) : null}
    </div>
  );
}

function LegRow({
  leg: initial,
  onUpdate,
  onMarketChange,
  onRemove,
  onVoid,
  onUnvoid,
}: {
  leg: LegState;
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
  const isVoid = initial.result === "void";
  const cleared = !isVoid && legCleared({ ...initial, actualValue: count });
  const failed = legFailed(initial);
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
    void persist(count + delta);
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
        body: JSON.stringify({ result: "void", actualValue: count }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "void failed");
      onVoid(initial.legId, count);
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
        body: JSON.stringify({ result: "pending", actualValue: count }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "undo void failed");
      onUnvoid(initial.legId, count);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUnvoiding(false);
    }
  }

  const c = teamColors(initial.team ?? "");
  const margin = count > 0 || initial.actualValue != null ? marginVsTarget(count, initial.line) : null;

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
      className={`flex flex-col rounded-md border border-surface-border/50 bg-surface/30${
        isVoid ? " opacity-90" : ""
      }${error ? " ring-1 ring-accent-loss" : ""}`}
      title={error ?? undefined}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold"
          style={{ background: c.bg, color: c.fg }}
        >
          {initial.jumper ?? "–"}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 leading-tight">
            <span className="truncate text-xs font-medium text-white">
              {initial.playerName ?? "Player"}
            </span>
            {!resultFinal && !fixMarket ? (
              <button
                type="button"
                onClick={() => setFixMarket(true)}
                className="shrink-0 text-[10px] capitalize text-slate-500 underline decoration-dotted underline-offset-2 hover:text-accent"
                title="Fix wrong stat or line"
              >
                {initial.statType} {targetLabel(initial.line)}
              </button>
            ) : (
              <span className="shrink-0 text-[10px] capitalize text-slate-500">
                {initial.statType} {targetLabel(initial.line)}
              </span>
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
            {initial.result === "pending" && !fixMarket ? (
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
            {isVoid ? (
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
                  disabled={saving || count <= 0}
                  aria-label={`Remove one ${initial.statType}`}
                >
                  −
                </button>
                <button
                  type="button"
                  className="min-w-[1.25rem] text-center text-sm font-bold tabular-nums text-white hover:text-accent"
                  onClick={() => {
                    setDraft(String(count));
                    setEditing(true);
                  }}
                  disabled={saving}
                >
                  {count}
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
          current={count}
          target={target}
          statType={initial.statType}
          cleared={cleared}
          failed={failed}
          voided={isVoid}
        />
        <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
          {isVoid ? `${count} tracked` : `${count}/${target}+`}
        </span>
      </div>

      {fixMarket && initial.result === "pending" ? (
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
}: {
  gameId: number;
  pending: number;
  live: boolean;
  onRefresh: () => void;
  trackerLegs: BetTrackerLeg[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [slips, setSlips] = useState<SlipOutcome[] | null>(null);

  async function gameOver() {
    const pendingLegs = trackerLegs.filter((l) => l.result === "pending");
    const missingCounts = pendingLegs.filter((l) => l.actualValue == null);
    if (missingCounts.length > 0) {
      setMsg(
        `Enter final stats for ${missingCounts.length} leg${missingCounts.length === 1 ? "" : "s"} using + above, then tap Game over again.`,
      );
      return;
    }

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
            Tap + to enter each player&apos;s final stat, then Game over locks
            every leg and updates the Bets page — no manual entry needed.
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
}: {
  legs: BetTrackerLeg[];
  gameId: number;
}) {
  const router = useRouter();
  const [legs, setLegs] = useState(initialLegs);
  const [live, setLive] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("need");
  const [colorSortAsc, setColorSortAsc] = useState(true);

  useEffect(() => {
    setLegs(initialLegs);
  }, [initialLegs]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch(`/api/games/${gameId}/live`);
        const json = await res.json();
        if (cancelled) return;
        setLive(json.state?.status === "live");
        if (json.state?.status === "live") timer = setTimeout(tick, 20_000);
      } catch {
        /* best-effort */
      }
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [gameId]);

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

  const voids = legs.filter((l) => l.result === "void").length;
  const voidsMissingStats = legs.filter(
    (l) => l.result === "void" && l.actualValue == null,
  ).length;
  const activeLegs = legs.filter((l) => l.result !== "void");
  const cleared = activeLegs.filter(legCleared).length;
  const pending = legs.filter((l) => l.result === "pending").length;
  const hits = legs.filter((l) => l.result === "hit").length;
  const misses = legs.filter((l) => l.result === "miss").length;
  const allSettled = legs.length > 0 && pending === 0;
  const sortedLegs = useMemo(
    () => sortTrackerLegs(legs, sortMode, colorSortAsc),
    [legs, sortMode, colorSortAsc],
  );

  function handleSortClick(key: SortMode) {
    if (key === "color" && sortMode === "color") {
      setColorSortAsc((v) => !v);
    } else {
      setSortMode(key);
      if (key === "color") setColorSortAsc(true);
    }
  }

  return (
    <section className={`card ${live ? "border-accent/40" : "border-accent/20"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-accent">
            Your bets in this game
          </h2>
          {live ? (
            <p className="mt-0.5 text-xs font-medium text-accent-loss">● Live</p>
          ) : (
            <p className="mt-0.5 text-xs text-slate-500">
              {voids > 0
                ? "Void legs still accept +/− — record stats before injury."
                : "Tap + to track as you watch"}
            </p>
          )}
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

      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => handleSortClick(opt.key)}
            className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              sortMode === opt.key
                ? "bg-slate-200 text-surface"
                : "border border-surface-border text-slate-400"
            }`}
          >
            {opt.key === "color" && sortMode === "color"
              ? `Color ${colorSortAsc ? "↓" : "↑"}`
              : opt.label}
          </button>
        ))}
      </div>
      {sortMode === "color" ? (
        <p className="text-[10px] text-slate-500">
          {colorSortAsc
            ? "Red → green → orange → blue → empty — tap Color again to reverse"
            : "Empty → blue → orange → green → red"}
        </p>
      ) : null}

      <ul className="mt-2 max-h-[75vh] space-y-1 overflow-y-auto">
        {sortedLegs.map((leg) => (
          <LegRow
            key={leg.legId}
            leg={leg}
            onUpdate={updateCount}
            onMarketChange={updateMarket}
            onRemove={removeLeg}
            onVoid={voidLeg}
            onUnvoid={unvoidLeg}
          />
        ))}
      </ul>

      {voidsMissingStats > 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          {voidsMissingStats} void leg{voidsMissingStats === 1 ? "" : "s"} — tap +/− to
          record pre-injury stats.
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
        />
      ) : null}
    </section>
  );
}
