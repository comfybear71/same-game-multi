"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function GeneratePredictionsButton({ gameId }: { gameId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/games/${gameId}/predict`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed");
      setMsg(`${json.gen.playersProcessed} players, ${json.gen.predictionsWritten} predictions`);
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button className="btn" onClick={run} disabled={loading}>
        {loading ? "Generating…" : "Generate predictions"}
      </button>
      {msg ? <span className="text-sm text-slate-400">{msg}</span> : null}
    </div>
  );
}
