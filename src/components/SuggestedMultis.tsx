"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { StatType } from "@/db/schema";
import { teamColors } from "@/lib/afl/teamColors";
import { lineTarget, signed } from "@/lib/format";
import { minLineTarget } from "@/lib/predictions/modelLine";
import { clearProbability } from "@/lib/predictions/probability";
import type { Suggestion, SuggestedLeg } from "@/lib/predictions/suggest";
import { DEFAULT_LEGS, MAX_LEGS, MIN_LEGS } from "@/lib/predictions/suggestLimits";

const FOCUSES: { key: StatType | "any"; label: string }[] = [
  { key: "any", label: "Any" },
  { key: "disposals", label: "Disposals" },
  { key: "marks", label: "Marks" },
  { key: "tackles", label: "Tackles" },
  { key: "goals", label: "Goals" },
];

// Plain-English strategy for the "why" popup.
const STRATEGY =
  "Ranked purely by our model's confidence — the steadiest legs first. Adding legs grows the payout, but each one multiplies into the combined chance, so that drops as the ticket grows.";

export function SuggestedMultis({
  gameId,
  round = null,
}: {
  gameId: number;
  round?: number | null;
}) {
  const [focus, setFocus] = useState<StatType | "any">("any");
  const [legCount, setLegCount] = useState(DEFAULT_LEGS);
  const [policyBadge, setPolicyBadge] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Suggestion | null>(null);
  const [info, setInfo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [editableLegs, setEditableLegs] = useState<EditableLeg[]>([]);
  const lastAppliedRefresh = useRef(-1);

  // Seed focus / legs from AI policy once, then load suggestions.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/system/policy")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const d = json.policy?.defaults as
          | { focus?: string; legCount?: number }
          | undefined;
        if (d?.focus && FOCUSES.some((f) => f.key === d.focus)) {
          setFocus(d.focus as StatType | "any");
        }
        if (d?.legCount != null && Number.isFinite(Number(d.legCount))) {
          setLegCount(
            Math.min(MAX_LEGS, Math.max(MIN_LEGS, Math.round(Number(d.legCount)))),
          );
        }
        if (d?.focus != null && d?.legCount != null) {
          setPolicyBadge(`Policy default: ${d.focus} · ${d.legCount}`);
        }
      })
      .catch(() => {
        /* no policy yet — use built-in defaults */
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const refresh = refreshToken > 0 ? "&refresh=1" : "";
    fetch(
      `/api/games/${gameId}/suggest?focus=${focus}&legs=${legCount}${refresh}`,
      { signal: controller.signal },
    )
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) throw new Error(json.error || "failed");
        setData(json.suggestion);
      })
      .catch((e) => {
        if (cancelled || (e as Error).name === "AbortError") return;
        setError((e as Error).message);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [gameId, focus, legCount, refreshToken, ready]);

  // Only replace the ticket on first load or ↻ New picks — not when browsing tabs.
  useEffect(() => {
    if (!data) return;
    if (lastAppliedRefresh.current === refreshToken) return;
    setEditableLegs(toEditable(data.legs));
    lastAppliedRefresh.current = refreshToken;
  }, [data, refreshToken]);

  const ticketStatCounts = countByStat(editableLegs);

  return (
    <section className="card relative z-20 space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-white">Suggested multi</h2>
        <p className="text-sm text-slate-400">
          Build your ticket across markets — pick disposals, switch to Goals, add
          more, nothing drops off. Tabs show AI picks for that stat (tick to add).
          Tap{" "}
          <span className="text-slate-300">↻ New picks</span> to reset the whole
          ticket from scratch.
        </p>
        {policyBadge ? (
          <p className="mt-1 text-[11px] text-sky-400/90">{policyBadge}</p>
        ) : null}
      </div>

      {/* Focus */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FOCUSES.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFocus(f.key)}
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
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-surface-border text-slate-300 disabled:opacity-40"
            onClick={() => setLegCount((n) => Math.max(MIN_LEGS, n - 1))}
            disabled={legCount <= MIN_LEGS || loading}
          >
            −
          </button>
          <span className="w-6 text-center text-sm font-semibold text-white">
            {legCount}
          </span>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-surface-border text-slate-300 disabled:opacity-40"
            onClick={() => setLegCount((n) => Math.min(MAX_LEGS, n + 1))}
            disabled={legCount >= MAX_LEGS || loading}
          >
            +
          </button>
        </div>
        <span className="text-[11px] text-slate-500">
          suggestions shown per tab
        </span>
        <button
          type="button"
          onClick={() => setRefreshToken((n) => n + 1)}
          disabled={loading}
          className="whitespace-nowrap rounded-full border border-surface-border px-3 py-1 text-xs font-medium text-slate-300 hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {loading ? "Loading…" : "↻ New picks"}
        </button>
        {data && data.legs.length > 0 ? (
          <button
            type="button"
            aria-label="Why these picks"
            onClick={() => setInfo(true)}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-surface-border bg-surface text-[11px] font-bold leading-none text-slate-400 hover:border-accent hover:text-accent"
          >
            i
          </button>
        ) : null}
      </div>

      {loading ? <p className="text-sm text-slate-400">Thinking…</p> : null}
      {error ? <p className="text-sm text-accent-loss">{error}</p> : null}

      {data ? (
        <SuggestionCard
          s={data}
          legs={editableLegs}
          setLegs={setEditableLegs}
          gameId={gameId}
          round={round}
          focus={focus}
          ticketStatCounts={ticketStatCounts}
          onLogged={() => {
            lastAppliedRefresh.current = -1;
            setRefreshToken((t) => t + 1);
          }}
        />
      ) : null}

      {info ? (
        <SuggestionInfoModal suggestion={data} onClose={() => setInfo(false)} />
      ) : null}
    </section>
  );
}

// Read-only "why did the AI pick this?" popup. Surfaces the deterministic
// factors behind each leg (projection vs line, recent form, your own record,
// any team news, price) so the decision-making is transparent and can be
// talked through / refined against real-world knowledge.
function SuggestionInfoModal({
  suggestion,
  onClose,
}: {
  suggestion: Suggestion | null;
  onClose: () => void;
}) {
  const legs = suggestion?.legs ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="How these picks were chosen"
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-surface-border bg-surface-card p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              How these were chosen
            </div>
            <h3 className="text-lg font-bold text-accent">Suggested multi</h3>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-full border border-surface-border px-2 py-0.5 text-sm text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <p className="mt-2 text-sm text-slate-300">{STRATEGY}</p>

        {suggestion?.rationale ? (
          <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-sm text-slate-200">
            🤖 {suggestion.rationale}
          </p>
        ) : null}

        <div className="mt-3 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Why each leg made the cut
          </div>
          {legs.length === 0 ? (
            <p className="text-sm text-slate-400">No legs picked yet.</p>
          ) : (
            legs.map((l) => <LegReasoning key={`${l.playerId}-${l.statType}`} l={l} />)
          )}
        </div>

        <p className="mt-4 border-t border-surface-border pt-3 text-[11px] text-slate-500">
          Read-only — this is the model&apos;s reasoning from form, lines and your
          past bets. Use it as a starting point and lean on your own read before
          you place anything.
        </p>
      </div>
    </div>
  );
}

function LegReasoning({ l }: { l: SuggestedLeg }) {
  const c = teamColors(l.team);
  const target = lineTarget(l.line);
  const pred = Math.round(l.prediction * 10) / 10;
  const edge = Math.round(l.edge * 10) / 10;
  const confidencePct = Math.round(l.confidence * 100);
  const newsNote =
    l.news && (l.news.status === "test" || l.news.status === "managed")
      ? l.news.note ?? l.news.status
      : null;

  return (
    <div className="rounded-lg border border-surface-border p-2.5">
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-bold"
          style={{ background: c.bg, color: c.fg }}
        >
          {l.jumper ?? "–"}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
          {l.playerName}
        </span>
        <span className="text-xs capitalize text-slate-400">
          {l.statType} {target}+
        </span>
        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-bold text-accent">
          {confidencePct}%
        </span>
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-slate-400">
        <li>
          We project{" "}
          <span className="font-semibold text-slate-200">{pred}</span> vs the{" "}
          {target}+ line{" "}
          <span className={edge >= 0 ? "text-accent-win" : "text-accent-loss"}>
            (edge {signed(edge)})
          </span>
        </li>
        {l.hitRate != null ? (
          <li>
            Cleared the line in{" "}
            <span className="font-semibold text-slate-200">
              {Math.round(l.hitRate * 100)}%
            </span>{" "}
            of recent games
          </li>
        ) : null}
        {l.history && l.history.bets > 0 ? (
          <li>
            Your record:{" "}
            <span className="font-semibold text-slate-200">
              {l.history.hits}/{l.history.bets}
            </span>{" "}
            on this player &amp; stat
          </li>
        ) : null}
        {newsNote ? (
          <li className="text-accent-pending">News: {newsNote}</li>
        ) : null}
        <li>
          Priced in your bookie app — confirm the line before you bet.
        </li>
      </ul>
    </div>
  );
}

// Editable leg: `target` is the whole number the punter is chasing.
type EditableLeg = SuggestedLeg & { target: number };

function toEditable(legs: SuggestedLeg[]): EditableLeg[] {
  return legs.map((l) => ({ ...l, target: lineTarget(l.line) }));
}

function legConfidence(l: EditableLeg): number {
  const p = clearProbability({
    prediction: l.prediction,
    line: l.target - 0.5,
    form: l.recentForm ?? [],
  });
  return Math.max(0, Math.min(1, p));
}

function combinedChance(legs: EditableLeg[]): number | null {
  if (legs.length === 0) return null;
  return legs.reduce((acc, l) => acc * legConfidence(l), 1);
}

function legKey(playerId: number, statType: string): string {
  return `${playerId}:${statType}`;
}

function countByStat(legs: EditableLeg[]): Partial<Record<StatType, number>> {
  const out: Partial<Record<StatType, number>> = {};
  for (const l of legs) {
    out[l.statType] = (out[l.statType] ?? 0) + 1;
  }
  return out;
}

function statCountLabel(counts: Partial<Record<StatType, number>>): string {
  const parts = (["disposals", "goals", "marks", "tackles"] as const)
    .filter((s) => (counts[s] ?? 0) > 0)
    .map((s) => `${counts[s]} ${s}`);
  return parts.length > 0 ? parts.join(" · ") : "";
}

function SuggestionCard({
  s,
  legs,
  setLegs,
  gameId,
  round,
  focus,
  ticketStatCounts,
  onLogged,
}: {
  s: Suggestion;
  legs: EditableLeg[];
  setLegs: React.Dispatch<React.SetStateAction<EditableLeg[]>>;
  gameId: number;
  round: number | null;
  focus: StatType | "any";
  ticketStatCounts: Partial<Record<StatType, number>>;
  onLogged: () => void;
}) {
  const router = useRouter();
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logSuccess, setLogSuccess] = useState<string | null>(null);
  const [totalOdds, setTotalOdds] = useState("");
  const [totalStake, setTotalStake] = useState("10");
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const existingKeys = new Set(legs.map((l) => legKey(l.playerId, l.statType)));
  const ticketChance = combinedChance(legs);

  function remove(playerId: number, statType: string) {
    setLegs((prev) => prev.filter((l) => !(l.playerId === playerId && l.statType === statType)));
  }

  function addLeg(candidate: SuggestedLeg) {
    setLegs((prev) => [...prev, ...toEditable([candidate])]);
  }

  function changeTarget(playerId: number, statType: StatType, delta: number) {
    const floor = minLineTarget(statType);
    setLegs((prev) =>
      prev.map((l) => {
        if (l.playerId !== playerId || l.statType !== statType) return l;
        const target = Math.max(floor, l.target + delta);
        return { ...l, target };
      }),
    );
  }

  async function onSlipFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setLogError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/bets/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "upload failed");
      setScreenshotUrl(json.url);
    } catch (err) {
      setLogError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function logMulti() {
    if (legs.length === 0) return;
    setLogging(true);
    setLogError(null);
    setLogSuccess(null);
    try {
      const res = await fetch("/api/bets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gameId,
          round: round ?? undefined,
          totalOdds: totalOdds ? Number(totalOdds) : undefined,
          totalStake: totalStake ? Number(totalStake) : undefined,
          screenshotUrl: screenshotUrl ?? undefined,
          status: "pending",
          legs: legs.map((l) => ({
            playerName: l.playerName,
            statType: l.statType,
            line: l.target - 0.5,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "save failed");
      setTotalOdds("");
      setScreenshotUrl(null);
      setLogSuccess(
        `Saved ${legs.length} legs. Build another multi here or open Bets to review.`,
      );
      onLogged();
      router.refresh();
    } catch (err) {
      setLogError((err as Error).message);
    } finally {
      setLogging(false);
    }
  }

  function toggleSuggestion(leg: SuggestedLeg, selected: boolean) {
    const key = legKey(leg.playerId, leg.statType);
    if (selected) {
      if (legs.length >= MAX_LEGS) return;
      setLegs((prev) =>
        prev.some((l) => legKey(l.playerId, l.statType) === key)
          ? prev
          : [...prev, ...toEditable([leg])],
      );
    } else {
      setLegs((prev) => prev.filter((l) => legKey(l.playerId, l.statType) !== key));
    }
  }

  const focusLabel = FOCUSES.find((f) => f.key === focus)?.label ?? "Any";

  return (
    <div className="rounded-xl border border-surface-border p-3 space-y-3">
      {s.rationale ? <p className="text-sm text-slate-200">{s.rationale}</p> : null}

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Your ticket · {legs.length} leg{legs.length === 1 ? "" : "s"}
          </div>
          {legs.length > 0 ? (
            <div className="text-[11px] capitalize text-slate-500">
              {statCountLabel(ticketStatCounts)}
            </div>
          ) : null}
        </div>

      {legs.length === 0 ? (
        <p className="text-sm text-slate-400">
          Tick players below or tap ↻ New picks to start from AI suggestions.
        </p>
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
                        disabled={l.target <= minLineTarget(l.statType)}
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
                    <span className="text-slate-500">
                      · {Math.round(legConfidence(l) * 100)}% model
                    </span>
                    {l.fantasyAvg != null ? (
                      <span className="text-slate-500">
                        · fantasy {Math.round(l.fantasyAvg)}
                      </span>
                    ) : null}
                    {l.news && (l.news.status === "test" || l.news.status === "managed") ? (
                      <span className="font-semibold text-accent-pending">
                        · {l.news.status}
                      </span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
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
      </div>

      <LogActionBar
        legCount={legs.length}
        ticketChance={ticketChance}
        logging={logging}
        uploading={uploading}
        onLog={logMulti}
      />

      <TabLegPicker
        label={focusLabel}
        suggestions={s.legs}
        legs={legs}
        onToggle={toggleSuggestion}
        atMax={legs.length >= MAX_LEGS}
      />

      <AddPlayerPanel
        gameId={gameId}
        focus={focus}
        existingKeys={existingKeys}
        onAdd={addLeg}
      />

      <div className="flex flex-wrap items-end justify-between gap-4 border-t border-surface-border pt-3">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3">
            <label className="block text-sm">
              <span className="text-slate-400">Total odds</span>
              <input
                className="input mt-1 w-24"
                inputMode="decimal"
                placeholder="301"
                value={totalOdds}
                onChange={(e) => setTotalOdds(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-400">Stake $</span>
              <input
                className="input mt-1 w-20"
                inputMode="decimal"
                value={totalStake}
                onChange={(e) => setTotalStake(e.target.value)}
              />
            </label>
          </div>
          <div className="space-y-2">
            <label className="block text-sm">
              <span className="text-slate-400">Slip screenshot (optional)</span>
              <input
                type="file"
                accept="image/*"
                onChange={onSlipFile}
                className="mt-1 block w-full max-w-sm text-xs text-slate-300 file:mr-2 file:rounded file:border-0 file:bg-surface file:px-2 file:py-1 file:text-xs file:font-medium file:text-slate-200"
              />
            </label>
            {uploading ? <p className="text-xs text-slate-400">Uploading slip…</p> : null}
            {screenshotUrl ? (
              <div className="flex items-start gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={screenshotUrl}
                  alt="Bet slip"
                  className="max-h-24 rounded border border-surface-border"
                />
                <button
                  type="button"
                  className="text-xs text-slate-500 hover:text-accent-loss"
                  onClick={() => setScreenshotUrl(null)}
                >
                  Remove
                </button>
              </div>
            ) : null}
          </div>
          {logError ? <p className="text-sm text-accent-loss">{logError}</p> : null}
          {logSuccess ? (
            <p className="text-sm text-accent-win">{logSuccess}</p>
          ) : null}
          <p className="max-w-sm text-[11px] text-slate-500">
            Only log once the ticket matches Sportsbet — tick players above, then
            attach the slip screenshot for your records.
          </p>
        </div>
        <div className="text-right sm:hidden">
          <div className="text-xs text-slate-400">Modelled chance</div>
          <div className="text-lg font-bold text-white">
            {ticketChance != null ? `${Math.round(ticketChance * 100)}%` : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

function LogActionBar({
  legCount,
  ticketChance,
  logging,
  uploading,
  onLog,
}: {
  legCount: number;
  ticketChance: number | null;
  logging: boolean;
  uploading: boolean;
  onLog: () => void;
}) {
  const chancePct = ticketChance != null ? Math.round(ticketChance * 100) : null;

  return (
    <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-surface-border bg-surface-card/95 p-3 shadow-lg backdrop-blur sm:bottom-2">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">
          Ready to log
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="text-sm text-slate-300">
            Modelled chance{" "}
            <span className="font-bold tabular-nums text-white">
              {chancePct != null ? `${chancePct}%` : "—"}
            </span>
          </span>
          <span className="text-sm text-slate-500">
            {legCount === 0
              ? "Tick players below to build your ticket"
              : `${legCount} leg${legCount === 1 ? "" : "s"} selected`}
          </span>
        </div>
      </div>
      <button
        type="button"
        className="btn inline-flex shrink-0 items-center gap-2"
        onClick={onLog}
        disabled={logging || uploading || legCount === 0}
        aria-live="polite"
        aria-label={
          legCount === 0
            ? "Log this multi — add legs first"
            : `Log this multi with ${legCount} legs`
        }
      >
        {logging ? (
          "Logging…"
        ) : (
          <>
            Log this multi
            <span
              className={`inline-flex min-w-[1.75rem] items-center justify-center rounded-full px-2 py-0.5 text-sm font-bold tabular-nums ${
                legCount > 0
                  ? "bg-surface text-accent"
                  : "bg-surface/80 text-slate-500"
              }`}
            >
              {legCount}
            </span>
          </>
        )}
      </button>
    </div>
  );
}

function TabLegPicker({
  label,
  suggestions,
  legs,
  onToggle,
  atMax,
}: {
  label: string;
  suggestions: SuggestedLeg[];
  legs: EditableLeg[];
  onToggle: (leg: SuggestedLeg, selected: boolean) => void;
  atMax: boolean;
}) {
  const selectedKeys = new Set(legs.map((l) => legKey(l.playerId, l.statType)));

  if (suggestions.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No {label.toLowerCase()} suggestions for this game — try another tab or + Add
        player.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-surface-border/80 bg-surface/30 p-2.5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Add from {label}
        </div>
        <div className="text-[11px] tabular-nums text-slate-500">
          {legs.length} on ticket
        </div>
      </div>
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {suggestions.map((leg) => {
          const key = legKey(leg.playerId, leg.statType);
          const checked = selectedKeys.has(key);
          const c = teamColors(leg.team);
          const target = lineTarget(leg.line);
          const disabled = !checked && atMax;
          return (
            <li key={key}>
              <label
                className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 ${
                  checked ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-surface"
                } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 rounded border-surface-border accent-accent"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => onToggle(leg, e.target.checked)}
                />
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-bold"
                  style={{ background: c.bg, color: c.fg }}
                >
                  {leg.jumper ?? "–"}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-white">
                  {leg.playerName}
                </span>
                <span className="text-xs capitalize text-slate-400">
                  {leg.statType} {target}+
                </span>
                <span className="text-[11px] text-slate-500">
                  {Math.round(leg.confidence * 100)}% model
                </span>
                {leg.fantasyAvg != null ? (
                  <span className="hidden text-[11px] text-slate-500 sm:inline">
                    fantasy {Math.round(leg.fantasyAvg)}
                  </span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
      {atMax ? (
        <p className="mt-2 text-[11px] text-slate-500">
          Ticket full ({MAX_LEGS} legs max) — untick someone to add more.
        </p>
      ) : null}
    </div>
  );
}

// Lets the punter add a leg the auto-pick didn't surface — any bettable
// (player, stat) pair for the game, not just the active focus tab, since a
// real SGM ticket is freeform once you start editing it. Fetches the full
// candidate pool lazily (only once the picker is opened) so browsing the
// list isn't on the critical path for the common case of just accepting
// the auto-pick.
function AddPlayerPanel({
  gameId,
  focus,
  existingKeys,
  onAdd,
}: {
  gameId: number;
  focus: StatType | "any";
  existingKeys: Set<string>;
  onAdd: (leg: SuggestedLeg) => void;
}) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<SuggestedLeg[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || candidates != null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/games/${gameId}/candidates`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) throw new Error(json.error || "failed");
        setCandidates(json.legs);
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, gameId, candidates]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-surface-border py-2 text-sm font-medium text-slate-400 hover:border-accent hover:text-accent"
      >
        + Add player
      </button>
    );
  }

  // Keep the picker to the active focus's market — building a Marks multi
  // should only offer Marks legs, etc. "Any" stays open to every market.
  // Order the genuine volume players first: rank by season average for the
  // stat (the real ball-magnets / key forwards), so the best names are at
  // the top of the list rather than whatever ranked by edge.
  const pool = (candidates ?? [])
    .filter(
      (c) =>
        !existingKeys.has(legKey(c.playerId, c.statType)) &&
        (focus === "any" || c.statType === focus),
    )
    .sort((a, b) => (b.seasonAvg ?? -1) - (a.seasonAvg ?? -1));
  const q = query.trim().toLowerCase();
  const filtered = q ? pool.filter((c) => c.playerName.toLowerCase().includes(q)) : pool;

  return (
    <div className="rounded-lg border border-surface-border p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search player…"
          className="min-w-0 flex-1 rounded border border-surface-border bg-surface px-2 py-1 text-sm text-white placeholder:text-slate-500"
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-slate-500 hover:text-white"
          aria-label="Close add player"
        >
          ✕
        </button>
      </div>

      {loading ? <p className="text-xs text-slate-400">Loading players…</p> : null}
      {error ? <p className="text-xs text-accent-loss">{error}</p> : null}

      {!loading && !error ? (
        filtered.length === 0 ? (
          <p className="text-xs text-slate-400">
            {pool.length === 0 ? "No other eligible players for this game." : "No match."}
          </p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {filtered.map((c) => {
              const cc = teamColors(c.team);
              const target = lineTarget(c.line);
              return (
                <li key={legKey(c.playerId, c.statType)}>
                  <button
                    type="button"
                    onClick={() => onAdd(c)}
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-surface"
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-bold"
                      style={{ background: cc.bg, color: cc.fg }}
                    >
                      {c.jumper ?? "–"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-white">
                      {c.playerName}
                    </span>
                    <span className="text-xs capitalize text-slate-400">
                      {c.statType} {target}+
                    </span>
                    {c.seasonAvg != null ? (
                      <span className="text-[11px] text-slate-500">
                        avg {c.seasonAvg.toFixed(1)}
                      </span>
                    ) : null}
                    {c.fantasyAvg != null ? (
                      <span className="text-[11px] text-slate-500">
                        fantasy {Math.round(c.fantasyAvg)}
                      </span>
                    ) : null}
                    <span className="font-bold text-accent">+</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </div>
  );
}
