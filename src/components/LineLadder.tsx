import type { StatType } from "@/db/schema";
import { clearProbability } from "@/lib/predictions/probability";

type Rung = { target: number; pct: number; isProj: boolean };

function buildRungs(
  prediction: number,
  form: number[],
  statType: StatType,
): Rung[] {
  const proj = Math.floor(prediction);
  const below = statType === "disposals" ? 8 : 4;
  const lo = Math.max(1, proj - below);
  const rungs: Rung[] = [];
  for (let t = proj + 1; t >= lo; t--) {
    rungs.push({
      target: t,
      pct: Math.round(clearProbability({ prediction, line: t - 0.5, form }) * 100),
      isProj: t === proj,
    });
  }
  return rungs;
}

/** Highest whole-number target that still clears at least minPct (default 75%). */
export function bankerRung(rungs: Rung[], minPct = 75): Rung | null {
  const eligible = rungs.filter((r) => r.pct >= minPct);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, r) => (r.target > best.target ? r : best));
}

function pctClass(pct: number): string {
  if (pct >= 80) return "text-accent-win";
  if (pct >= 60) return "text-accent-pending";
  return "text-accent-loss";
}

/**
 * Modelled chance to clear each whole-number target around the projection —
 * read off a softer "banker" line (e.g. projected 32 → 27+ ~84%) without the
 * app picking one for you.
 */
export function LineLadder({
  prediction,
  form,
  statLabel,
  statType = "disposals",
}: {
  prediction: number;
  form: number[];
  statLabel: string;
  statType?: StatType;
}) {
  const rungs = buildRungs(prediction, form, statType);
  const banker = bankerRung(rungs);

  return (
    <div className="mt-3">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">
          Chance to clear · {statLabel}
        </span>
        {banker ? (
          <span className="text-[11px] text-slate-400">
            Banker tier:{" "}
            <span className="font-semibold text-accent-win">
              {banker.target}+ ({banker.pct}%)
            </span>
          </span>
        ) : null}
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {rungs.map((r) => (
          <div
            key={r.target}
            className={`flex min-w-[3rem] flex-col items-center rounded px-2 py-1 ${
              r.isProj
                ? "bg-accent/15 ring-1 ring-accent/40"
                : banker?.target === r.target
                  ? "bg-accent-win/10 ring-1 ring-accent-win/30"
                  : "bg-surface"
            }`}
          >
            <span className="text-xs font-semibold text-slate-200">{r.target}+</span>
            <span className={`text-xs font-bold ${pctClass(r.pct)}`}>{r.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
