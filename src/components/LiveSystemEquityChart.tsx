"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type EquityPoint = {
  n: number;
  label: string;
  game: string;
  strategy: string;
  pnl: number;
  roi: number;
};

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Math.round(n * 100) / 100;
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
}

const tooltipStyle = {
  background: "#0f172a",
  border: "1px solid #1e293b",
  borderRadius: 8,
  fontSize: 12,
};

export function LiveSystemEquityChart({ data }: { data: EquityPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2a3a" />
        <XAxis dataKey="label" stroke="#64748b" fontSize={11} />
        <YAxis
          yAxisId="pnl"
          stroke="#64748b"
          fontSize={11}
          tickFormatter={(v: number) => `$${v}`}
        />
        <YAxis
          yAxisId="roi"
          orientation="right"
          stroke="#64748b"
          fontSize={11}
          unit="%"
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value: number, name: string) =>
            name === "ROI %" ? [`${value}%`, name] : [money(value), name]
          }
          labelFormatter={(_, payload) => {
            const p = payload?.[0]?.payload as EquityPoint | undefined;
            return p ? `${p.game} · ${p.strategy}` : "";
          }}
        />
        <Legend />
        <Line
          yAxisId="pnl"
          type="monotone"
          dataKey="pnl"
          name="P&L $"
          stroke="#34d399"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
        <Line
          yAxisId="roi"
          type="monotone"
          dataKey="roi"
          name="ROI %"
          stroke="#38bdf8"
          strokeWidth={2}
          dot={{ r: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
