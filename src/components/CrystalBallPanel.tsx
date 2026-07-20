"use client";

import { useMemo, useState } from "react";

import {
  CRYSTAL_LEG_COUNTS,
  crystalBallPortfolio,
  formatCrystalLeg,
  type CrystalBallGame,
  type CrystalBallMulti,
  type CrystalBallReport,
  type OddsMode,
} from "@/lib/data/crystalBall";

function money(n: number): string {
  const v = Math.round(n * 100) / 100;
  if (Math.abs(v) >= 10_000) {
    return `${v < 0 ? "-" : ""}$${(Math.abs(v) / 1000).toFixed(1)}k`;
  }
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
}

function roiLabel(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  const rounded = Math.round(pct * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function oddsLabel(odds: number): string {
  if (odds >= 1000) return `@${odds.toFixed(0)}`;
  if (odds >= 100) return `@${odds.toFixed(1)}`;
  return `@${odds.toFixed(2)}`;
}

function MultiBlock({ multi }: { multi: CrystalBallMulti }) {
  const [open, setOpen] = useState(false);
  if (!multi.available) {
    return (
      <div className="rounded-md border border-dashed border-surface-border/80 px-3 py-2 text-[11px] text-slate-500">
        {multi.legCount} legs — not enough cleared players
      </div>
    );
  }
  const ourN = multi.legs.filter((l) => l.inOurMulti).length;
  return (
    <div className="rounded-md border border-surface-border bg-surface/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-2 text-left"
      >
        <span className="w-3 text-slate-600">{open ? "▾" : "▸"}</span>
        <span className="text-[11px] font-semibold text-white">
          ANY · {multi.legCount} legs
        </span>
        <span className="text-[11px] text-slate-500">
          {oddsLabel(multi.combinedOdds)}
          {multi.priced !== "book" ? (
            <span className="ml-1 text-slate-600">
              ({multi.priced === "estimate" ? "est" : "mixed"})
            </span>
          ) : null}
        </span>
        {ourN > 0 ? (
          <span className="text-[10px] text-accent">
            ★ {ourN} from our book
          </span>
        ) : null}
        <span className="ml-auto text-[11px] tabular-nums text-slate-400">
          {money(multi.stake)} → {money(multi.returnIfHit)}{" "}
          <span
            className={
              multi.roiPct >= 0 ? "text-accent-win" : "text-accent-loss"
            }
          >
            {roiLabel(multi.roiPct)}
          </span>
        </span>
      </button>
      {open ? (
        <ul className="space-y-1 border-t border-surface-border/60 px-2.5 py-2 text-[11px] text-slate-400">
          {multi.legs.map((leg) => (
            <li
              key={`${leg.playerId}:${leg.statType}:${leg.line}`}
              className={leg.inOurMulti ? "text-slate-200" : undefined}
            >
              {formatCrystalLeg(leg)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function GameCard({
  game,
  mode,
}: {
  game: CrystalBallGame;
  mode: OddsMode;
}) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface/30">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-surface-border/60 px-3 py-2">
        <span className="font-medium text-white">
          {game.home} v {game.away}
        </span>
        {game.ourPlayerCount > 0 ? (
          <span className="text-[10px] text-slate-500">
            {game.ourPlayerCount} players were on our System tickets
          </span>
        ) : (
          <span className="text-[10px] text-slate-600">no System tickets</span>
        )}
      </div>
      <div className="space-y-1.5 p-2">
        {CRYSTAL_LEG_COUNTS.map((n) => (
          <MultiBlock key={n} multi={game.modes[mode][n]} />
        ))}
      </div>
    </div>
  );
}

export function CrystalBallPanel({ report }: { report: CrystalBallReport }) {
  const [mode, setMode] = useState<OddsMode>("longest");

  const portfolio = useMemo(
    () => crystalBallPortfolio(report, mode),
    [report, mode],
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">{report.note}</p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">
          Odds
        </span>
        {(["longest", "shortest"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
              mode === m
                ? "bg-slate-200 text-surface"
                : "border border-surface-border text-slate-400"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Tickets" value={String(portfolio.tickets)} />
        <Stat label="Staked" value={money(portfolio.totalStaked)} />
        <Stat label="Returned" value={money(portfolio.totalReturned)} tone="win" />
        <Stat
          label="ROI"
          value={roiLabel(portfolio.roiPct)}
          tone={portfolio.netProfit >= 0 ? "win" : "loss"}
        />
      </div>
      <p className="text-[11px] text-slate-500">
        Totals = all ANY 5 / 10 / 15 {mode} multis across the round at $
        {report.stakeEach} each. ★ on a leg = that player was in our System book
        for the fixture.
      </p>

      {report.games.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nothing to show for Round {report.round} yet.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {report.gamesInReport}/{report.gamesComplete} games · Round{" "}
            {report.round} · {mode} odds
          </div>
          {report.games.map((g) => (
            <GameCard key={g.gameId} game={g} mode={mode} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "win" | "loss";
}) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface/40 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`mt-0.5 text-sm font-semibold tabular-nums ${
          tone === "win"
            ? "text-accent-win"
            : tone === "loss"
              ? "text-accent-loss"
              : "text-white"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
