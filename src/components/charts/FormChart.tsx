"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const CHART_H = 90;

// Compact recent-form area chart for one player/stat. `form` is most-recent
// first; we render it chronologically with the bookmaker line as a reference.
// Uses a fixed-height chart (not ResponsiveContainer) so Recharts never
// paints a full-page invisible hit layer over the rest of the UI.
export function FormChart({
  form,
  line,
  color = "#38bdf8",
}: {
  form: number[];
  line?: number | null;
  color?: string;
}) {
  const gradientId = useId().replace(/:/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!form || form.length === 0) return null;
  const data = [...form].reverse().map((value, i) => ({ i: i + 1, value }));

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none h-[90px] w-full min-w-0 select-none"
      aria-hidden
    >
      {width > 0 ? (
        <AreaChart
          width={width}
          height={CHART_H}
          data={data}
          margin={{ top: 6, right: 4, bottom: 0, left: -24 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
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
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      ) : null}
    </div>
  );
}
