"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { teamColors } from "@/lib/afl/teamColors";
import type { PlayerHistorySummary } from "@/lib/data/bets";
import { normalisePlayerName } from "@/lib/playerName";
import type {
  RoundGameLineup,
  RoundLineupPlayer,
  RoundRoster,
} from "@/lib/data/roundRoster";

type PhaseFilter = "all" | "upcoming" | "played" | "live";

export function RoundRosterPanel({
  roster,
  playerHistory = {},
}: {
  roster: RoundRoster | null;
  playerHistory?: Record<string, PlayerHistorySummary>;
}) {
  const [phase, setPhase] = useState<PhaseFilter>("all");

  const counts = useMemo(() => {
    if (!roster) return { played: 0, upcoming: 0, live: 0, games: 0, withLineup: 0 };
    const withLineup = roster.games.filter((g) => g.lineupCount > 0).length;
    return {
      played: roster.games.filter((g) => g.phase === "played").length,
      upcoming: roster.games.filter((g) => g.phase === "upcoming").length,
      live: roster.games.filter((g) => g.phase === "live").length,
      games: roster.games.length,
      withLineup,
    };
  }, [roster]);

  const filteredGames = useMemo(() => {
    if (!roster) return [];
    if (phase === "all") return roster.games;
    return roster.games.filter((g) => g.phase === phase);
  }, [roster, phase]);

  const backedInRound = useMemo(() => {
    if (!roster) return 0;
    const seen = new Set<string>();
    for (const g of roster.games) {
      for (const p of g.players) {
        if (playerHistory[normalisePlayerName(p.name)]) seen.add(normalisePlayerName(p.name));
      }
    }
    return seen.size;
  }, [roster, playerHistory]);

  if (!roster) {
    return (
      <p className="text-sm text-slate-400">
        Couldn&apos;t determine the current round from fixtures.
      </p>
    );
  }

  if (counts.games === 0) {
    return (
      <p className="text-sm text-slate-400">
        No fixtures synced for round {roster.round} yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        Round {roster.round} · {counts.withLineup}/{counts.games} lineups ·{" "}
        {counts.played} played · {counts.upcoming} yet to play
        {counts.live > 0 ? ` · ${counts.live} live` : ""}
        {backedInRound > 0 ? ` · ${backedInRound} named before` : ""}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["all", `All matches (${counts.games})`],
            ["upcoming", `Yet to play (${counts.upcoming})`],
            ["played", `Played (${counts.played})`],
            ...(counts.live > 0 ? ([["live", `Live (${counts.live})`]] as const) : []),
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPhase(key)}
            className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              phase === key
                ? "bg-slate-200 text-surface"
                : "border border-surface-border text-slate-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {filteredGames.length === 0 ? (
        <p className="text-xs text-slate-500">
          No matches in this filter — try another tab.
        </p>
      ) : (
        <ul className="max-h-[28rem] space-y-1.5 overflow-y-auto">
          {filteredGames.map((g) => (
            <GameLineupCard
              key={g.gameId}
              game={g}
              playerHistory={playerHistory}
              defaultOpen={g.phase === "upcoming" && g.lineupCount > 0}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function GameLineupCard({
  game,
  playerHistory,
  defaultOpen,
}: {
  game: RoundGameLineup;
  playerHistory: Record<string, PlayerHistorySummary>;
  defaultOpen: boolean;
}) {
  const homePlayers = game.players.filter((p) => p.team === game.home);
  const awayPlayers = game.players.filter((p) => p.team === game.away);
  const backedCount = game.players.filter(
    (p) => playerHistory[normalisePlayerName(p.name)],
  ).length;
  const missedCount = game.players.filter((p) => {
    const h = playerHistory[normalisePlayerName(p.name)];
    return h && (h.lastResult === "miss" || h.hits / h.bets < 0.5);
  }).length;

  return (
    <li className="rounded border border-surface-border/60 bg-surface/20">
      <details open={defaultOpen} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 text-xs">
          <span className="shrink-0 text-slate-600 group-open:rotate-90">▸</span>
          <Link
            href={`/games/${game.gameId}`}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 truncate font-medium text-slate-200 hover:text-accent"
          >
            {game.home} v {game.away}
          </Link>
          <PhaseBadge phase={game.phase} />
          <span className="ml-auto shrink-0 text-slate-500">
            {game.lineupCount > 0 ? `${game.lineupCount} named` : "no lineup"}
            {backedCount > 0 ? (
              <span className="text-slate-400">
                {" "}
                · {backedCount} backed
                {missedCount > 0 ? (
                  <span className="text-accent-loss"> · {missedCount} cold</span>
                ) : null}
              </span>
            ) : null}
          </span>
        </summary>

        {game.lineupCount > 0 ? (
          <div className="grid gap-2 border-t border-surface-border/40 px-2 pb-2 pt-1.5 sm:grid-cols-2">
            <TeamColumn team={game.home} rows={homePlayers} playerHistory={playerHistory} />
            <TeamColumn team={game.away} rows={awayPlayers} playerHistory={playerHistory} />
          </div>
        ) : (
          <p className="border-t border-surface-border/40 px-2 pb-2 pt-1.5 text-[10px] text-slate-500">
            Upload the team sheet on{" "}
            <Link href="/" className="text-accent hover:underline">
              Fixtures
            </Link>{" "}
            or open the{" "}
            <Link href={`/games/${game.gameId}`} className="text-accent hover:underline">
              game page
            </Link>
            .
          </p>
        )}
      </details>
    </li>
  );
}

function PhaseBadge({ phase }: { phase: RoundLineupPlayer["phase"] }) {
  const cls =
    phase === "played"
      ? "text-slate-500"
      : phase === "live"
        ? "text-accent-loss"
        : "text-accent-pending";
  const label = phase === "played" ? "FT" : phase === "live" ? "live" : "upcoming";
  return <span className={`shrink-0 text-[10px] ${cls}`}>{label}</span>;
}

export function PlayerHistoryBadge({
  name,
  history,
}: {
  name: string;
  history: Record<string, PlayerHistorySummary>;
}) {
  const rec = history[normalisePlayerName(name)];
  if (!rec || rec.bets === 0) return null;

  const pct = Math.round((rec.hits / rec.bets) * 100);
  const missedLast = rec.lastResult === "miss";
  const belowStrike = pct < 50;
  const warn = missedLast || belowStrike;
  const cls = warn
    ? "text-accent-loss"
    : pct >= 70
      ? "text-accent-win"
      : "text-accent-pending";

  return (
    <span
      className={`ml-auto shrink-0 tabular-nums text-[10px] font-medium ${cls}`}
      title={`${rec.hits}/${rec.bets} (${pct}%) all stats · last ${rec.lastStat}: ${
        missedLast ? "miss ✗" : "hit ✓"
      }`}
    >
      {rec.hits}/{rec.bets} {pct}%{warn ? " ✗" : ""}
    </span>
  );
}

function PlayerRow({
  player,
  playerHistory,
  editable,
  busy,
  onToggleEmergency,
}: {
  player: RoundLineupPlayer;
  playerHistory: Record<string, PlayerHistorySummary>;
  editable?: boolean;
  busy?: boolean;
  onToggleEmergency?: (player: RoundLineupPlayer) => void;
}) {
  const c = teamColors(player.team);
  const surname = player.name.split(" ").slice(-1)[0];
  const isEmg = player.lineupStatus === "emergency";
  const isInt = player.lineupStatus === "interchange";

  return (
    <li
      className={`flex min-w-0 items-center gap-1 text-[11px] ${
        isEmg ? "text-slate-500 line-through decoration-slate-600" : "text-slate-300"
      }`}
    >
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold"
        style={{ background: c.bg, color: c.fg }}
      >
        {player.jumper ?? "–"}
      </span>
      <span className="min-w-0 truncate" title={player.name}>
        {surname}
      </span>
      {isEmg ? (
        <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] font-semibold uppercase text-amber-400">
          emg
        </span>
      ) : null}
      {isInt ? (
        <span className="shrink-0 text-[9px] uppercase text-slate-600">int</span>
      ) : null}
      <PlayerHistoryBadge name={player.name} history={playerHistory} />
      {editable && onToggleEmergency ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onToggleEmergency(player)}
          className="ml-auto shrink-0 rounded border border-surface-border px-1 py-0.5 text-[9px] text-slate-500 hover:border-amber-500/50 hover:text-amber-400 disabled:opacity-40"
          title={
            isEmg
              ? "Mark as named (in the 22/23)"
              : "Mark as emergency (exclude from System book)"
          }
        >
          {isEmg ? "Un-EMG" : "EMG"}
        </button>
      ) : null}
    </li>
  );
}

function TeamColumn({
  team,
  rows,
  playerHistory,
  editable,
  busy,
  onToggleEmergency,
}: {
  team: string;
  rows: RoundLineupPlayer[];
  playerHistory: Record<string, PlayerHistorySummary>;
  editable?: boolean;
  busy?: boolean;
  onToggleEmergency?: (player: RoundLineupPlayer) => void;
}) {
  const c = teamColors(team);
  return (
    <div>
      <div
        className="mb-1 text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: c.fg }}
      >
        {team}
      </div>
      <ul className="space-y-0.5">
        {rows.map((p) => (
          <PlayerRow
            key={p.name}
            player={p}
            playerHistory={playerHistory}
            editable={editable}
            busy={busy}
            onToggleEmergency={onToggleEmergency}
          />
        ))}
      </ul>
    </div>
  );
}

export function GameLineupPanel({
  gameId,
  home,
  away,
  phase,
  players: initialPlayers,
  round,
  playerHistory = {},
}: {
  gameId: number;
  home: string;
  away: string;
  phase: RoundLineupPlayer["phase"];
  players: RoundLineupPlayer[];
  round: number | null;
  playerHistory?: Record<string, PlayerHistorySummary>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [players, setPlayers] = useState(initialPlayers);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPlayers(initialPlayers);
  }, [initialPlayers]);

  if (players.length === 0) {
    return (
      <details className="rounded-lg border border-surface-border/60 bg-surface/20 px-3 py-2 text-sm text-slate-400">
        <summary className="cursor-pointer list-none font-medium text-slate-300">
          Lineup — not uploaded
        </summary>
        <p className="mt-2 text-xs">
          Upload the team sheet on{" "}
          <Link href="/" className="text-accent hover:underline">
            Fixtures
          </Link>{" "}
          before generating predictions.
        </p>
      </details>
    );
  }

  const active = players.filter((p) => p.lineupStatus !== "emergency");
  const emergencies = players.filter((p) => p.lineupStatus === "emergency");
  const homePlayers = active.filter((p) => p.team === home);
  const awayPlayers = active.filter((p) => p.team === away);

  async function toggleEmergency(player: RoundLineupPlayer) {
    const next =
      player.lineupStatus === "emergency" ? "named" : "emergency";
    setBusyName(player.name);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/lineup`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName: player.name,
          team: player.team,
          status: next,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        predictionsCleared?: number;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Failed (${res.status})`);
      }
      setPlayers((prev) =>
        prev.map((p) =>
          normalisePlayerName(p.name) === normalisePlayerName(player.name) &&
          p.team === player.team
            ? { ...p, lineupStatus: next }
            : p,
        ),
      );
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyName(null);
    }
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-lg border border-surface-border/60 bg-surface/20 px-3 py-2"
    >
      <summary className="cursor-pointer list-none text-sm font-medium text-slate-200">
        Lineup ({active.length} selected
        {emergencies.length > 0 ? ` · ${emergencies.length} emg` : ""}) ·{" "}
        <PhaseBadge phase={phase} />
        {round != null ? (
          <span className="ml-1 text-xs font-normal text-slate-500">Round {round}</span>
        ) : null}
      </summary>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <TeamColumn
          team={home}
          rows={homePlayers}
          playerHistory={playerHistory}
          editable
          busy={busyName != null}
          onToggleEmergency={(p) => void toggleEmergency(p)}
        />
        <TeamColumn
          team={away}
          rows={awayPlayers}
          playerHistory={playerHistory}
          editable
          busy={busyName != null}
          onToggleEmergency={(p) => void toggleEmergency(p)}
        />
      </div>
      {emergencies.length > 0 ? (
        <div className="mt-3 border-t border-surface-border/40 pt-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-500/80">
            Emergencies (excluded from System book)
          </div>
          <ul className="space-y-0.5">
            {emergencies.map((p) => (
              <PlayerRow
                key={`emg-${p.name}`}
                player={p}
                playerHistory={playerHistory}
                editable
                busy={busyName != null}
                onToggleEmergency={(row) => void toggleEmergency(row)}
              />
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-2 text-[10px] text-slate-600">
        If Claude mis-tags an emergency: tap{" "}
        <span className="text-slate-400">EMG</span> (they move to the amber
        list below) → then System book{" "}
        <span className="text-slate-400">Refresh portfolio</span>. That also
        clears their predictions so they can&apos;t reappear.
      </p>
      {error ? <p className="mt-1 text-[10px] text-accent-loss">{error}</p> : null}
    </details>
  );
}
