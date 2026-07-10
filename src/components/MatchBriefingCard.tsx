import { FormGuide } from "@/components/TeamFormAndRanks";
import type { FormResult } from "@/lib/data/games";
import type { HeadToHeadGame, LadderSnapshot, MatchBriefing } from "@/lib/data/matchBriefing";
import { formatAwst, formatAwstDate } from "@/lib/time";

function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${suffix}`;
}

function ladderLine(snap: LadderSnapshot | null): string {
  if (!snap) return "—";
  const record =
    snap.draws > 0
      ? `${snap.wins}-${snap.losses}-${snap.draws}`
      : `${snap.wins}-${snap.losses}`;
  return `${ordinal(snap.rank)} · ${record} (${Math.round(snap.percentage)}%)`;
}

function meetingLabel(m: HeadToHeadGame): string {
  const winner =
    m.homeScore === m.awayScore
      ? "drew"
      : m.homeScore > m.awayScore
        ? m.home
        : m.away;
  const score = `${m.homeScore}–${m.awayScore}`;
  const when =
    m.round && m.season ? `R${m.round} ${m.season}` : m.season ? `${m.season}` : "Past meeting";
  const venue = m.venue ? ` · ${m.venue}` : "";
  if (winner === "drew") {
    return `${when}: ${m.home} ${score} ${m.away} (draw)${venue}`;
  }
  const loser = winner === m.home ? m.away : m.home;
  return `${when}: ${winner} def ${loser} ${score}${venue}`;
}

function h2hHeadline(
  home: string,
  away: string,
  summary: NonNullable<MatchBriefing["h2hSummary"]>,
  meetings: number,
): string {
  const { homeWins, awayWins, draws } = summary;
  if (homeWins === awayWins && draws === 0) {
    return `Split ${homeWins}–${homeWins} over last ${meetings}`;
  }
  if (homeWins > awayWins) {
    return `${home} lead ${homeWins}–${awayWins}${draws ? ` (${draws} draw${draws === 1 ? "" : "s"})` : ""} in last ${meetings}`;
  }
  if (awayWins > homeWins) {
    return `${away} lead ${awayWins}–${homeWins}${draws ? ` (${draws} draw${draws === 1 ? "" : "s"})` : ""} in last ${meetings}`;
  }
  return `${homeWins}–${awayWins} with ${draws} draw${draws === 1 ? "" : "s"} in last ${meetings}`;
}

export function MatchBriefingCard({
  home,
  away,
  venue,
  commenceTime,
  briefing,
}: {
  home: string;
  away: string;
  venue: string | null;
  commenceTime: Date;
  briefing: MatchBriefing;
}) {
  const hasLadder = briefing.homeLadder || briefing.awayLadder;
  const hasForm = briefing.homeForm.length > 0 || briefing.awayForm.length > 0;
  const hasH2h = briefing.h2h.length > 0;
  const lastMeeting = briefing.h2h[0] ?? null;

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Match briefing</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Context before you pick lines — ladder, recent form and head-to-head.
        </p>
      </div>

      {hasLadder ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <BriefRow label="Ladder">
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-slate-400">{home}: </span>
                <span className="font-medium text-white">{ladderLine(briefing.homeLadder)}</span>
              </div>
              <div>
                <span className="text-slate-400">{away}: </span>
                <span className="font-medium text-white">{ladderLine(briefing.awayLadder)}</span>
              </div>
            </div>
          </BriefRow>
        </div>
      ) : null}

      {hasForm ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <BriefRow label="Last 5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="mb-1 text-xs text-slate-400">{home}</div>
                <FormGuide form={briefing.homeForm as FormResult[]} />
              </div>
              <div className="text-right">
                <div className="mb-1 text-xs text-slate-400">{away}</div>
                <FormGuide form={briefing.awayForm as FormResult[]} align="right" />
              </div>
            </div>
          </BriefRow>
        </div>
      ) : null}

      {hasH2h && briefing.h2hSummary ? (
        <BriefRow label="Head-to-head">
          <div className="space-y-1 text-sm">
            <p className="font-medium text-white">
              {h2hHeadline(home, away, briefing.h2hSummary, briefing.h2h.length)}
            </p>
            {lastMeeting ? (
              <p className="text-slate-400">
                Last: {meetingLabel(lastMeeting)}
              </p>
            ) : null}
          </div>
        </BriefRow>
      ) : null}

      <BriefRow label="When &amp; where">
        <p className="text-sm text-white">
          {formatAwstDate(commenceTime)} · {formatAwst(commenceTime, "h:mm a")}
          {venue ? ` · ${venue}` : ""}
        </p>
      </BriefRow>

      <BriefRow label="Weather tip">
        <p className="text-sm text-slate-300">{briefing.weatherHint}</p>
      </BriefRow>
    </section>
  );
}

function BriefRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-surface-border bg-surface/50 px-3 py-2.5">
      <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      {children}
    </div>
  );
}
