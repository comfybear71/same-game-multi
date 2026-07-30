export type TrackerStat = "disposals" | "marks" | "tackles" | "goals";

export function isTrackerStat(s: string): s is TrackerStat {
  return s === "disposals" || s === "marks" || s === "tackles" || s === "goals";
}

export type StatTheme = {
  label: string;
  pill: string;
  accent: string;
  bar: string;
  barHex: string;
  marker: string;
  markerHex: string;
  tabActive: string;
  tabIdle: string;
};

/** Distinct colours per market — tabs, labels, and in-progress bars. */
export const STAT_THEME: Record<TrackerStat, StatTheme> = {
  disposals: {
    label: "Disposals",
    pill: "bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/30",
    accent: "text-sky-400",
    bar: "bg-sky-500",
    barHex: "#0ea5e9",
    marker: "bg-sky-400",
    markerHex: "#38bdf8",
    tabActive: "bg-sky-500 text-white",
    tabIdle: "border border-sky-500/45 text-sky-300 hover:bg-sky-500/10",
  },
  marks: {
    label: "Marks",
    pill: "bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/30",
    accent: "text-violet-400",
    bar: "bg-violet-500",
    barHex: "#8b5cf6",
    marker: "bg-violet-400",
    markerHex: "#a78bfa",
    tabActive: "bg-violet-500 text-white",
    tabIdle: "border border-violet-500/45 text-violet-300 hover:bg-violet-500/10",
  },
  goals: {
    label: "Goals",
    pill: "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/30",
    accent: "text-amber-400",
    bar: "bg-amber-500",
    barHex: "#f59e0b",
    marker: "bg-amber-400",
    markerHex: "#fbbf24",
    tabActive: "bg-amber-500 text-surface",
    tabIdle: "border border-amber-500/45 text-amber-300 hover:bg-amber-500/10",
  },
  tackles: {
    label: "Tackles",
    pill: "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/30",
    accent: "text-emerald-400",
    bar: "bg-emerald-500",
    barHex: "#10b981",
    marker: "bg-emerald-400",
    markerHex: "#34d399",
    tabActive: "bg-emerald-500 text-white",
    tabIdle: "border border-emerald-500/45 text-emerald-300 hover:bg-emerald-500/10",
  },
};

export function statThemeFor(statType: string): StatTheme | null {
  return isTrackerStat(statType) ? STAT_THEME[statType] : null;
}
