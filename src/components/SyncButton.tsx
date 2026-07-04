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
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55_000);
    try {
      const res = await fetch("/api/sync", { method: "POST", signal: ctrl.signal });
      const text = await res.text();
      let json: { ok?: boolean; error?: string; upserted?: number };
      try {
        json = JSON.parse(text) as typeof json;
      } catch {
        throw new Error(text.slice(0, 100) || "Sync failed — check the terminal");
      }
      if (!res.ok || !json.ok) throw new Error(json.error || "Sync failed");
      setMsg(`Synced ${json.upserted ?? 0} games`);
      router.refresh();
    } catch (err) {
      const e = err as Error;
      setMsg(
        e.name === "AbortError"
          ? "Sync timed out — Neon may be slow. Try again in a moment."
          : e.message,
      );
    } finally {
      clearTimeout(timer);
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
