import Link from "next/link";

import type { Game } from "@/db/schema";
import { formatAwst } from "@/lib/time";

export function GameCard({ game, featured = false }: { game: Game; featured?: boolean }) {
  const complete = game.status === "complete";
  return (
    <Link
      href={`/games/${game.id}`}
      className={`card block transition hover:border-accent ${
        featured ? "border-accent/60" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-slate-400">
          {game.round ? `Round ${game.round}` : "Fixture"}
          {game.venue ? ` · ${game.venue}` : ""}
        </span>
        <StatusPill status={game.status} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <TeamLine name={game.home} score={complete ? game.homeScore : null} />
        <span className="text-xs text-slate-500">vs</span>
        <TeamLine name={game.away} score={complete ? game.awayScore : null} align="right" />
      </div>
      <div className="mt-2 text-sm text-slate-400">{formatAwst(game.commenceTime)}</div>
    </Link>
  );
}

function TeamLine({
  name,
  score,
  align = "left",
}: {
  name: string;
  score: number | null;
  align?: "left" | "right";
}) {
  return (
    <div className={`flex-1 ${align === "right" ? "text-right" : ""}`}>
      <div className="font-semibold text-white">{name}</div>
      {score != null ? (
        <div className="text-sm text-slate-400">{score}</div>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: Game["status"] }) {
  const map: Record<Game["status"], string> = {
    scheduled: "bg-accent/15 text-accent",
    in_progress: "bg-accent-pending/15 text-accent-pending",
    complete: "bg-slate-600/30 text-slate-300",
  };
  const label: Record<Game["status"], string> = {
    scheduled: "Upcoming",
    in_progress: "Live",
    complete: "Final",
  };
  return <span className={`pill ${map[status]}`}>{label[status]}</span>;
}
