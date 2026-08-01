"use client";

import { useState } from "react";

import { GameLineupPanel } from "@/components/RoundRosterPanel";
import { LineupReviewPanel } from "@/components/LineupReviewPanel";
import { LineupUploadButton } from "@/components/LineupUploadButton";
import type { PlayerHistorySummary } from "@/lib/data/bets";
import type { RoundLineupPlayer } from "@/lib/data/roundRoster";

export function GameLineupSection({
  gameId,
  home,
  away,
  phase,
  players,
  round,
  playerHistory,
  lineupCount,
}: {
  gameId: number;
  home: string;
  away: string;
  phase: RoundLineupPlayer["phase"];
  players: RoundLineupPlayer[];
  round: number | null;
  playerHistory: Record<string, PlayerHistorySummary>;
  lineupCount: number;
}) {
  const [reviewKey, setReviewKey] = useState(0);
  const canReplace = phase === "upcoming";
  /** Approve unlocks MC stat matching — allow during live if you forgot pre-bounce. */
  const canApprove = phase !== "played";

  return (
    <div className="space-y-4">
      {canReplace ? (
        <div className="max-w-md">
          <LineupUploadButton
            gameId={gameId}
            initialCount={lineupCount}
            onUploaded={() => setReviewKey((k) => k + 1)}
          />
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          {canApprove
            ? "Game live — re-upload disabled, but you can still Approve lineup below to unlock Match Centre stats on your bets."
            : "Game complete — lineup re-upload and approval are closed."}
        </p>
      )}
      <LineupReviewPanel
        gameId={gameId}
        refreshKey={reviewKey}
        canApprove={canApprove}
      />
      <GameLineupPanel
        gameId={gameId}
        home={home}
        away={away}
        phase={phase}
        players={players}
        round={round}
        playerHistory={playerHistory}
        embedded
      />
    </div>
  );
}
