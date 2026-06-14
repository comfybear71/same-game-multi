"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SyncButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Sync failed");
      setMsg(`Synced ${json.upserted} games`);
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button className="btn" onClick={sync} disabled={loading}>
        {loading ? "Syncing…" : "Refresh fixtures"}
      </button>
      {msg ? <span className="text-sm text-slate-400">{msg}</span> : null}
    </div>
  );
}
