import type { StatType } from "@/db/schema";
import type { StatFocus } from "@/lib/predictions/suggest";

export interface BacktestStrategy {
  key: string;
  focus: StatFocus;
  legCount: number;
  label: string;
}

const FOCUSES: { focus: StatFocus; label: string }[] = [
  { focus: "disposals", label: "Disposals" },
  { focus: "goals", label: "Goals" },
  { focus: "marks", label: "Marks" },
  { focus: "tackles", label: "Tackles" },
  { focus: "any", label: "Any" },
];

const LEG_COUNTS = [3, 6, 10] as const;

/** Production Strategy lab matrix (5 focuses × 3/6/10). */
export const BACKTEST_STRATEGIES: BacktestStrategy[] = FOCUSES.flatMap(
  ({ focus, label }) =>
    LEG_COUNTS.map((legCount) => ({
      key: `${focus}_${legCount}`,
      focus,
      legCount,
      label: `${label} · ${legCount} legs`,
    })),
);

/** Build a custom focus × leg-count grid (e.g. wide experiment 3–25). */
export function buildStrategyMatrix(opts: {
  minLegs?: number;
  maxLegs?: number;
  focuses?: StatFocus[];
}): BacktestStrategy[] {
  const minLegs = Math.max(1, Math.round(opts.minLegs ?? 3));
  const maxLegs = Math.max(minLegs, Math.round(opts.maxLegs ?? 25));
  const focusFilter = opts.focuses ? new Set(opts.focuses) : null;
  const focuses = FOCUSES.filter(
    (f) => focusFilter == null || focusFilter.has(f.focus),
  );

  const out: BacktestStrategy[] = [];
  for (let legCount = minLegs; legCount <= maxLegs; legCount++) {
    for (const { focus, label } of focuses) {
      out.push({
        key: `${focus}_${legCount}`,
        focus,
        legCount,
        label: `${label} · ${legCount} legs`,
      });
    }
  }
  return out;
}

/** Wide experiment default: 5 focuses × legs 3–25 (= 115 recipes). */
export const WIDE_EXPERIMENT_STRATEGIES = buildStrategyMatrix({
  minLegs: 3,
  maxLegs: 25,
});

export function strategyKey(
  focus: StatFocus | StatType | string,
  legCount: number,
): string {
  return `${focus}_${legCount}`;
}
