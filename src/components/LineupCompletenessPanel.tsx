"use client";

import type { LineupCompletenessReport } from "@/lib/ingest/lineupCompleteness";

const GAP_LABEL: Record<string, string> = {
  missing_player_link: "No player link",
  missing_position: "No position",
  missing_predictions: "No predictions",
  missing_odds: "No odds",
};

export function LineupCompletenessPanel({
  report,
}: {
  report: LineupCompletenessReport | null | undefined;
}) {
  if (!report || report.summary.selected === 0) return null;

  const { summary, selectedPerTeam, expectedSelected } = report;
  const rosterOk =
    selectedPerTeam.home >= expectedSelected - 1 &&
    selectedPerTeam.away >= expectedSelected - 1;

  return (
    <div className="rounded-lg border border-surface-border bg-surface/40 p-3 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-slate-200">Lineup data checklist</p>
        <p className="text-slate-400">
          {summary.fullyReady}/{summary.selected} players fully ready
        </p>
      </div>
      <p className="mt-1 text-slate-400">
        Selected: {report.home} {selectedPerTeam.home} · {report.away}{" "}
        {selectedPerTeam.away}
        {!rosterOk ? (
          <span className="text-accent-pending"> — expected ~{expectedSelected} per team</span>
        ) : null}
      </p>
      {(summary.missingLink > 0 ||
        summary.missingPosition > 0 ||
        summary.missingPredictions > 0 ||
        summary.missingOdds > 0) && (
        <ul className="mt-2 list-inside list-disc space-y-0.5 text-accent-pending">
          {summary.missingLink > 0 ? (
            <li>
              {summary.missingLink} missing AFL Tables / player link — re-open this page after
              saving lineup, or run Generate predictions (creates a roster stub for debuts).
            </li>
          ) : null}
          {summary.missingPosition > 0 ? (
            <li>{summary.missingPosition} named starters without field position on sheet</li>
          ) : null}
          {summary.missingPredictions > 0 ? (
            <li>{summary.missingPredictions} missing model projections</li>
          ) : null}
          {summary.missingOdds > 0 ? (
            <li>
              {summary.missingOdds} missing odds on core markets (field players) — run{" "}
              <code className="text-slate-300">npm run harvest:odds</code> while API access
              lasts. Interchange bench is often not priced by books.
            </li>
          ) : null}
        </ul>
      )}
      {summary.fullyReady < summary.selected ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
            Players with gaps
          </summary>
          <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-slate-500">
            {report.players
              .filter((p) => p.gaps.length > 0)
              .map((p) => (
                <li key={p.lineupId}>
                  {p.playerName} ({p.team}
                  {p.jumper != null ? ` #${p.jumper}` : ""}):{" "}
                  {p.gaps.map((g) => GAP_LABEL[g] ?? g).join(", ")}
                  {p.missingOddsMarkets?.length &&
                  p.gaps.includes("missing_odds") ? (
                    <span className="text-slate-500">
                      {" "}
                      ({p.missingOddsMarkets.join(", ")})
                    </span>
                  ) : null}
                  {p.status === "interchange" &&
                  p.missingOddsMarkets?.length &&
                  !p.gaps.includes("missing_odds") ? (
                    <span className="text-slate-500">
                      {" "}
                      (bench — book often unpriced)
                    </span>
                  ) : null}
                  {p.status === "interchange" &&
                  p.gaps.includes("missing_predictions") &&
                  !p.gaps.includes("missing_player_link") ? (
                    <span className="text-slate-500">
                      {" "}
                      (debut — no AFL Tables history; bench only)
                    </span>
                  ) : null}
                </li>
              ))}
          </ul>
        </details>
      ) : (
        <p className="mt-2 text-accent-win">Roster + projections + odds look complete.</p>
      )}
    </div>
  );
}
