"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { StatType } from "@/db/schema";
import { teamColors } from "@/lib/afl/teamColors";
import type { RiskTier, Suggestion } from "@/lib/predictions/suggest";

const FOCUSES: { key: StatType | "any"; label: string }[] = [
  { key: "any", label: "Any" },
  { key: "disposals", label: "Disposals" },
  { key: "marks", label: "Marks" },
  { key: "tackles", label: "Tackles" },
  { key: "goals", label: "Goals" },
];

const TIERS: { key: RiskTier; label: string; blurb: string; color: string }[] = [
  { key: "cautious", label: "Cautious", blurb: "Safest", color: "text-accent-win" },
  { key: "medium", label: "Medium", blurb: "Balanced", color: "text-accent" },
  { key: "high", label: "High risk", blurb: "Longshot", color: "text-accent-pending" },
];

export function SuggestedMultis({ gameId }: { gameId: number }) {
  const router = useRouter();
  const [focus, setFocus] = useState<StatType | "any">("any");
  const [data, setData] = useState<Suggestion[] | null>(null);
  const [active, setActive] = useState<RiskTier | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/games/${gameId}/suggest?focus=${focus}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) throw new Error(json.error || "failed");
        setData(json.suggestions);
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [gameId, focus]);

  const current = data?.find((s) => s.tier === active) ?? null;

  function logBet(s: Suggestion) {
    const prefill = {
      gameId,
      totalOdds: s.estOdds,
      legs: s.legs.map((l) => ({
        playerName: l.playerName,
        statType: l.statType,
        line: l.line,
        odds: l.odds,
      })),
    };
    sessionStorage.setItem("betPrefill", JSON.stringify(prefill));
    router.push("/bets/new");
  }

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-white">Suggested multis</h2>
        <p className="text-sm text-slate-400">
          AI-picked from our predictions vs the bookie lines. Pick a risk level.
        </p>
      </div>

      {/* Focus */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FOCUSES.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setFocus(f.key);
              setActive(null);
            }}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
              focus === f.key
                ? "bg-slate-200 text-surface"
                : "border border-surface-border text-slate-300"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Tier buttons */}
      <div className="grid grid-cols-3 gap-2">
        {TIERS.map((t) => {
          const s = data?.find((x) => x.tier === t.key);
          const disabled = !s || s.legs.length === 0;
          return (
            <button
              key={t.key}
              disabled={disabled}
              onClick={() => setActive(t.key)}
              className={`rounded-xl border p-3 text-left transition disabled:opacity-40 ${
                active === t.key ? "border-accent" : "border-surface-border"
              }`}
            >
              <div className={`text-sm font-bold ${t.color}`}>{t.label}</div>
              <div className="text-[11px] text-slate-400">{t.blurb}</div>
              <div className="mt-1 text-xs text-slate-300">
                {s && s.estOdds != null ? `~$${s.estOdds.toFixed(2)}` : "—"}
              </div>
            </button>
          );
        })}
      </div>

      {loading ? <p className="text-sm text-slate-400">Thinking…</p> : null}
      {error ? <p className="text-sm text-accent-loss">{error}</p> : null}

      {current ? <SuggestionCard s={current} onLog={() => logBet(current)} /> : null}
    </section>
  );
}

function SuggestionCard({ s, onLog }: { s: Suggestion; onLog: () => void }) {
  if (s.legs.length === 0) {
    return <p className="text-sm text-slate-400">Not enough lines for this tier yet.</p>;
  }
  return (
    <div className="rounded-xl border border-surface-border p-3 space-y-3">
      {s.rationale ? <p className="text-sm text-slate-200">{s.rationale}</p> : null}

      <ul className="space-y-2">
        {s.legs.map((l) => {
          const c = teamColors(l.team);
          return (
            <li key={`${l.playerId}-${l.statType}`} className="flex items-center gap-3">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs font-bold"
                style={{ background: c.bg, color: c.fg }}
              >
                {l.jumper ?? "–"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">
                  {l.playerName}
                </div>
                <div className="text-xs capitalize text-slate-400">
                  {l.statType} over {l.line}
                  {l.hitRate != null ? ` · hit ${Math.round(l.hitRate * 100)}%` : ""}
                </div>
              </div>
              <span className="text-sm text-slate-300">
                {l.odds != null ? l.odds.toFixed(2) : "—"}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between border-t border-surface-border pt-2">
        <div>
          <div className="text-xs text-slate-400">Estimated odds</div>
          <div className="text-lg font-bold text-white">
            {s.estOdds != null ? `$${s.estOdds.toFixed(2)}` : "—"}
          </div>
          <div className="text-[11px] text-slate-500">
            estimate — confirm real price in the bookie app
          </div>
        </div>
        <button className="btn" onClick={onLog}>
          Log this bet
        </button>
      </div>
    </div>
  );
}
