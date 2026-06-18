"use client";

import { useState } from "react";

// Apply pending DB migrations from the app (no terminal needed). Rarely used —
// only after deploying a schema change — so it's a quiet, muted control.
export function RunMigrationsButton() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/migrate", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Migrate failed (HTTP ${res.status})`);
      }
      setMsg(json.applied ? "Migrations applied." : "No database configured.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        className="text-xs text-slate-500 underline hover:text-slate-300"
        onClick={run}
        disabled={loading}
      >
        {loading ? "Migrating…" : "Run DB migrations"}
      </button>
      {msg ? <p className="text-xs text-slate-400">{msg}</p> : null}
    </div>
  );
}
