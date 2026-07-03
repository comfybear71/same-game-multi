"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { StatType } from "@/db/schema";
import { lineTarget, targetLabel } from "@/lib/format";
import { minLineTarget } from "@/lib/predictions/modelLine";

const STATS: StatType[] = ["disposals", "marks", "tackles", "goals"];

export type LegMarketPatch = {
  statType: StatType;
  line: number;
  actualValue: null;
};

export function LegMarketEditor({
  legId,
  statType: initialStat,
  line: initialLine,
  onSaved,
  onCancel,
  onRemove,
}: {
  legId: number;
  statType: string;
  line: number;
  onSaved?: (patch: LegMarketPatch) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const router = useRouter();
  const [stat, setStat] = useState<StatType>(initialStat as StatType);
  const [target, setTarget] = useState(lineTarget(initialLine));
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/bets/legs/${legId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statType: stat, target }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "save failed");
      const patch: LegMarketPatch = {
        statType: stat,
        line: target - 0.5,
        actualValue: null,
      };
      onSaved?.(patch);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!onRemove) return;
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/bets/legs/${legId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "remove failed");
      onRemove();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemoving(false);
    }
  }

  const floor = minLineTarget(stat);
  const busy = saving || removing;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-surface-border/40 px-2 py-1.5">
      <select
        className="rounded border border-surface-border bg-surface px-1.5 py-0.5 text-xs capitalize text-white"
        value={stat}
        onChange={(e) => {
          const next = e.target.value as StatType;
          setStat(next);
          setTarget((t) => Math.max(minLineTarget(next), t));
        }}
      >
        {STATS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <span className="inline-flex items-center gap-0.5">
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded border border-surface-border text-xs text-slate-300"
          onClick={() => setTarget((t) => Math.max(floor, t - 1))}
          disabled={target <= floor}
        >
          −
        </button>
        <span className="min-w-[2ch] text-center text-xs font-semibold text-white">
          {target}+
        </span>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded border border-surface-border text-xs text-slate-300"
          onClick={() => setTarget((t) => t + 1)}
        >
          +
        </button>
      </span>
      <button
        type="button"
        className="text-xs font-semibold text-accent"
        disabled={busy}
        onClick={save}
      >
        {saving ? "…" : "Save"}
      </button>
      <button
        type="button"
        className="text-xs text-slate-500"
        disabled={busy}
        onClick={onCancel}
      >
        Cancel
      </button>
      {onRemove ? (
        <button
          type="button"
          className="text-xs text-accent-loss hover:underline"
          disabled={busy}
          onClick={remove}
        >
          {removing ? "Removing…" : "Remove leg"}
        </button>
      ) : null}
      {error ? <span className="text-[11px] text-accent-loss">{error}</span> : null}
    </div>
  );
}

export function EditLegMarket({
  legId,
  statType,
  line,
  result,
  onSaved,
}: {
  legId: number;
  statType: string;
  line: number;
  result: string;
  onSaved?: (patch: LegMarketPatch) => void;
}) {
  const [open, setOpen] = useState(false);

  if (result !== "pending") return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-slate-500 underline hover:text-slate-300"
        title="Fix wrong stat or line"
      >
        fix stat/line ({statType} {targetLabel(line)})
      </button>
    );
  }

  return (
    <LegMarketEditor
      legId={legId}
      statType={statType}
      line={line}
      onSaved={(patch) => {
        onSaved?.(patch);
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  );
}
