"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface LiveState {
  status: "scheduled" | "live" | "final";
  timestr: string | null;
  homeScore: number | null;
  awayScore: number | null;
  complete: number;
}

export function LiveGameCard({
  gameId,
  home,
  away,
  round,
  venue,
}: {
  gameId: number;
  home: string;
  away: string;
  round: number | null;
  venue: string | null;
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
        if (s?.status === "live") timer = setTimeout(tick, 45000);
      } catch {
        /* ignore */
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [gameId]);

  const live = state?.status === "live";
  const final = state?.status === "final";

  return (
    <Link href={`/games/${gameId}`} className="card block transition hover:border-accent">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-slate-400">
          {round ? `Round ${round}` : "Fixture"}
          {venue ? ` · ${venue}` : ""}
        </span>
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
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex-1 font-semibold text-white">{home}</span>
        <span className="px-2 text-xl font-bold text-white">
          {state ? `${state.homeScore ?? 0} – ${state.awayScore ?? 0}` : "–"}
        </span>
        <span className="flex-1 text-right font-semibold text-white">{away}</span>
      </div>
      {state?.timestr ? (
        <div className="mt-1 text-center text-sm text-slate-400">{state.timestr}</div>
      ) : null}
    </Link>
  );
}
