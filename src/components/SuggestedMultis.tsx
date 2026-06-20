"use client";

import { useEffect, useState } from "react";

import type { StatType } from "@/db/schema";
import { teamColors } from "@/lib/afl/teamColors";
import { lineTarget } from "@/lib/format";
import { estimateOddsAtTarget } from "@/lib/predictions/altLine";
import type { RiskTier, Suggestion, SuggestedLeg } from "@/lib/predictions/suggest";
import { DEFAULT_LEGS, MAX_LEGS, MIN_LEGS } from "@/lib/predictions/suggestLimits";

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
  const [focus, setFocus] = useState<StatType | "any">("any");
  const [legCount, setLegCount] = useState(DEFAULT_LEGS);
  const [data, setData] = useState<Suggestion[] | null>(null);
  const [active, setActive] = useState<RiskTier | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/games/${gameId}/suggest?focus=${focus}&legs=${legCount}`)
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
  }, [gameId, focus, legCount]);

  const current = data?.find((s) => s.tier === active) ?? null;

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-white">Suggested multis</h2>
        <p className="text-sm text-slate-400">
          AI-picked from our predictions vs the bookie lines. Choose how many
          legs and a risk level to explore the board&apos;s best combinations.
          Place the bet in your bookie app, then log it from the Bets tab.
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

      {/* Leg count */}
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-slate-400">Legs</span>
        <div className="flex items-center gap-2">
          <button
            className="flex h-7 w-7 items-center justify-center rounded-full border border-surface-border text-slate-300 disabled:opacity-40"
            onClick={() => setLegCount((n) => Math.max(MIN_LEGS, n - 1))}
            disabled={legCount <= MIN_LEGS}
          >
            −
          </button>
          <span className="w-6 text-center text-sm font-semibold text-white">
            {legCount}
          </span>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-full border border-surface-border text-slate-300 disabled:opacity-40"
            onClick={() => setLegCount((n) => Math.min(MAX_LEGS, n + 1))}
            disabled={legCount >= MAX_LEGS}
          >
            +
          </button>
        </div>
        <span className="text-[11px] text-slate-500">up to {MAX_LEGS} on one ticket</span>
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
              <div className="text-[11px] text-slate-400">
                {t.blurb} · {s ? s.legs.length : 0} legs
              </div>
              <div className="mt-1 text-xs text-slate-300">
                {s && s.estOdds != null ? `~$${s.estOdds.toFixed(2)}` : "—"}
              </div>
            </button>
          );
        })}
      </div>

      {loading ? <p className="text-sm text-slate-400">Thinking…</p> : null}
      {error ? <p className="text-sm text-accent-loss">{error}</p> : null}

      {current ? (
        <SuggestionCard key={`${active}-${focus}-${legCount}`} s={current} />
      ) : null}
    </section>
  );
}

// A working copy of a suggested leg: `target` is the whole number the punter is
// currently chasing (defaults to the bookie line, editable via the steppers),
// and `estOdds` is the price re-estimated for that target.
type EditableLeg = SuggestedLeg & { target: number; estOdds: number | null };

function toEditable(legs: SuggestedLeg[]): EditableLeg[] {
  return legs.map((l) => ({ ...l, target: lineTarget(l.line), estOdds: l.odds }));
}

function multiOdds(legs: EditableLeg[]): number | null {
  if (legs.length === 0) return null;
  return Math.round(legs.reduce((p, l) => p * (l.estOdds ?? 1), 1) * 100) / 100;
}

function SuggestionCard({ s }: { s: Suggestion }) {
  const [legs, setLegs] = useState<EditableLeg[]>(() => toEditable(s.legs));

  // Resync when a new suggestion arrives for the same tier — e.g. the leg-count
  // fetch resolves after the card already mounted, so s.legs grows from the
  // stale set the card first seeded with. Without this the list stays frozen at
  // whatever was loaded at mount (the bug where asking for 10 legs showed 4).
  useEffect(() => {
    setLegs(toEditable(s.legs));
  }, [s.legs]);

  if (s.legs.length === 0) {
    return <p className="text-sm text-slate-400">Not enough lines for this tier yet.</p>;
  }

  const estOdds = multiOdds(legs);

  function remove(playerId: number, statType: string) {
    setLegs((prev) => prev.filter((l) => !(l.playerId === playerId && l.statType === statType)));
  }

  // Nudge a leg's target up/down a whole step and re-estimate its odds.
  function changeTarget(playerId: number, statType: string, delta: number) {
    setLegs((prev) =>
      prev.map((l) => {
        if (l.playerId !== playerId || l.statType !== statType) return l;
        const target = Math.max(1, l.target + delta);
        return { ...l, target, estOdds: estimateOddsAtTarget(l.line, l.odds, target) };
      }),
    );
  }

  return (
    <div className="rounded-xl border border-surface-border p-3 space-y-3">
      {s.rationale ? <p className="text-sm text-slate-200">{s.rationale}</p> : null}

      {legs.length === 0 ? (
        <p className="text-sm text-slate-400">All legs removed — pick at least one.</p>
      ) : (
        <ul className="space-y-2">
          {legs.map((l) => {
            const c = teamColors(l.team);
            const edited = l.target !== lineTarget(l.line);
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
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-400">
                    <span className="capitalize">{l.statType}</span>
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        className="flex h-5 w-5 items-center justify-center rounded border border-surface-border text-slate-300 disabled:opacity-40"
                        onClick={() => changeTarget(l.playerId, l.statType, -1)}
                        disabled={l.target <= 1}
                        aria-label={`Lower ${l.playerName} ${l.statType} target`}
                      >
                        −
                      </button>
                      <span
                        className={`min-w-[2.5ch] text-center text-sm font-semibold ${
                          edited ? "text-accent" : "text-slate-200"
                        }`}
                      >
                        {l.target}+
                      </span>
                      <button
                        type="button"
                        className="flex h-5 w-5 items-center justify-center rounded border border-surface-border text-slate-300"
                        onClick={() => changeTarget(l.playerId, l.statType, 1)}
                        aria-label={`Raise ${l.playerName} ${l.statType} target`}
                      >
                        +
                      </button>
                    </span>
                    {!edited && l.hitRate != null ? (
                      <span>· hit {Math.round(l.hitRate * 100)}%</span>
                    ) : null}
                    {l.history && l.history.bets > 0 ? (
                      <span className="text-slate-500">
                        · you {l.history.hits}/{l.history.bets}
                      </span>
                    ) : null}
                    {l.news && (l.news.status === "test" || l.news.status === "managed") ? (
                      <span className="font-semibold text-accent-pending">
                        · {l.news.status}
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className="text-sm text-slate-300">
                  {l.estOdds != null ? l.estOdds.toFixed(2) : "—"}
                </span>
                <button
                  className="text-slate-500 hover:text-accent-loss"
                  onClick={() => remove(l.playerId, l.statType)}
                  aria-label={`Remove ${l.playerName}`}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-surface-border pt-2">
        <div className="text-xs text-slate-400">Estimated odds</div>
        <div className="text-lg font-bold text-white">
          {estOdds != null ? `$${estOdds.toFixed(2)}` : "—"}
        </div>
        <div className="text-[11px] text-slate-500">
          estimate — confirm real price in the bookie app
        </div>
      </div>
    </div>
  );
}
