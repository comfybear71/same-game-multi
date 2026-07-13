"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Paste / edit a per-game match preview shown on the briefing card. */
export function MatchNotesEditor({
  gameId,
  initialNotes,
}: {
  gameId: number;
  initialNotes: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasNotes = Boolean(initialNotes?.trim());

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/notes`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchNotes: draft }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "save failed");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="space-y-2">
        {hasNotes ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
            {initialNotes}
          </p>
        ) : (
          <p className="text-sm text-slate-500">
            No match notes yet — paste a Sportsbet / AFL preview so you and your
            mum have the story before picking lines.
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(initialNotes ?? "");
            setOpen(true);
            setError(null);
          }}
          className="text-xs font-medium text-accent hover:underline"
        >
          {hasNotes ? "Edit match notes" : "Add match notes"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        className="input min-h-[9rem] resize-y text-sm leading-relaxed"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Paste the match preview here (form, injuries, H2H story)…"
        disabled={saving}
      />
      {error ? <p className="text-xs text-accent-loss">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save notes"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-surface-border px-3 py-2 text-sm text-slate-300 hover:text-white"
          onClick={() => {
            setOpen(false);
            setDraft(initialNotes ?? "");
            setError(null);
          }}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
