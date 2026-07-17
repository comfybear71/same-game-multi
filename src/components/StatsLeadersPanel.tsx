"use client";

import { useEffect, useState } from "react";

import { AFL_TEAMS } from "@/lib/afl/teams";

const TEAM_SHORT: Record<string, string> = {
  Adelaide: "Adel",
  "Brisbane Lions": "Bris",
  Carlton: "Carl",
  Collingwood: "Coll",
  Essendon: "Ess",
  Fremantle: "Freo",
  Geelong: "Geel",
  "Gold Coast": "GC",
  "Greater Western Sydney": "GWS",
  Hawthorn: "Haw",
  Melbourne: "Melb",
  "North Melbourne": "North",
  "Port Adelaide": "Port",
  Richmond: "Rich",
  "St Kilda": "StK",
  Sydney: "Syd",
  "West Coast": "WCE",
  "Western Bulldogs": "Dogs",
};
import type {
  BenchmarkBand,
  LeaderMetric,
  LeaderRow,
  PositionBucket,
} from "@/lib/data/leaders";
import { LEADER_METRICS } from "@/lib/data/leaders";

const METRIC_LABEL: Record<LeaderMetric, string> = {
  disposals: "Disposals",
  kicks: "Kicks",
  handballs: "Handballs",
  marks: "Marks",
  tackles: "Tackles",
  goals: "Goals",
};

const POSITIONS: { key: PositionBucket | "ALL"; label: string }[] = [
  { key: "ALL", label: "All pos" },
  { key: "MID", label: "MID" },
  { key: "KEYF", label: "KEYF" },
  { key: "FWD", label: "FWD" },
  { key: "RUC", label: "RUC" },
  { key: "DEF", label: "DEF" },
  { key: "KEYD", label: "KEYD" },
];

const BAND_STYLE: Record<BenchmarkBand, string> = {
  elite: "bg-sky-500/25 text-sky-200 border-sky-500/40",
  above: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
  average: "bg-amber-500/15 text-amber-100 border-amber-500/35",
  below: "bg-rose-500/15 text-rose-200 border-rose-500/35",
};

const BAND_LABEL: Record<BenchmarkBand, string> = {
  elite: "Elite",
  above: "Above avg",
  average: "Average",
  below: "Below avg",
};

type Props = {
  season: number;
  /** Prefill H2H club filter (e.g. Collingwood + Carlton). */
  defaultTeam?: string | null;
  defaultTeamB?: string | null;
  defaultMetric?: LeaderMetric;
};

export function StatsLeadersPanel({
  season,
  defaultTeam = null,
  defaultTeamB = null,
  defaultMetric = "disposals",
}: Props) {
  const [metric, setMetric] = useState<LeaderMetric>(defaultMetric);
  const [team, setTeam] = useState<string | null>(defaultTeam);
  const [teamB, setTeamB] = useState<string | null>(defaultTeamB);
  const [position, setPosition] = useState<PositionBucket | "ALL">("ALL");
  const [bettableOnly, setBettableOnly] = useState(true);
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          season: String(season),
          metric,
          limit: "30",
        });
        if (team) params.set("team", team);
        if (teamB) params.set("teamB", teamB);
        if (position !== "ALL") params.set("position", position);
        if (bettableOnly) params.set("bettable", "1");
        const res = await fetch(`/api/leaders?${params}`);
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          rows?: LeaderRow[];
        };
        if (cancelled) return;
        if (!res.ok || json.ok === false) {
          throw new Error(json.error ?? `Failed (${res.status})`);
        }
        setRows(json.rows ?? []);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [season, metric, team, teamB, position, bettableOnly]);

  function toggleClub(name: string) {
    if (team === name) {
      setTeam(teamB);
      setTeamB(null);
      return;
    }
    if (teamB === name) {
      setTeamB(null);
      return;
    }
    if (!team) setTeam(name);
    else if (!teamB) setTeamB(name);
    else {
      setTeam(teamB);
      setTeamB(name);
    }
  }

  const scope =
    team && teamB ? `${team} + ${teamB}` : team ? team : "All clubs";

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-white">Stats leaders</h2>
        <p className="text-[11px] text-slate-500">
          Our season averages · position-relative benchmarking · {scope}. Use
          Elite→Average when filling Lab recipes.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {LEADER_METRICS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMetric(m)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
              metric === m
                ? "border-accent/60 bg-accent/15 text-accent"
                : "border-surface-border text-slate-500 hover:text-slate-300"
            }`}
          >
            {METRIC_LABEL[m]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => {
            setTeam(null);
            setTeamB(null);
          }}
          className={`rounded-md border px-2 py-1 text-xs ${
            !team
              ? "border-accent/60 bg-accent/15 text-accent"
              : "border-surface-border text-slate-500"
          }`}
        >
          ALL clubs
        </button>
        {AFL_TEAMS.map((t) => {
          const on = team === t || teamB === t;
          const ord = team === t ? "1" : teamB === t ? "2" : null;
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleClub(t)}
              className={`rounded-md border px-2 py-1 text-xs ${
                on
                  ? "border-accent/60 bg-accent/15 text-accent"
                  : "border-surface-border text-slate-500"
              }`}
            >
              {TEAM_SHORT[t] ?? t.slice(0, 4)}
              {ord ? (
                <span className="ml-1 text-[10px] text-slate-500">{ord}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {POSITIONS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPosition(p.key)}
            className={`rounded-md border px-2 py-1 text-xs ${
              position === p.key
                ? "border-accent/60 bg-accent/15 text-accent"
                : "border-surface-border text-slate-500"
            }`}
          >
            {p.label}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={bettableOnly}
            onChange={(e) => setBettableOnly(e.target.checked)}
            className="accent-sky-400"
          />
          Elite→Average only
        </label>
      </div>

      <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wide text-slate-500">
        {(Object.keys(BAND_LABEL) as BenchmarkBand[]).map((b) => (
          <span
            key={b}
            className={`rounded border px-1.5 py-0.5 ${BAND_STYLE[b]}`}
          >
            {BAND_LABEL[b]}
          </span>
        ))}
      </div>

      {error ? <p className="text-xs text-accent-loss">{error}</p> : null}
      {busy ? (
        <p className="text-sm text-slate-500">Loading leaders…</p>
      ) : null}

      {!busy && rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          No averages yet — upload lineups and generate predictions, or pick
          two clubs (history scrape for kicks/handballs).
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-surface-border">
          <table className="w-full min-w-[28rem] text-left text-xs">
            <thead className="bg-surface text-slate-500">
              <tr>
                <th className="px-2 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">Player</th>
                <th className="px-2 py-2 font-medium">Pos</th>
                <th className="px-2 py-2 font-medium">Club</th>
                <th className="px-2 py-2 font-medium">{METRIC_LABEL[metric]}</th>
                <th className="px-2 py-2 font-medium">Band</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.playerId}-${r.metric}`}
                  className="border-t border-surface-border/60"
                >
                  <td className="px-2 py-1.5 tabular-nums text-slate-500">
                    {r.rank}
                  </td>
                  <td className="px-2 py-1.5 text-white">{r.playerName}</td>
                  <td className="px-2 py-1.5 text-slate-400">{r.position}</td>
                  <td className="px-2 py-1.5 text-slate-400">
                    {(r.team ?? "—").replace("Greater Western Sydney", "GWS")}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`inline-block rounded border px-1.5 py-0.5 font-semibold tabular-nums ${BAND_STYLE[r.band]}`}
                    >
                      {r.average}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-slate-400">
                    {BAND_LABEL[r.band]}
                    <span className="ml-1 text-slate-600">
                      p{Math.round(r.percentile)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
