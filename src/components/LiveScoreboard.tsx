"use client";

import { useEffect, useState } from "react";

interface LiveState {
  status: "scheduled" | "live" | "final";
  timestr: string | null;
  homeScore: number | null;
  awayScore: number | null;
  complete: number;
}

export function LiveScoreboard({
  gameId,
  home,
  away,
}: {
  gameId: number;
  home: string;
  away: string;
}) {
  const [state, setState] = useState<LiveState | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      try {
        const res = await fetch(`/api/games/${gameId}/live`);
        const json = await res.json();
        if (cancelled) return;
        const s: LiveState | null = json.state ?? null;
        setState(s);
        // Keep polling only while the game is live.
        if (s?.status === "live") timer = setTimeout(tick, 45000);
      } catch {
        /* ignore; try again next mount */
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [gameId]);

  if (!state || state.status === "scheduled") return null;

  const live = state.status === "live";
  return (
    <div className={`card ${live ? "border-accent/60" : ""}`}>
      <div className="flex items-center justify-between">
        <span
          className={`pill ${
            live ? "bg-accent-loss/20 text-accent-loss" : "bg-slate-600/30 text-slate-300"
          }`}
        >
          {live ? "● LIVE" : "Final"}
        </span>
        {state.timestr ? (
          <span className="text-sm font-medium text-slate-300">{state.timestr}</span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex-1">
          <div className="font-semibold text-white">{home}</div>
        </div>
        <div className="px-3 text-2xl font-bold text-white">
          {state.homeScore ?? 0} <span className="text-slate-500">–</span>{" "}
          {state.awayScore ?? 0}
        </div>
        <div className="flex-1 text-right">
          <div className="font-semibold text-white">{away}</div>
        </div>
      </div>
    </div>
  );
}
