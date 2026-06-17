"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Manual override for a pending leg that auto-settlement can't reach (e.g.
// the bet wasn't linked to a game/player, or AFL Tables never published the
// game). Lets you record the real result by hand instead of it sitting on
// "pending" forever.
export function LegResultControls({ legId, line }: { legId: number; line: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [actual, setActual] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setResult(result: "hit" | "miss" | "void") {
    setSaving(true);
    setError(null);
    try {
      const actualValue =
        result === "void" || actual === "" ? null : Number(actual);
      const res = await fetch(`/api/bets/legs/${legId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result, actualValue }),
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
        set manually
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        className="w-14 rounded border border-surface-border bg-surface px-1.5 py-0.5 text-xs text-slate-100"
        inputMode="numeric"
        placeholder={`vs ${line}`}
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
