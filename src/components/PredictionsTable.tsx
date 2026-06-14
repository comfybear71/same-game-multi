import type { PlayerPredictionRow } from "@/lib/data/predictions";
import { STAT_TYPES } from "@/lib/predictions/features";

// Per-player prediction breakdown: Models A/B/C, bookmaker line, edge (Model C
// vs line) and the actual once settled.

function fmt(n: number | null): string {
  return n == null ? "—" : n.toFixed(1);
}

function edge(c: number | null, line: number | null): { text: string; cls: string } {
  if (c == null || line == null) return { text: "—", cls: "text-slate-500" };
  const d = c - line;
  const sign = d > 0 ? "+" : "";
  const cls = d > 0 ? "text-accent-win" : d < 0 ? "text-accent-loss" : "text-slate-400";
  return { text: `${sign}${d.toFixed(1)}`, cls };
}

export function PredictionsTable({ rows }: { rows: PlayerPredictionRow[] }) {
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.playerId} className="card">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold text-white">{row.playerName}</h3>
            <span className="pill bg-surface text-slate-400">{row.team}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-1 pr-3 font-medium">Stat</th>
                  <th className="py-1 pr-3 font-medium">Line</th>
                  <th className="py-1 pr-3 font-medium">A</th>
                  <th className="py-1 pr-3 font-medium">B</th>
                  <th className="py-1 pr-3 font-medium">C</th>
                  <th className="py-1 pr-3 font-medium">Edge</th>
                  <th className="py-1 pr-3 font-medium">Actual</th>
                </tr>
              </thead>
              <tbody>
                {STAT_TYPES.map((stat) => {
                  const cell = row.stats[stat];
                  const e = edge(cell.models.C, cell.line);
                  return (
                    <tr key={stat} className="border-t border-surface-border">
                      <td className="py-1.5 pr-3 capitalize text-slate-300">{stat}</td>
                      <td className="py-1.5 pr-3 text-slate-400">{fmt(cell.line)}</td>
                      <td className="py-1.5 pr-3 text-slate-300">{fmt(cell.models.A)}</td>
                      <td className="py-1.5 pr-3 text-slate-300">{fmt(cell.models.B)}</td>
                      <td className="py-1.5 pr-3 font-semibold text-accent">
                        {fmt(cell.models.C)}
                      </td>
                      <td className={`py-1.5 pr-3 ${e.cls}`}>{e.text}</td>
                      <td className="py-1.5 pr-3 text-white">
                        {cell.actual == null ? "—" : cell.actual}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
