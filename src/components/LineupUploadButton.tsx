"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// Upload one or more team-sheet screenshots (AFL app / afl.com.au Match Centre
// line-ups) for a game. The server reads them with Claude vision and stores the
// named squad, which seeds prediction generation — the free replacement for the
// paid Odds API player list. Lives on the upcoming / next game cards so it's the
// first bit of housekeeping before predicting and placing a bet.

interface SaveResult {
  stored: number;
  teams: string[];
  dropped: string[];
}

export function LineupUploadButton({
  gameId,
  initialCount = 0,
}: {
  gameId: number;
  // Lineup players already stored for this game (0 = none uploaded yet).
  initialCount?: number;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);

  // Already uploaded (this load) once a fresh result lands or we started with one.
  const storedCount = result?.stored ?? initialCount;
  const hasLineup = storedCount > 0;

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      for (const file of Array.from(files)) fd.append("file", file);
      const res = await fetch(`/api/games/${gameId}/lineup`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "couldn't read lineup");
      setResult({ stored: json.stored, teams: json.teams, dropped: json.dropped });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-1.5">
      {hasLineup && !busy ? (
        <p className="text-xs font-medium text-accent-win">
          ✓ Lineup uploaded · {storedCount} players
        </p>
      ) : null}
      <button
        type="button"
        className={`w-full text-sm ${hasLineup ? "nav-link" : "btn"}`}
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        {busy
          ? "Reading lineup…"
          : hasLineup
            ? "↻ Replace lineup screenshot"
            : "📋 Upload lineup screenshot"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onFiles}
      />
      {result ? (
        <p className="text-xs text-slate-400">
          Saved {result.stored} players
          {result.teams.length ? ` · ${result.teams.join(" + ")}` : ""}. Open the
          game to generate predictions.
          {result.dropped.length ? (
            <span className="text-accent-pending">
              {" "}
              ({result.dropped.length} unmatched skipped)
            </span>
          ) : null}
        </p>
      ) : null}
      {error ? <p className="text-xs text-accent-loss">{error}</p> : null}
    </div>
  );
}
