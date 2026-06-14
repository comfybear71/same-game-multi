"use client";

import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Compact recent-form area chart for one player/stat. `form` is most-recent
// first; we render it chronologically with the bookmaker line as a reference.
export function FormChart({
  form,
  line,
  color = "#38bdf8",
}: {
  form: number[];
  line?: number | null;
  color?: string;
}) {
  if (!form || form.length === 0) return null;
  const data = [...form].reverse().map((value, i) => ({ i: i + 1, value }));

  return (
    <ResponsiveContainer width="100%" height={90}>
      <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -24 }}>
        <defs>
          <linearGradient id={`form-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <XAxis dataKey="i" hide />
        <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
        <Tooltip
          contentStyle={{
            background: "#131a26",
            border: "1px solid #1f2a3a",
            borderRadius: 8,
            color: "#e2e8f0",
            fontSize: 12,
          }}
          labelFormatter={() => ""}
          formatter={(v: number) => [v, "game"]}
        />
        {line != null ? (
          <ReferenceLine y={line} stroke="#94a3b8" strokeDasharray="3 3" />
        ) : null}
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#form-${color.replace("#", "")})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
