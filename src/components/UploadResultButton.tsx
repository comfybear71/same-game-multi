"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { targetLabel } from "@/lib/format";

// Post-game settlement: upload the bookmaker's "Resulted" screenshot for a
// slip. The server reads it with AI and proposes a result per leg, but
// never writes anything on that read alone — vision can misread a tick for
// a cross just as it once misread the market's target for the achieved
// value. Every leg comes back here editable so a misread is caught before
// it's applied, not after.

type Result = "pending" | "hit" | "miss" | "void";

interface PreviewLeg {
  legId: number;
  playerName: string | null;
  statType: string;
  line: number;
  result: Result | null;
  actualValue: number | null;
}

interface Row {
  legId: number;
  playerName: string | null;
  statType: string;
  line: number;
  result: Result;
  actualValue: string;
}

const RESULTS: Result[] = ["pending", "hit", "miss", "void"];

export function UploadResultButton({ betId }: { betId: number }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setRows(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/bets/upload", { method: "POST", body: fd });
      const upJson = await up.json();
      if (!up.ok) throw new Error(upJson.error || "upload failed");
      const url = upJson.url as string;

      const res = await fetch(`/api/bets/${betId}/result`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageUrl: url }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "couldn't read result");

      const preview = json.preview as { legs: PreviewLeg[] };
      setImageUrl(url);
      setRows(
        preview.legs.map((l) => ({
          legId: l.legId,
          playerName: l.playerName,
          statType: l.statType,
          line: l.line,
          result: l.result ?? "pending",
          actualValue: l.actualValue == null ? "" : String(l.actualValue),
        })),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function updateRow(legId: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev ? prev.map((r) => (r.legId === legId ? { ...r, ...patch } : r)) : prev,
    );
  }

  async function apply() {
    if (!rows || !imageUrl) return;
    setBusy(true);
    setError(null);
    try {
      const matches = rows
        .filter((r) => r.result !== "pending")
        .map((r) => ({
          legId: r.legId,
          result: r.result,
          actualValue: r.actualValue === "" ? null : Number(r.actualValue),
        }));
      const res = await fetch(`/api/bets/${betId}/result`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageUrl, confirm: true, matches }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "couldn't settle");
      setRows(null);
      setImageUrl(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setRows(null);
    setImageUrl(null);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn w-full"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? "Reading result…" : "📷 Upload result screenshot"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFile}
      />

      {rows ? (
        <div className="space-y-2 rounded-lg border border-accent-pending/40 bg-accent-pending/5 p-3 text-sm">
          <p className="text-slate-200">
            Check each leg before applying — the AI read can misjudge a tick or
            cross. Anything left as &quot;pending&quot; is skipped.
          </p>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.legId} className="flex flex-wrap items-center gap-1.5">
                <span className="mr-auto text-slate-300">
                  {r.playerName ? (
                    <span className="font-medium text-white">{r.playerName} </span>
                  ) : null}
                  {r.statType} {targetLabel(r.line)}
                </span>
                <input
                  className="w-14 rounded border border-surface-border bg-surface px-1.5 py-0.5 text-xs text-slate-100"
                  inputMode="numeric"
                  placeholder="actual"
                  value={r.actualValue}
                  onChange={(e) => updateRow(r.legId, { actualValue: e.target.value })}
                />
                <select
                  className="rounded border border-surface-border bg-surface px-1.5 py-0.5 text-xs text-slate-100"
                  value={r.result}
                  onChange={(e) =>
                    updateRow(r.legId, { result: e.target.value as Result })
                  }
                >
                  {RESULTS.map((res) => (
                    <option key={res} value={res}>
                      {res}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn" disabled={busy} onClick={apply}>
              Apply
            </button>
            <button
              type="button"
              className="nav-link"
              disabled={busy}
              onClick={cancel}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-accent-loss">{error}</p> : null}
    </div>
  );
}
