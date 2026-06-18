import type { StatType } from "@/db/schema";
import type { FormResult } from "@/lib/data/games";
import { STAT_SHORT, STATS, type TeamRanking } from "@/lib/predictions/teamMatchup";

// Shared team display: last-5 form guide (W/L/D) + league rankings on the four
// counting stats, colour-tiered for instant recognition. Used on both the
// fixtures cards and the game detail header so they always read the same.

function ordinal(n: number | undefined): string {
  if (!n) return "–";
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${suffix}`;
}

/** Colour tier for a league rank: 1-5 green, 6-10 amber, 11+ red. */
function rankClass(rank: number | undefined): string {
  if (!rank) return "text-slate-500";
  if (rank <= 5) return "text-accent-win";
  if (rank <= 10) return "text-accent-pending";
  return "text-accent-loss";
}

/** Name colour by how many of the four stats this team wins vs the opponent. */
export function teamNameClass(wins: number): string {
  if (wins >= 3) return "text-accent-win";
  if (wins <= 1) return "text-accent-loss";
  return "text-white";
}

export function FormGuide({
  form,
  align = "left",
}: {
  form: FormResult[];
  align?: "left" | "right";
}) {
  const style: Record<FormResult, string> = {
    W: "bg-accent-win/20 text-accent-win",
    L: "bg-accent-loss/20 text-accent-loss",
    D: "bg-slate-600/40 text-slate-300",
  };
  return (
    <div className={`flex gap-0.5 ${align === "right" ? "justify-end" : ""}`}>
      {form.map((r, i) => (
        <span
          key={i}
          className={`inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold ${style[r]}`}
        >
          {r}
        </span>
      ))}
    </div>
  );
}

export function TeamFormAndRanks({
  form,
  ranking,
  wins,
  align = "left",
}: {
  form?: FormResult[] | null;
  ranking?: TeamRanking | null;
  /** Stats this team wins vs its opponent — emphasised with bold + ▲. */
  wins?: Set<StatType>;
  align?: "left" | "right";
}) {
  const won = wins ?? new Set<StatType>();
  return (
    <>
      {form && form.length > 0 ? (
        <div className="mt-1">
          <FormGuide form={form} align={align} />
        </div>
      ) : null}
      {ranking ? (
        <div className="mt-1 text-[11px] leading-relaxed">
          {STATS.map((s, i) => {
            const rank = ranking.rank[s];
            const isWin = won.has(s);
            return (
              <span key={s}>
                {i > 0 ? <span className="text-slate-600"> · </span> : null}
                <span className="text-slate-400">{STAT_SHORT[s]} </span>
                <span className={`${rankClass(rank)} ${isWin ? "font-bold" : ""}`}>
                  {rank === 1 ? "🏆" : ""}
                  {ordinal(rank)}
                  {isWin ? "▲" : ""}
                </span>
              </span>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
