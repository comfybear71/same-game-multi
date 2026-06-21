"use client";

import { useState } from "react";

import { FormChart } from "@/components/charts/FormChart";
import type { StatType } from "@/db/schema";
import { teamColors } from "@/lib/afl/teamColors";
import type { PlayerBetRecord } from "@/lib/data/bets";
import type { PlayerStatRow, StatBoard } from "@/lib/data/statboard";
import { floorStat, floorStatLabel, lineTarget, signed } from "@/lib/format";
import type { InjuryStatus } from "@/lib/ingest/injuries";
import { clearProbability } from "@/lib/predictions/probability";

// Mirror of playerRecordKey's normalisation (kept identical to lib/data/bets).
function recordKey(name: string, stat: string): string {
  const n = name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${n}:${stat}`;
}

const STAT_TABS: { key: StatType; label: string }[] = [
  { key: "disposals", label: "Disposals" },
  { key: "marks", label: "Marks" },
  { key: "tackles", label: "Tackles" },
  { key: "goals", label: "Goals" },
];

type Tier = "Safe" | "Balanced" | "Aggressive";

// Per-leg confidence, using the SAME formula the multi builder sorts its
// Cautious tier by (lib/predictions/suggest.ts confidenceOf): recent hit rate
// blended with how far our prediction clears the line. So a "Safe" tag here is
// exactly what the Cautious tier picks first.
function confidenceTier(
  edge: number | null,
  hitRate: number | null,
  line: number | null,
): Tier | null {
  if (edge == null || line == null) return null;
  const hr = hitRate ?? 0.5;
  const margin = Math.max(0, Math.min(1, edge / (0.15 * Math.max(line, 1))));
  const score = Math.max(0, Math.min(1, 0.55 * hr + 0.45 * margin));
  if (score >= 0.66) return "Safe";
  if (score >= 0.45) return "Balanced";
  return "Aggressive";
}

const TIER_STYLE: Record<Tier, string> = {
  Safe: "bg-accent-win/20 text-accent-win",
  Balanced: "bg-accent-pending/20 text-accent-pending",
  Aggressive: "bg-accent-loss/20 text-accent-loss",
};

type SortKey = "edge" | "hitRate" | "prediction" | "seasonAvg" | "fantasy" | "name";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "edge", label: "Edge" },
  { key: "hitRate", label: "Hit rate" },
  { key: "prediction", label: "Projection" },
  { key: "seasonAvg", label: "Season avg" },
  { key: "fantasy", label: "Fantasy" },
  { key: "name", label: "Name" },
];

/** Sort rows by the chosen key — numeric keys descending, nulls last. */
function sortRows(rows: PlayerStatRow[], key: SortKey): PlayerStatRow[] {
  if (key === "name") {
    return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  }
  const value = (r: PlayerStatRow): number | null =>
    key === "edge"
      ? r.edge
      : key === "hitRate"
        ? r.hitRate
        : key === "prediction"
          ? r.prediction
          : key === "seasonAvg"
            ? r.seasonAvg
            : r.recentFantasyAvg;
  return [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });
}

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

function aiPickLine(picks: Partial<Record<StatType, number>>): string | null {
  const parts = STAT_TABS.filter((t) => picks[t.key] != null).map(
    (t) => `${picks[t.key]} ${t.label.toLowerCase()}`,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

// "We've under/over-rated him" hint, shown once we have a few games and the
// bias is meaningful (>=5%). Round the averages for a clean read.
function CalibrationNote({ cal }: { cal: PlayerStatRow["calibration"] }) {
  if (!cal || cal.games < 3 || Math.abs(cal.factor - 1) < 0.05) return null;
  const under = cal.factor > 1;
  return (
    <div className="mt-2 text-xs">
      <span className={under ? "text-accent-win" : "text-accent-loss"}>
        {under ? "📈 We under-rate him" : "📉 We over-rate him"}
      </span>{" "}
      <span className="text-slate-400">
        — baseline {Math.round(cal.predAvg)}, actual averaging{" "}
        {Math.round(cal.actualAvg)} over {cal.games} game{cal.games === 1 ? "" : "s"}
      </span>
    </div>
  );
}

// Coarse news status -> chip label + colour. "unknown" never renders a chip.
const NEWS_CHIP: Record<InjuryStatus, { label: string; cls: string } | null> = {
  out: { label: "OUT", cls: "bg-accent-loss/20 text-accent-loss ring-accent-loss/40" },
  test: { label: "TEST", cls: "bg-accent-pending/20 text-accent-pending ring-accent-pending/40" },
  managed: { label: "MANAGED", cls: "bg-accent-pending/20 text-accent-pending ring-accent-pending/40" },
  available: { label: "NAMED", cls: "bg-accent-win/20 text-accent-win ring-accent-win/40" },
  unknown: null,
};

// Pure analysis, no recommendation: for each candidate whole-number target
// around our projection, the modelled chance the player clears it (P(count ≥ T),
// shrunk for small samples). Lets you read off your own "softer safer number" —
// e.g. projected 32, but 27+ lands ~84% — rather than the app picking one.
function ClearChanceLadder({
  prediction,
  form,
  statLabel,
}: {
  prediction: number;
  form: number[];
  statLabel: string;
}) {
  const proj = Math.floor(prediction);
  // One rung above the projection (the "stretch") down to a good way below it,
  // so a softer number like projected 32 → 27+ is on the ladder to read off.
  const lo = Math.max(1, proj - 6);
  const rungs: { target: number; pct: number; isProj: boolean }[] = [];
  for (let t = proj + 1; t >= lo; t--) {
    // line = t - 0.5 makes the winning count exactly t (an "t+" market).
    rungs.push({
      target: t,
      pct: Math.round(clearProbability({ prediction, line: t - 0.5, form }) * 100),
      isProj: t === proj,
    });
  }
  return (
    <div className="mt-3">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
        Chance to clear · {statLabel}
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {rungs.map((r) => {
          const cls =
            r.pct >= 80
              ? "text-accent-win"
              : r.pct >= 60
                ? "text-accent-pending"
                : "text-accent-loss";
          return (
            <div
              key={r.target}
              className={`flex min-w-[3rem] flex-col items-center rounded px-2 py-1 ${
                r.isProj ? "bg-accent/15 ring-1 ring-accent/40" : "bg-surface"
              }`}
            >
              <span className="text-xs font-semibold text-slate-200">{r.target}+</span>
              <span className={`text-xs font-bold ${cls}`}>{r.pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StatBoardView({
  board,
  record = {},
}: {
  board: StatBoard;
  record?: Record<string, PlayerBetRecord>;
}) {
  const [stat, setStat] = useState<StatType>("disposals");
  const [team, setTeam] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("edge");

  // Show every player we have a prediction for. Players without a bookmaker
  // line for this stat (edge == null) sort to the bottom under the default
  // "Edge" sort, so lined picks still lead — but nobody is hidden.
  const all = board.byStat[stat].filter((r) => team === "all" || r.team === team);
  const rows = sortRows(all, sort);

  return (
    <div className="space-y-3">
      {/* Stat tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STAT_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStat(t.key)}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${
              stat === t.key
                ? "bg-accent text-surface"
                : "bg-surface-card text-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Team filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {["all", board.home, board.away].map((t) => (
          <button
            key={t}
            onClick={() => setTeam(t)}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
              team === t
                ? "bg-slate-200 text-surface"
                : "border border-surface-border text-slate-300"
            }`}
          >
            {t === "all" ? "All players" : t}
          </button>
        ))}
      </div>

      {/* Sort */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-slate-500">
          Sort
        </span>
        {SORT_OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => setSort(o.key)}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
              sort === o.key
                ? "bg-accent/20 text-accent ring-1 ring-accent/40"
                : "border border-surface-border text-slate-300"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No players for this filter.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <PlayerStatCard
              key={r.playerId}
              row={r}
              record={record[recordKey(r.name, stat)]}
              statLabel={STAT_TABS.find((t) => t.key === stat)?.label.toLowerCase() ?? stat}
              opponent={board.home === r.team ? board.away : board.home}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerStatCard({
  row,
  record,
  statLabel,
  opponent,
}: {
  row: PlayerStatRow;
  record?: PlayerBetRecord;
  statLabel: string;
  opponent: string;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const c = teamColors(row.team);
  const newsChip = row.news ? NEWS_CHIP[row.news.status] : null;
  const age = ageFromDob(row.dob);
  const bioLine = [
    age != null ? `Age ${age}` : null,
    row.heightCm ? `${row.heightCm}cm` : null,
    row.weightKg ? `${row.weightKg}kg` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Whole-number view: the count the player must reach, and our floored
  // (downside-favouring) projection. The call + edge derive from these so
  // everything on the card stays decimal-free and internally consistent.
  const needed = row.line != null ? lineTarget(row.line) : null;
  const proj = row.prediction != null ? floorStat(row.prediction) : null;
  const hasCall = proj != null && needed != null;
  const over = hasCall ? proj >= needed : null;
  const wholeEdge = hasCall ? proj - needed : null;
  const tier = confidenceTier(row.edge, row.hitRate, row.line);
  // Last 5, displayed oldest -> newest with the most recent highlighted.
  const last5 = row.recentForm.slice(0, 5).reverse();

  return (
    <div className="card">
      <div className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-bold"
          style={{ background: c.bg, color: c.fg }}
        >
          {row.jumper ?? "–"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-white">{row.name}</span>
            {newsChip ? (
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${newsChip.cls}`}
              >
                {newsChip.label}
              </span>
            ) : null}
            <button
              type="button"
              aria-label={`Info on ${row.name}`}
              aria-expanded={showInfo}
              onClick={() => setShowInfo((v) => !v)}
              className={`shrink-0 rounded-full border px-1.5 text-[11px] font-bold leading-5 ${
                showInfo
                  ? "border-accent bg-accent/20 text-accent"
                  : "border-surface-border text-slate-400 hover:text-slate-200"
              }`}
            >
              i
            </button>
          </div>
          <div className="text-xs text-slate-400">
            {row.team}
            {row.seasonAvg != null ? ` · Season avg ${floorStat(row.seasonAvg)}` : ""}
            {row.recentFantasyAvg != null ? (
              <>
                {" · "}
                <span className="text-slate-300">
                  Fantasy {Math.round(row.recentFantasyAvg)}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="text-right">
          {hasCall ? (
            <>
              <div
                className={`text-sm font-bold ${
                  over ? "text-accent-win" : "text-accent-loss"
                }`}
              >
                {over ? "OVER" : "UNDER"} {proj}
              </div>
              <div className="text-xs text-slate-400">
                Need {needed}+
                {wholeEdge != null ? (
                  <span className={over ? "text-accent-win" : "text-accent-loss"}>
                    {" "}
                    ({signed(wholeEdge)})
                  </span>
                ) : null}
              </div>
              {tier ? (
                <div
                  className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${TIER_STYLE[tier]}`}
                >
                  {tier}
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-sm text-slate-300">
              Pred {floorStatLabel(row.prediction)}
              <div className="text-xs text-slate-500">no line</div>
            </div>
          )}
        </div>
      </div>

      {/* Clear-chance ladder: the modelled odds of each target landing, so you
          can choose your own safer number off the analysis (app never picks). */}
      {row.prediction != null && row.recentForm.length >= 2 ? (
        <ClearChanceLadder
          prediction={row.prediction}
          form={row.recentForm}
          statLabel={statLabel}
        />
      ) : null}

      {/* Info popover: opponent record + news detail (bio/weather to come) */}
      {showInfo ? (
        <div className="mt-3 space-y-1.5 rounded-md border border-surface-border bg-surface px-3 py-2 text-xs">
          <div className="font-semibold text-slate-200">Player intel</div>
          <div className="text-slate-400">
            {row.vsOpponentGames > 0 && row.vsOpponentAvg != null ? (
              <>
                vs <span className="text-slate-200">{opponent}</span>: averages{" "}
                <span className="font-semibold text-white">
                  {Math.round(row.vsOpponentAvg)}
                </span>{" "}
                {statLabel} over {row.vsOpponentGames} game
                {row.vsOpponentGames === 1 ? "" : "s"}
              </>
            ) : (
              <>No past meetings vs {opponent} on record</>
            )}
          </div>
          {row.news ? (
            <div className="text-slate-400">
              <span aria-hidden>📰</span>{" "}
              <span className="text-slate-300">{row.news.note ?? row.news.status}</span>
              {row.news.source ? (
                <span className="text-slate-600"> · {row.news.source}</span>
              ) : null}
            </div>
          ) : null}
          {bioLine ? <div className="text-slate-400">{bioLine}</div> : null}
          <div className="text-[11px] text-slate-600">Weather &amp; position coming soon.</div>
        </div>
      ) : null}

      {/* SGM AI headline pick across all four stats, favouring the downside
          (floored, not rounded) so it reads as a conservative suggestion. */}
      {aiPickLine(row.aiPicks) ? (
        <div className="mt-2 text-sm font-semibold text-accent-loss">
          SGM AI 🤖 suggests {aiPickLine(row.aiPicks)}
        </div>
      ) : null}

      {/* Matched injury/team news headline (why the chip is showing) */}
      {row.news && newsChip ? (
        <div className="mt-2 flex gap-1.5 text-xs text-slate-400">
          <span aria-hidden>📰</span>
          <span className="min-w-0">
            <span className="text-slate-300">{row.news.note ?? newsChip.label}</span>
            {row.news.source ? (
              <span className="text-slate-600"> · {row.news.source}</span>
            ) : null}
          </span>
        </div>
      ) : null}

      {/* Calibration: how the player has gone vs our baseline on this stat */}
      <CalibrationNote cal={row.calibration} />

      {/* Your past record on this player + stat (the "learning" hint) */}
      {record && record.bets > 0 ? (
        <div className="mt-3 rounded-md bg-surface px-2.5 py-1.5 text-xs text-slate-400">
          <span className="font-semibold text-slate-200">Your record:</span>{" "}
          <span className="text-accent-win">{record.hits}</span>
          <span className="text-slate-500">/</span>
          {record.bets} {record.bets === 1 ? "bet" : "bets"} · last time{" "}
          {record.lastLine} →{" "}
          <span
            className={
              record.lastResult === "hit" ? "text-accent-win" : "text-accent-loss"
            }
          >
            {record.lastActual ?? "—"} {record.lastResult === "hit" ? "✓" : "✗"}
          </span>
        </div>
      ) : (
        <div className="mt-3 rounded-md bg-surface px-2.5 py-1.5 text-xs text-slate-500">
          ✨ New pick — you&apos;ve never backed his {statLabel} before.
        </div>
      )}

      {/* Last 5 form chips */}
      {last5.length > 0 ? (
        <div className="mt-3 flex items-center gap-1">
          <span className="mr-1 text-[11px] uppercase tracking-wide text-slate-500">
            Last 5
          </span>
          {last5.map((v, i) => {
            const newest = i === last5.length - 1;
            return (
              <span
                key={i}
                className={`inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded px-1.5 text-xs ${
                  newest
                    ? "bg-accent/20 font-semibold text-white ring-1 ring-accent"
                    : "bg-surface text-slate-300"
                }`}
              >
                {v}
              </span>
            );
          })}
          {row.hitRate != null ? (
            <span className="ml-auto text-[11px] text-slate-400">
              Hit{" "}
              <span className="font-semibold text-white">
                {Math.round(row.hitRate * 100)}%
              </span>
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Recent-form chart */}
      {row.recentForm.length > 1 ? (
        <div className="mt-2">
          <FormChart form={row.recentForm} line={row.line} />
        </div>
      ) : null}

      {/* Actual once settled */}
      {row.actual != null ? (
        <div className="mt-1 text-xs text-slate-400">
          Actual: <span className="font-semibold text-white">{row.actual}</span>
          {row.line != null ? (
            <span className={row.actual > row.line ? " text-accent-win" : " text-accent-loss"}>
              {" "}
              {row.actual > row.line ? "over" : "under"} the line
            </span>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}
