import Link from "next/link";

import type { Game, StatType } from "@/db/schema";
import { STAT_SHORT, STATS, type TeamRanking } from "@/lib/predictions/teamMatchup";
import { formatAwst } from "@/lib/time";

export interface FixtureRanks {
  home: TeamRanking | null;
  away: TeamRanking | null;
}

export function GameCard({
  game,
  featured = false,
  edges = null,
  ranks = null,
}: {
  game: Game;
  featured?: boolean;
  edges?: Record<StatType, string | null> | null;
  ranks?: FixtureRanks | null;
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
      <div className="mt-2 flex items-start justify-between gap-2">
        <TeamLine
          name={game.home}
          score={complete ? game.homeScore : null}
          edges={edges}
          ranking={ranks?.home ?? null}
        />
        <span className="mt-1 text-xs text-slate-500">vs</span>
        <TeamLine
          name={game.away}
          score={complete ? game.awayScore : null}
          align="right"
          edges={edges}
          ranking={ranks?.away ?? null}
        />
      </div>
      <div className="mt-2 text-sm text-slate-400">{formatAwst(game.commenceTime)}</div>
    </Link>
  );
}

function ordinal(n: number | undefined): string {
  if (!n) return "–";
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${suffix}`;
}

function TeamLine({
  name,
  score,
  align = "left",
  edges,
  ranking,
}: {
  name: string;
  score: number | null;
  align?: "left" | "right";
  edges?: Record<StatType, string | null> | null;
  ranking?: TeamRanking | null;
}) {
  const led = new Set<StatType>(
    edges ? (Object.keys(edges) as StatType[]).filter((s) => edges[s] === name) : [],
  );
  return (
    <div className={`flex-1 ${align === "right" ? "text-right" : ""}`}>
      <div className="font-semibold text-white">{name}</div>
      {score != null ? <div className="text-sm text-slate-400">{score}</div> : null}
      {ranking ? (
        <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
          {STATS.map((s, i) => (
            <span key={s}>
              {i > 0 ? <span className="text-slate-600"> · </span> : null}
              <span className={led.has(s) ? "font-semibold text-accent" : ""}>
                {STAT_SHORT[s]} {ordinal(ranking.rank[s])}
              </span>
            </span>
          ))}
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
