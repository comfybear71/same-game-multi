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

/** Full strategy matrix for the Strategy lab. */
export const BACKTEST_STRATEGIES: BacktestStrategy[] = FOCUSES.flatMap(({ focus, label }) =>
  LEG_COUNTS.map((legCount) => ({
    key: `${focus}_${legCount}`,
    focus,
    legCount,
    label: `${label} · ${legCount} legs`,
  })),
);

export function strategyKey(focus: StatFocus | StatType | string, legCount: number): string {
  return `${focus}_${legCount}`;
}
