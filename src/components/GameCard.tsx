import Link from "next/link";

import type { Game, StatType } from "@/db/schema";
import { STAT_LABEL } from "@/lib/predictions/teamMatchup";
import { formatAwst } from "@/lib/time";

export function GameCard({
  game,
  featured = false,
  edges = null,
}: {
  game: Game;
  featured?: boolean;
  edges?: Record<StatType, string | null> | null;
}) {
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
        <TeamLine name={game.home} score={complete ? game.homeScore : null} edges={edges} />
        <span className="text-xs text-slate-500">vs</span>
        <TeamLine
          name={game.away}
          score={complete ? game.awayScore : null}
          align="right"
          edges={edges}
        />
      </div>
      <div className="mt-2 text-sm text-slate-400">{formatAwst(game.commenceTime)}</div>
    </Link>
  );
}

function TeamLine({
  name,
  score,
  align = "left",
  edges,
}: {
  name: string;
  score: number | null;
  align?: "left" | "right";
  edges?: Record<StatType, string | null> | null;
}) {
  const leads = edges
    ? (Object.keys(edges) as StatType[]).filter((stat) => edges[stat] === name)
    : [];
  return (
    <div className={`flex-1 ${align === "right" ? "text-right" : ""}`}>
      <div className="font-semibold text-white">{name}</div>
      {score != null ? <div className="text-sm text-slate-400">{score}</div> : null}
      {leads.length > 0 ? (
        <div className="text-[11px] text-accent">
          Leads {leads.map((s) => STAT_LABEL[s]).join(", ")}
        </div>
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
