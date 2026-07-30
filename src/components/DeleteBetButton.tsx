"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function DeleteBetButton({
  betId,
  legCount,
}: {
  betId: number;
  /** Shown in confirm copy — whole slip, all legs. */
  legCount?: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!confirming) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) setConfirming(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, loading]);

  async function remove() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bets/${betId}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Could not delete bet");
      }
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const dialog =
    confirming && mounted
      ? createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`delete-slip-${betId}-title`}
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/70"
              aria-label="Cancel"
              onClick={() => !loading && setConfirming(false)}
              disabled={loading}
            />
            <div className="relative w-full max-w-sm rounded-xl border border-surface-border bg-surface-card p-4 shadow-2xl">
              <h3
                id={`delete-slip-${betId}-title`}
                className="text-lg font-semibold text-white"
              >
                Delete entire slip?
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                This removes the{" "}
                <span className="font-medium text-white">whole multi</span>
                {legCount != null ? (
                  <>
                    {" "}
                    — all {legCount} leg{legCount === 1 ? "" : "s"}
                  </>
                ) : (
                  " and every leg"
                )}{" "}
                from your tracker. Nothing on Sportsbet is changed.
              </p>
              {error ? (
                <p className="mt-2 text-sm text-accent-loss">{error}</p>
              ) : null}
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  className="btn w-full bg-accent-loss/90 hover:bg-accent-loss"
                  onClick={() => void remove()}
                  disabled={loading}
                >
                  {loading ? "Deleting…" : "Yes — delete whole slip"}
                </button>
                <button
                  type="button"
                  className="w-full rounded-lg py-2.5 text-sm font-medium text-slate-400 hover:text-white"
                  onClick={() => setConfirming(false)}
                  disabled={loading}
                >
                  No, keep slip
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        className="text-xs font-medium text-slate-500 hover:text-accent-loss"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        Delete whole slip
      </button>
      {dialog}
    </>
  );
}
