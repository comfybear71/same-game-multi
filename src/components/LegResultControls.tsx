"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { LegResult } from "@/lib/betTypes";import { targetLabel } from "@/lib/format";

// Manual override for a leg's result — either one auto-settlement can't
// reach (no linked player/game, or AFL Tables never published the game), or
// to correct one the AI result-screenshot read got wrong (a misjudged
// tick/cross, or an actual value it couldn't read cleanly).
export function LegResultControls({
  legId,
  line,
  result,
  actualValue,
}: {
  legId: number;
  line: number;
  result: LegResult;
  actualValue: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [actual, setActual] = useState(actualValue != null ? String(actualValue) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function setResult(next: "hit" | "miss" | "void" | "pending") {
    if (
      next === "void" &&
      !window.confirm("Void this leg? Injury/sub — it drops from the multi but stats stay on your record.")
    ) {
      return;
    }
    if (
      next === "pending" &&
      !window.confirm("Undo void? This leg will count toward the multi again.")
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const actualValueOut =
        actual !== ""
          ? Number(actual)
          : next === "void"
            ? actualValue
            : null;
      const res = await fetch(`/api/bets/legs/${legId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result: next, actualValue: actualValueOut }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "failed");
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveTrackedStat() {
    if (actual.trim() === "") return;
    const v = Number(actual);
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
      setError("Enter a whole number");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/bets/legs/${legId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actualValue: v }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "failed");
      startTransition(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    if (result === "void") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="w-14 rounded border border-surface-border bg-surface px-1.5 py-0.5 text-xs text-slate-100"
            inputMode="numeric"
            placeholder="stat"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
          <button
            className="text-[11px] text-slate-400 hover:text-slate-200"
            disabled={saving}
            onClick={() => void saveTrackedStat()}
          >
            save stat
          </button>
          <button
            className="text-[11px] text-slate-500 underline hover:text-slate-300"
            disabled={saving}
            onClick={() => void setResult("pending")}
          >
            undo void
          </button>
          <button
            className="text-[11px] text-slate-500 underline hover:text-slate-300"
            onClick={() => setOpen(true)}
          >
            correct
          </button>
          {error ? <span className="text-[11px] text-accent-loss">{error}</span> : null}
        </div>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-2">
        {result === "pending" || result === "miss" ? (
          <button
            className="text-[11px] font-medium text-slate-400 hover:text-slate-200"
            disabled={saving}
            onClick={() => void setResult("void")}
          >
            Void (injured)
          </button>
        ) : null}
        <button
          className="text-[11px] text-slate-500 underline hover:text-slate-300"
          onClick={() => setOpen(true)}
        >
          {result === "pending" ? "set manually" : "correct"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        className="w-14 rounded border border-surface-border bg-surface px-1.5 py-0.5 text-xs text-slate-100"
        inputMode="numeric"
        placeholder={`vs ${targetLabel(line)}`}
        value={actual}
        onChange={(e) => setActual(e.target.value)}
      />
      <button
        className="text-[11px] font-semibold text-accent-win"
        disabled={saving}
        onClick={() => setResult("hit")}
      >
        hit
      </button>
      <button
        className="text-[11px] font-semibold text-accent-loss"
        disabled={saving}
        onClick={() => setResult("miss")}
      >
        miss
      </button>
      <button
        className="text-[11px] text-slate-400"
        disabled={saving}
        onClick={() => setResult("void")}
      >
        void
      </button>
      <button
        className="text-[11px] text-slate-500"
        disabled={saving}
        onClick={() => setOpen(false)}
      >
        cancel
      </button>
      {error ? <span className="text-[11px] text-accent-loss">{error}</span> : null}
    </div>
  );
}
