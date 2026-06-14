import Link from "next/link";
import { notFound } from "next/navigation";

import { getGameById } from "@/lib/data/games";
import { formatAwst } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (Number.isNaN(id)) notFound();

  let game = null;
  try {
    game = await getGameById(id);
  } catch {
    game = null;
  }
  if (!game) notFound();

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-accent hover:underline">
        ← Back to fixtures
      </Link>

      <header className="card">
        <div className="text-xs uppercase tracking-wide text-slate-400">
          {game.round ? `Round ${game.round}` : "Fixture"}
          {game.venue ? ` · ${game.venue}` : ""}
        </div>
        <h1 className="mt-1 text-2xl font-bold text-white">
          {game.home} <span className="text-slate-500">vs</span> {game.away}
        </h1>
        <p className="mt-1 text-sm text-slate-400">{formatAwst(game.commenceTime)}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <SquadPanel team={game.home} side="Home" />
        <SquadPanel team={game.away} side="Away" />
      </div>

      <section className="card">
        <h2 className="text-lg font-semibold text-white">Predictions</h2>
        <p className="mt-1 text-sm text-slate-400">
          Three models per player per stat — A (season avg), B (form-weighted),
          C (smart: form + opponent + venue). Player ingestion and per-player
          predictions are wired next; see the build plan.
        </p>
        <ModelLegend />
      </section>
    </div>
  );
}

function SquadPanel({ team, side }: { team: string; side: "Home" | "Away" }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">{team}</h3>
        <span className="pill bg-surface text-slate-400">{side}</span>
      </div>
      <p className="mt-3 text-sm text-slate-400">
        Squad &amp; per-player stats (season avg, recent form, head-to-head,
        injury status) appear here once player ingestion is connected. Injury
        field shows &ldquo;—&rdquo; until a news source is wired.
      </p>
    </div>
  );
}

function ModelLegend() {
  const rows = [
    { k: "A", name: "Simple", desc: "Season average" },
    { k: "B", name: "Form-weighted", desc: "Recent form weighted over season" },
    { k: "C", name: "Smart", desc: "Form × opponent strength × venue" },
  ];
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-3">
      {rows.map((r) => (
        <div key={r.k} className="rounded-lg border border-surface-border p-3">
          <div className="font-semibold text-accent">Model {r.k}</div>
          <div className="text-sm text-white">{r.name}</div>
          <div className="text-xs text-slate-400">{r.desc}</div>
        </div>
      ))}
    </div>
  );
}
