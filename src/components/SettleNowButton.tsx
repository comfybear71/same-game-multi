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
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed");
      setMsg(
        `Checked ${json.statsRecorded} player stats, settled ${json.settle.legsSettled} legs / ${json.settle.slipsSettled} slips.`,
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
