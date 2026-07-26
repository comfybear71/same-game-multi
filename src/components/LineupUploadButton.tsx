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
  warnings: string[];
}

interface LineupRow {
  team: string;
  playerName: string;
  jumper: number | null;
  status: "named" | "interchange" | "emergency";
}

export function LineupUploadButton({
  gameId,
  initialCount = 0,
  onUploaded,
}: {
  gameId: number;
  // Lineup players already stored for this game (0 = none uploaded yet).
  initialCount?: number;
  /** Called after JPEG or paste save succeeds (for squad review refresh). */
  onUploaded?: () => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRows, setReviewRows] = useState<LineupRow[] | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);

  // Already uploaded (this load) once a fresh result lands or we started with one.
  const storedCount = result?.stored ?? initialCount;
  const hasLineup = storedCount > 0;

  async function toggleReview() {
    if (reviewOpen) {
      setReviewOpen(false);
      return;
    }
    setReviewOpen(true);
    if (reviewRows != null) return;
    setReviewLoading(true);
    setReviewError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/lineup`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "couldn't load squad");
      setReviewRows(json.lineup);
    } catch (err) {
      setReviewError((err as Error).message);
    } finally {
      setReviewLoading(false);
    }
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setReviewRows(null);
    setReviewOpen(false);
    try {
      const fd = new FormData();
      for (const file of Array.from(files)) fd.append("file", file);
      const res = await fetch(`/api/games/${gameId}/lineup`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "couldn't read lineup");
      setResult({
        stored: json.stored,
        teams: json.teams,
        dropped: json.dropped,
        warnings: json.warnings ?? [],
      });
      onUploaded?.();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onPasteSave() {
    const text = pasteText.trim();
    if (!text) return;
    setPasteBusy(true);
    setError(null);
    setResult(null);
    setReviewRows(null);
    setReviewOpen(false);
    try {
      const res = await fetch(`/api/games/${gameId}/lineup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "couldn't save pasted lineup");
      setResult({
        stored: json.stored,
        teams: json.teams,
        dropped: json.dropped,
        warnings: json.warnings ?? [],
      });
      setPasteText("");
      onUploaded?.();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPasteBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      {hasLineup && !busy ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-accent-win">
            ✓ Lineup uploaded · {storedCount} players
          </p>
          <button
            type="button"
            onClick={toggleReview}
            className="text-xs text-slate-400 hover:text-accent"
          >
            {reviewOpen ? "Hide squad ▴" : "Review squad ▾"}
          </button>
        </div>
      ) : null}
      {reviewOpen ? (
        <div className="rounded-lg border border-surface-border p-2 text-xs">
          {reviewLoading ? <p className="text-slate-400">Loading squad…</p> : null}
          {reviewError ? <p className="text-accent-loss">{reviewError}</p> : null}
          {!reviewLoading && !reviewError && reviewRows ? (
            reviewRows.length === 0 ? (
              <p className="text-slate-400">No players stored.</p>
            ) : (
              <div className="space-y-2">
                {[...new Set(reviewRows.map((r) => r.team))].map((team) => {
                  const rows = reviewRows.filter((r) => r.team === team);
                  return (
                    <div key={team}>
                      <div className="font-semibold text-slate-300">
                        {team} · {rows.length}
                      </div>
                      <p className="mt-0.5 text-slate-400">
                        {rows
                          .map(
                            (r) =>
                              `${r.playerName}${
                                r.status !== "named" ? ` (${r.status})` : ""
                              }`,
                          )
                          .join(", ")}
                      </p>
                    </div>
                  );
                })}
              </div>
            )
          ) : null}
        </div>
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
      <button
        type="button"
        className="w-full text-xs text-slate-400 hover:text-accent"
        onClick={() => setPasteOpen((v) => !v)}
      >
        {pasteOpen ? "Hide paste team sheet ▴" : "Paste team sheet text ▾"}
      </button>
      {pasteOpen ? (
        <div className="space-y-1.5">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
            placeholder="Copy all from AFL Match Centre line-ups (numbers + names + positions)…"
            className="w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-xs text-slate-200"
          />
          <p className="text-[10px] leading-snug text-slate-500">
            Include <strong className="font-medium text-slate-400">Interchanges</strong> (bench
            for both teams). Match Centre <strong className="font-medium text-slate-400">column
            copy</strong> (names above/below each position header) and{" "}
            <strong className="font-medium text-slate-400">row-pair</strong> copy both work. For
            bench rows, copy{" "}
            <strong className="font-medium text-slate-400">Port then Brisbane</strong> on each
            line when both appear. Stop before the IN/OUT panel.
          </p>
          <button
            type="button"
            className="btn w-full text-sm"
            disabled={pasteBusy || !pasteText.trim()}
            onClick={onPasteSave}
          >
            {pasteBusy ? "Saving…" : "Save pasted lineup"}
          </button>
        </div>
      ) : null}
      {result?.warnings?.length ? (
        <div className="rounded-lg border border-accent-pending/40 bg-accent-pending/10 p-2 text-xs text-accent-pending">
          <p className="font-semibold">Lineup looks incomplete — check before betting</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
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
          {" "}
          Review the squad grid below, then Approve lineup.
        </p>
      ) : null}
      {error ? <p className="text-xs text-accent-loss">{error}</p> : null}
    </div>
  );
}
