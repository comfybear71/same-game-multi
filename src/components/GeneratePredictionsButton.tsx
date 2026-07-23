"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { dispatchPredictionsGenerated } from "@/components/predictionsGenerated";
import type { Top10BoardResponse } from "@/lib/predictions/top10Board";

export function GeneratePredictionsButton({
  gameId,
  /** When true, run once on mount if lineup exists but predictions are missing. */
  autoRun = false,
}: {
  gameId: number;
  autoRun?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const autoRan = useRef(false);

  const run = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/games/${gameId}/predict`, {
        method: "POST",
        cache: "no-store",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        gen?: { playersProcessed: number; predictionsWritten: number };
        top10?: Top10BoardResponse;
      };
      if (!res.ok || !json.ok || !json.gen) throw new Error(json.error || "Failed");
      setMsg(`${json.gen.playersProcessed} players, ${json.gen.predictionsWritten} predictions`);
      dispatchPredictionsGenerated({ gameId, top10: json.top10 });
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [gameId, router]);

  useEffect(() => {
    if (!autoRun || autoRan.current) return;
    autoRan.current = true;
    void run();
  }, [autoRun, run]);

  const label = loading
    ? "Generating…"
    : autoRun
      ? "Regenerate predictions"
      : "Generate predictions";

  return (
    <div className="flex flex-wrap items-center gap-3">
      {loading ? (
        <span className="text-sm text-slate-400">Generating predictions…</span>
      ) : null}
      <button className="btn" onClick={() => void run()} disabled={loading}>
        {label}
      </button>
      {!loading && msg ? <span className="text-sm text-slate-400">{msg}</span> : null}
    </div>
  );
}
