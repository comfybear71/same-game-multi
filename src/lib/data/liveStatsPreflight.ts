/**
 * Pre-bounce checks so live MC matching is unlikely to need mid-game fixes.
 */

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { games, lineupPlayers } from "@/db/schema";
import { resolveAflMatchIdForGame } from "@/lib/ingest/aflMatchForGame";
import { getAflMediaToken } from "@/lib/ingest/aflMatchCentre";
import { isLineupApproved } from "@/lib/ingest/lineupReview";

export type LiveStatsPreflight = {
  ready: boolean;
  lineupApproved: boolean;
  aflMatchId: string | null;
  aflTokenOk: boolean;
  squadNamed: number;
  hints: string[];
};

export async function preflightLiveStats(gameId: number): Promise<LiveStatsPreflight> {
  const hints: string[] = [];
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) {
    return {
      ready: false,
      lineupApproved: false,
      aflMatchId: null,
      aflTokenOk: false,
      squadNamed: 0,
      hints: ["Game not found in database."],
    };
  }

  const lineupApproved = await isLineupApproved(gameId);
  if (!lineupApproved) {
    hints.push("Approve the squad on the lineup panel — MC only matches approved names.");
  }

  const squadRows = await db
    .select({ id: lineupPlayers.id })
    .from(lineupPlayers)
    .where(
      and(
        eq(lineupPlayers.gameId, gameId),
        inArray(lineupPlayers.status, ["named", "interchange"]),
      ),
    );
  const squadNamed = squadRows.length;
  if (squadNamed < 40) {
    hints.push(`Lineup has ${squadNamed} named/interchange rows — expect ~44; re-paste if wrong.`);
  }

  const token = await getAflMediaToken();
  const aflTokenOk = token != null;
  if (!aflTokenOk) {
    hints.push("AFL Match Centre token failed — cron will retry; check network from Vercel.");
  }

  const aflMatchId = await resolveAflMatchIdForGame(game);
  if (!aflMatchId) {
    hints.push("Could not resolve AFL fixture id (CD_M…) — check round/teams on fixture.");
  }

  if (lineupApproved && aflTokenOk && aflMatchId && squadNamed >= 40) {
    hints.push("Pre-bounce OK — MC counts appear after bounce (not before).");
  }

  const ready =
    lineupApproved && aflTokenOk && aflMatchId != null && squadNamed >= 40;

  return {
    ready,
    lineupApproved,
    aflMatchId,
    aflTokenOk,
    squadNamed,
    hints,
  };
}
