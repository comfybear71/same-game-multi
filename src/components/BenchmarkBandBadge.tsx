import type { BenchmarkBand } from "@/lib/data/leaders";

const BAND_STAMP: Record<BenchmarkBand | "unknown", string> = {
  elite: "border-sky-500/45 bg-sky-500/20 text-sky-200",
  above: "border-emerald-500/40 bg-emerald-500/12 text-emerald-200",
  average: "border-amber-500/35 bg-amber-500/10 text-amber-100",
  below: "border-rose-500/35 bg-rose-500/10 text-rose-200",
  unknown: "border-surface-border text-slate-500",
};

const BAND_SHORT: Record<BenchmarkBand | "unknown", string> = {
  elite: "Elite",
  above: "Above",
  average: "Avg",
  below: "Below",
  unknown: "—",
};

/** Leaders / lineup review / squad board — same pill as lineup grid. */
export function BenchmarkBandBadge({
  band,
  className = "",
}: {
  band: BenchmarkBand | "unknown" | null | undefined;
  className?: string;
}) {
  const key = band ?? "unknown";
  const bandCls = BAND_STAMP[key] ?? BAND_STAMP.unknown;
  return (
    <span
      className={`shrink-0 rounded border px-1 py-px text-[8px] font-semibold uppercase leading-none ${bandCls} ${className}`}
      title={BAND_SHORT[key]}
    >
      {BAND_SHORT[key]}
    </span>
  );
}
