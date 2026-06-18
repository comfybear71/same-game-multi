"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { targetLabel } from "@/lib/format";

// Post-game settlement: upload the bookmaker's "Resulted" screenshot for a slip.
// The server reads it with AI, matches the legs back onto this slip, and settles
// them. If any leg can't be matched it asks for confirmation before applying.

interface UnmatchedLeg {
  playerName: string | null;
  statType: string;
  line: number;
}

interface Preview {
  matched: number;
  total: number;
  unmatchedStored: UnmatchedLeg[];
}

export function UploadResultButton({ betId }: { betId: number }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ imageUrl: string; preview: Preview } | null>(
    null,
  );

  async function settle(imageUrl: string, confirm: boolean) {
    const res = await fetch(`/api/bets/${betId}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageUrl, confirm }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || "couldn't read result");
    if (json.needsConfirm) {
      setPending({ imageUrl, preview: json.preview as Preview });
      return;
    }
    setPending(null);
    router.refresh();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setPending(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/bets/upload", { method: "POST", body: fd });
      const upJson = await up.json();
      if (!up.ok) throw new Error(upJson.error || "upload failed");
      await settle(upJson.url as string, false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function confirmApply() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await settle(pending.imageUrl, true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        className="text-[11px] text-slate-500 underline hover:text-slate-300"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? "reading result…" : "upload result screenshot"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFile}
      />

      {pending ? (
        <div className="rounded-lg border border-accent-pending/40 bg-accent-pending/5 p-2 text-[11px]">
          <p className="text-slate-300">
            Matched {pending.preview.matched}/{pending.preview.total} legs. Couldn&apos;t
            match:
          </p>
          <ul className="mt-1 text-slate-400">
            {pending.preview.unmatchedStored.map((l, i) => (
              <li key={i}>
                {l.playerName ?? "?"} {l.statType} {targetLabel(l.line)}
              </li>
            ))}
          </ul>
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              className="font-semibold text-accent-win"
              disabled={busy}
              onClick={confirmApply}
            >
              settle matched anyway
            </button>
            <button
              type="button"
              className="text-slate-500"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-[11px] text-accent-loss">{error}</p> : null}
    </div>
  );
}
