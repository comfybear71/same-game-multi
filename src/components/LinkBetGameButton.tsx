"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type LinkGameOption = {
  id: number;
  round: number | null;
  label: string;
};

/** Attach a fixture + round to a slip that landed in "No round". */
export function LinkBetGameButton({
  betId,
  games,
}: {
  betId: number;
  games: LinkGameOption[];
}) {
  const router = useRouter();
  const [gameId, setGameId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link() {
    const id = Number(gameId);
    if (!Number.isFinite(id)) {
      setError("Pick a game");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bets/${betId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameId: id }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "link failed");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
      <p className="text-[11px] font-medium text-amber-200">
        Link round &amp; match
      </p>
      <select
        className="input text-xs"
        value={gameId}
        onChange={(e) => setGameId(e.target.value)}
        disabled={busy || games.length === 0}
      >
        <option value="">— who vs who —</option>
        {games.map((g) => (
          <option key={g.id} value={g.id}>
            {g.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="w-full rounded-md bg-amber-500/90 px-2 py-1.5 text-xs font-semibold text-surface disabled:opacity-40"
        onClick={() => void link()}
        disabled={busy || !gameId}
      >
        {busy ? "Linking…" : "Attach to this game"}
      </button>
      {error ? <p className="text-[11px] text-accent-loss">{error}</p> : null}
    </div>
  );
}
