"use client";

import { useEffect, useState } from "react";

import { formatScoreLine, hasRealScores } from "@/lib/scoreDisplay";

export interface LiveScoreState {
  status: "scheduled" | "live" | "final";
  timestr: string | null;
  homeScore: number | null;
  awayScore: number | null;
  complete: number;
}

const LIVE_POLL_MS = 20_000;

export function LiveScoreboard({
  gameId,
  home,
  away,
  homeScore,
  awayScore,
  gameStatus,
  initialLive,
  kickedOff,
}: {
  gameId: number;
  home: string;
  away: string;
  homeScore?: number | null;
  awayScore?: number | null;
  gameStatus?: string;
  /** Server-fetched Squiggle state — shows immediately on first paint. */
  initialLive?: LiveScoreState | null;
  /** Game has started (fixtures in-play / past kickoff). */
  kickedOff?: boolean;
}) {
  const [state, setState] = useState<LiveScoreState | null>(() => {
    if (initialLive && initialLive.status !== "scheduled") return initialLive;
    if (gameStatus === "in_progress" && hasRealScores(homeScore, awayScore)) {
      return {
        status: "live",
        timestr: null,
        homeScore: homeScore ?? null,
        awayScore: awayScore ?? null,
        complete: 50,
      };
    }
    return initialLive ?? null;
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      try {
        const res = await fetch(`/api/games/${gameId}/live`);
        const json = await res.json();
        if (cancelled) return;
        const s: LiveScoreState | null = json.state ?? null;
        setState((prev) => {
          if (!s) return prev;
          if (
            prev &&
            !hasRealScores(s.homeScore, s.awayScore, s.complete) &&
            hasRealScores(prev.homeScore, prev.awayScore, prev.complete)
          ) {
            return prev;
          }
          return s;
        });
        const active = s ?? undefined;
        if (active?.status === "live") timer = setTimeout(tick, LIVE_POLL_MS);
        else if (active?.status !== "final") timer = setTimeout(tick, LIVE_POLL_MS);
      } catch {
        /* retry on next tick */
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [gameId]);

  const show =
    kickedOff ||
    state?.status === "live" ||
    state?.status === "final" ||
    gameStatus === "in_progress" ||
    gameStatus === "complete";
  if (!show) return null;

  const live =
    state?.status === "live" ||
    (kickedOff && state?.status !== "final" && gameStatus !== "complete");
  const final = state?.status === "final" || gameStatus === "complete";
  const scoreLine = state
    ? formatScoreLine(state.homeScore, state.awayScore, state.complete)
    : "–";

  return (
    <div className={`card ${live ? "border-accent/60" : ""}`}>
      <div className="flex items-center justify-between">
        <span
          className={`pill ${
            live
              ? "bg-accent-loss/20 text-accent-loss"
              : final
                ? "bg-slate-600/30 text-slate-300"
                : "bg-accent/15 text-accent"
          }`}
        >
          {live ? "● LIVE" : final ? "Final" : "Starting"}
        </span>
        {state?.timestr ? (
          <span className="text-sm font-medium text-slate-300">{state.timestr}</span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex-1">
          <div className="font-semibold text-white">{home}</div>
        </div>
        <div className="px-3 text-2xl font-bold text-white">{scoreLine}</div>
        <div className="flex-1 text-right">
          <div className="font-semibold text-white">{away}</div>
        </div>
      </div>
    </div>
  );
}
