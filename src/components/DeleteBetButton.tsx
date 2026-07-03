"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteBetButton({ betId }: { betId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bets/${betId}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Could not delete bet");
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">Delete this slip?</span>
        <button
          type="button"
          className="rounded bg-accent-loss/20 px-2 py-0.5 text-xs font-medium text-accent-loss hover:bg-accent-loss/30"
          onClick={remove}
          disabled={loading}
        >
          {loading ? "Deleting…" : "Yes, delete"}
        </button>
        <button
          type="button"
          className="text-xs text-slate-500 hover:text-slate-300"
          onClick={() => setConfirming(false)}
          disabled={loading}
        >
          Cancel
        </button>
        {error ? <p className="w-full text-xs text-accent-loss">{error}</p> : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="text-xs text-slate-500 hover:text-accent-loss"
      onClick={() => setConfirming(true)}
    >
      Delete slip
    </button>
  );
}
