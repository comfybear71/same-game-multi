"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface PredictedDatum {
  stat: string;
  line: number | null;
  A: number | null;
  B: number | null;
  C: number | null;
}

// Per-player bar chart: Models A/B/C predictions per stat, with the bookmaker
// line alongside for reference.
export function PredictedVsAverageChart({ data }: { data: PredictedDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2a3a" />
        <XAxis dataKey="stat" stroke="#94a3b8" fontSize={12} />
        <YAxis stroke="#94a3b8" fontSize={12} />
        <Tooltip
          contentStyle={{
            background: "#131a26",
            border: "1px solid #1f2a3a",
            borderRadius: 8,
            color: "#e2e8f0",
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="line" name="Bookie line" fill="#475569" radius={[3, 3, 0, 0]} />
        <Bar dataKey="A" name="A · Simple" fill="#64748b" radius={[3, 3, 0, 0]} />
        <Bar dataKey="B" name="B · Form" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
        <Bar dataKey="C" name="C · Smart" fill="#38bdf8" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
