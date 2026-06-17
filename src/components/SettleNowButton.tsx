"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SettleNowButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/bets/settle", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Settle failed (HTTP ${res.status})`);
      }
      const { legsSettled, slipsSettled } = json.settle;
      setMsg(
        legsSettled === 0
          ? "Nothing new to settle yet — results may not be published. You can set any leg manually below."
          : `Settled ${legsSettled} leg${legsSettled === 1 ? "" : "s"} / ${slipsSettled} slip${slipsSettled === 1 ? "" : "s"}.`,
      );
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <button className="nav-link" onClick={run} disabled={loading}>
        {loading ? "Settling…" : "Settle now"}
      </button>
      {msg ? <p className="text-xs text-slate-400">{msg}</p> : null}
    </div>
  );
}
