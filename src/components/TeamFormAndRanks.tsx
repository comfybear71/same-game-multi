import type { StatType } from "@/db/schema";
import type { FormResult } from "@/lib/data/games";
import { STAT_SHORT, STATS, type TeamRanking } from "@/lib/predictions/teamMatchup";

// Shared team display: last-5 form guide (W/L/D) + league rankings on the four
// counting stats. Used on both the fixtures cards and the game detail header so
// they always read the same.

function ordinal(n: number | undefined): string {
  if (!n) return "–";
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${suffix}`;
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
  ledStats,
  align = "left",
}: {
  form?: FormResult[] | null;
  ranking?: TeamRanking | null;
  ledStats?: Set<StatType>;
  align?: "left" | "right";
}) {
  const led = ledStats ?? new Set<StatType>();
  return (
    <>
      {form && form.length > 0 ? (
        <div className="mt-1">
          <FormGuide form={form} align={align} />
        </div>
      ) : null}
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
    </>
  );
}
