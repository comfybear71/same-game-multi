"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { LegResult } from "@/db/schema";
import { targetLabel } from "@/lib/format";

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

  async function setResult(next: "hit" | "miss" | "void") {
    setSaving(true);
    setError(null);
    try {
      const actualValueOut = next === "void" || actual === "" ? null : Number(actual);
      const res = await fetch(`/api/bets/legs/${legId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result: next, actualValue: actualValueOut }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "failed");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        className="text-[11px] text-slate-500 underline hover:text-slate-300"
        onClick={() => setOpen(true)}
      >
        {result === "pending" ? "set manually" : "correct"}
      </button>
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
