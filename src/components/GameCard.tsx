import Link from "next/link";

import { LineupUploadButton } from "@/components/LineupUploadButton";
import { TeamFormAndRanks, teamNameClass } from "@/components/TeamFormAndRanks";
import type { Game, StatType } from "@/db/schema";
import type { FormResult } from "@/lib/data/games";
import type { TeamRanking } from "@/lib/predictions/teamMatchup";
import { formatAwst } from "@/lib/time";

export interface FixtureRanks {
  home: TeamRanking | null;
  away: TeamRanking | null;
}

export interface FixtureForm {
  home: FormResult[] | null;
  away: FormResult[] | null;
}

export interface FixtureWins {
  home: Set<StatType> | null;
  away: Set<StatType> | null;
}

export function GameCard({
  game,
  featured = false,
  ranks = null,
  form = null,
  wins = null,
  lineupUpload = false,
}: {
  game: Game;
  featured?: boolean;
  ranks?: FixtureRanks | null;
  form?: FixtureForm | null;
  wins?: FixtureWins | null;
  // Show the "upload lineup screenshot" control (upcoming games only).
  lineupUpload?: boolean;
}) {
  const complete = game.status === "complete";
  return (
    <div className={`card ${featured ? "border-accent/60" : ""}`}>
      <Link
        href={`/games/${game.id}`}
        className="block transition hover:opacity-90"
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
            ranking={ranks?.home ?? null}
            form={form?.home ?? null}
            wins={wins?.home ?? null}
          />
          <span className="mt-1 text-xs text-slate-500">vs</span>
          <TeamLine
            name={game.away}
            score={complete ? game.awayScore : null}
            align="right"
            ranking={ranks?.away ?? null}
            form={form?.away ?? null}
            wins={wins?.away ?? null}
          />
        </div>
        <div className="mt-2 text-sm text-slate-400">{formatAwst(game.commenceTime)}</div>
      </Link>
      {lineupUpload ? (
        <div className="mt-3 border-t border-surface-border pt-3">
          <LineupUploadButton gameId={game.id} />
        </div>
      ) : null}
    </div>
  );
}

function TeamLine({
  name,
  score,
  align = "left",
  ranking,
  form,
  wins,
}: {
  name: string;
  score: number | null;
  align?: "left" | "right";
  ranking?: TeamRanking | null;
  form?: FormResult[] | null;
  wins?: Set<StatType> | null;
}) {
  return (
    <div className={`flex-1 ${align === "right" ? "text-right" : ""}`}>
      <div className={`font-semibold ${wins ? teamNameClass(wins.size) : "text-white"}`}>
        {name}
      </div>
      {score != null ? <div className="text-sm text-slate-400">{score}</div> : null}
      <TeamFormAndRanks form={form} ranking={ranking} wins={wins ?? undefined} align={align} />
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
