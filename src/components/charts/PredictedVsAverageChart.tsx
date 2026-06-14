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

export interface PredictedVsAverageDatum {
  stat: string;
  seasonAvg: number;
  modelA: number;
  modelB: number;
  modelC: number;
}

// Per-player bar chart: season average vs each model's prediction, per stat.
export function PredictedVsAverageChart({
  data,
}: {
  data: PredictedVsAverageDatum[];
}) {
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
        <Bar dataKey="seasonAvg" name="Season avg" fill="#475569" radius={[3, 3, 0, 0]} />
        <Bar dataKey="modelA" name="A · Simple" fill="#64748b" radius={[3, 3, 0, 0]} />
        <Bar dataKey="modelB" name="B · Form" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
        <Bar dataKey="modelC" name="C · Smart" fill="#38bdf8" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
