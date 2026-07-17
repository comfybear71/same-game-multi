import { StatsLeadersPanel } from "@/components/StatsLeadersPanel";
import { currentSeason } from "@/lib/cron";

export const dynamic = "force-dynamic";

export default function LeadersPage() {
  const season = currentSeason();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Stats leaders</h1>
        <p className="text-sm text-slate-400">
          Season {season} averages from our data (AFL Tables + predictions).
          Benchmarking is relative to position — Elite→Average are the legs to
          prefer when building a multi.
        </p>
      </header>

      <div className="card">
        <StatsLeadersPanel
          season={season}
          defaultTeam="Collingwood"
          defaultTeamB="Carlton"
          defaultMetric="disposals"
        />
      </div>
    </div>
  );
}
