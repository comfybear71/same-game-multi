"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { StatType } from "@/db/schema";

const STATS: StatType[] = ["disposals", "marks", "tackles", "goals"];

interface GameOption {
  id: number;
  label: string;
}

interface LegInput {
  playerName: string;
  statType: StatType;
  line: string;
  odds: string;
  confidence: string;
  notes: string;
}

function emptyLeg(): LegInput {
  return { playerName: "", statType: "disposals", line: "", odds: "", confidence: "", notes: "" };
}

export function BetForm({ games }: { games: GameOption[] }) {
  const router = useRouter();
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [gameId, setGameId] = useState("");
  const [round, setRound] = useState("");
  const [totalOdds, setTotalOdds] = useState("");
  const [totalStake, setTotalStake] = useState("");
  const [notes, setNotes] = useState("");
  const [legs, setLegs] = useState<LegInput[]>([emptyLeg()]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/bets/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "upload failed");
      setScreenshotUrl(json.url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function readSlip() {
    if (!screenshotUrl) return;
    setReading(true);
    setError(null);
    try {
      const res = await fetch("/api/bets/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageUrl: screenshotUrl }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "couldn't read slip");
      const s = json.slip as {
        totalOdds: number | null;
        totalStake: number | null;
        legs: { player: string; statType: StatType | null; line: number | null; odds: number | null }[];
      };
      if (s.totalOdds != null) setTotalOdds(String(s.totalOdds));
      if (s.totalStake != null) setTotalStake(String(s.totalStake));
      const mapped = s.legs
        .filter((l) => l.statType)
        .map((l) => ({
          playerName: l.player,
          statType: l.statType as StatType,
          line: l.line != null ? String(l.line) : "",
          odds: l.odds != null ? String(l.odds) : "",
          confidence: "",
          notes: "",
        }));
      if (mapped.length > 0) setLegs(mapped);
      else setError("Read the slip but found no disposals/marks/tackles/goals legs.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReading(false);
    }
  }

  function updateLeg(i: number, patch: Partial<LegInput>) {
    setLegs((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        round: round ? Number(round) : undefined,
        totalOdds: totalOdds ? Number(totalOdds) : undefined,
        totalStake: totalStake ? Number(totalStake) : undefined,
        status: "pending" as const,
        notes: notes || undefined,
        screenshotUrl: screenshotUrl || undefined,
        gameId: gameId ? Number(gameId) : undefined,
        legs: legs
          .filter((l) => l.line !== "")
          .map((l) => ({
            playerName: l.playerName || undefined,
            statType: l.statType,
            line: Number(l.line),
            odds: l.odds ? Number(l.odds) : undefined,
            confidence: l.confidence ? Number(l.confidence) : undefined,
            notes: l.notes || undefined,
          })),
      };
      if (payload.legs.length === 0) throw new Error("Add at least one leg with a line.");
      const res = await fetch("/api/bets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "save failed");
      router.push("/bets");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-white">New bet</h1>

      {/* Screenshot + AI read */}
      <section className="card space-y-3">
        <h2 className="font-semibold text-white">Bet slip screenshot</h2>
        <input
          type="file"
          accept="image/*"
          onChange={onFile}
          className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-surface"
        />
        {uploading ? <p className="text-sm text-slate-400">Uploading…</p> : null}
        {screenshotUrl ? (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={screenshotUrl}
              alt="bet slip"
              className="max-h-72 rounded-lg border border-surface-border"
            />
            <button className="btn" onClick={readSlip} disabled={reading}>
              {reading ? "Reading slip…" : "Read slip with AI"}
            </button>
            <p className="text-xs text-slate-500">
              AI fills the legs below from your screenshot — check and fix anything
              before saving.
            </p>
          </div>
        ) : null}
      </section>

      {/* Slip details */}
      <section className="card space-y-3">
        <h2 className="font-semibold text-white">Multi details</h2>
        <label className="block text-sm">
          <span className="text-slate-400">Game (links legs for auto-settling)</span>
          <select
            className="input mt-1"
            value={gameId}
            onChange={(e) => setGameId(e.target.value)}
          >
            <option value="">— none —</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-sm">
            <span className="text-slate-400">Round</span>
            <input className="input mt-1" inputMode="numeric" value={round} onChange={(e) => setRound(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Total odds</span>
            <input className="input mt-1" inputMode="decimal" value={totalOdds} onChange={(e) => setTotalOdds(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Stake $</span>
            <input className="input mt-1" inputMode="decimal" value={totalStake} onChange={(e) => setTotalStake(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-slate-400">Notes</span>
          <input className="input mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </section>

      {/* Legs */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-white">Legs</h2>
          <button
            className="text-sm text-accent"
            onClick={() => setLegs((p) => [...p, emptyLeg()])}
          >
            + Add leg
          </button>
        </div>
        {legs.map((leg, i) => (
          <div key={i} className="rounded-lg border border-surface-border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                className="input"
                placeholder="Player"
                value={leg.playerName}
                onChange={(e) => updateLeg(i, { playerName: e.target.value })}
              />
              {legs.length > 1 ? (
                <button
                  className="text-xs text-accent-loss"
                  onClick={() => setLegs((p) => p.filter((_, idx) => idx !== i))}
                >
                  Remove
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-4 gap-2">
              <select
                className="input"
                value={leg.statType}
                onChange={(e) => updateLeg(i, { statType: e.target.value as StatType })}
              >
                {STATS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input className="input" inputMode="decimal" placeholder="Line" value={leg.line} onChange={(e) => updateLeg(i, { line: e.target.value })} />
              <input className="input" inputMode="decimal" placeholder="Odds" value={leg.odds} onChange={(e) => updateLeg(i, { odds: e.target.value })} />
              <input className="input" inputMode="numeric" placeholder="Conf 1-5" value={leg.confidence} onChange={(e) => updateLeg(i, { confidence: e.target.value })} />
            </div>
          </div>
        ))}
      </section>

      {error ? <p className="text-sm text-accent-loss">{error}</p> : null}

      <div className="flex gap-3">
        <button className="btn" onClick={save} disabled={saving || uploading}>
          {saving ? "Saving…" : "Save bet"}
        </button>
        <button className="nav-link" onClick={() => router.push("/bets")}>
          Cancel
        </button>
      </div>
    </div>
  );
}
