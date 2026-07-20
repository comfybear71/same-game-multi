import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  games,
  oddsSnapshots,
  playerGameStats,
  players,
  systemTicketLegs,
  systemTickets,
  type StatType,
} from "@/db/schema";
import { targetLabel } from "@/lib/format";
import { rungsFor } from "@/lib/predictions/modelLine";
import { loadOddsSnapshotPrices } from "@/lib/system/oddsPrices";

const STATS: StatType[] = ["disposals", "marks", "tackles", "goals"];
/** ANY crystal-ball ticket sizes. */
export const CRYSTAL_LEG_COUNTS = [5, 10, 15] as const;
export type CrystalLegCount = (typeof CRYSTAL_LEG_COUNTS)[number];
export type OddsMode = "longest" | "shortest";

export const CRYSTAL_BALL_STAKE = 5;

export type CrystalBallLeg = {
  playerId: number;
  playerName: string;
  team: string | null;
  statType: StatType;
  line: number;
  actual: number;
  odds: number;
  source: "book" | "estimate";
  /** Player appeared on any System book ticket for this game. */
  inOurMulti: boolean;
};

export type CrystalBallMulti = {
  legCount: CrystalLegCount;
  combinedOdds: number;
  stake: number;
  returnIfHit: number;
  pnl: number;
  roiPct: number;
  priced: "book" | "mixed" | "estimate";
  legs: CrystalBallLeg[];
  /** False when not enough cleared players for this size. */
  available: boolean;
};

export type CrystalBallGame = {
  gameId: number;
  home: string;
  away: string;
  commenceTime: Date;
  ourPlayerCount: number;
  modes: Record<OddsMode, Record<CrystalLegCount, CrystalBallMulti>>;
};

export type CrystalBallReport = {
  season: number;
  round: number;
  gamesWithOdds: number;
  gamesComplete: number;
  gamesInReport: number;
  stakeEach: number;
  games: CrystalBallGame[];
  note: string;
};

type RawLeg = Omit<CrystalBallLeg, "inOurMulti"> & {
  gameId: number;
};

function actualOf(
  row: {
    disposals: number | null;
    marks: number | null;
    tackles: number | null;
    goals: number | null;
  },
  stat: StatType,
): number | null {
  return row[stat];
}

/** Estimate odds — wider band so longest/shortest both have range. */
function estimateOdds(
  stat: StatType,
  line: number,
  actual: number,
  mode: OddsMode,
): number {
  const need = Math.floor(line) + 1;
  const margin = actual - need;
  let base =
    stat === "goals" ? 2.2 : stat === "disposals" ? 1.75 : 1.95;
  if (margin <= 0) base += 0.35;
  else if (margin === 1) base += 0.12;
  else if (margin >= 5) base -= 0.4;
  else if (margin >= 3) base -= 0.25;
  else if (margin >= 2) base -= 0.12;

  if (mode === "longest") {
    // Prefer steeper rungs → slightly longer estimate.
    base += Math.min(1.2, (need / (stat === "disposals" ? 40 : 8)) * 0.8);
    return Math.round(Math.min(4.5, Math.max(1.4, base)) * 100) / 100;
  }
  return Math.round(Math.min(2.1, Math.max(1.25, base)) * 100) / 100;
}

function productOdds(legs: { odds: number }[]): number {
  return legs.reduce((p, l) => p * l.odds, 1);
}

function pricedOf(legs: { source: string }[]): CrystalBallMulti["priced"] {
  const bookN = legs.filter((l) => l.source === "book").length;
  if (bookN === legs.length) return "book";
  if (bookN === 0) return "estimate";
  return "mixed";
}

function toMulti(
  legs: CrystalBallLeg[],
  legCount: CrystalLegCount,
  available: boolean,
): CrystalBallMulti {
  if (!available || legs.length < legCount) {
    return {
      legCount,
      combinedOdds: 0,
      stake: CRYSTAL_BALL_STAKE,
      returnIfHit: 0,
      pnl: 0,
      roiPct: 0,
      priced: "estimate",
      legs: [],
      available: false,
    };
  }
  const slice = legs.slice(0, legCount);
  const combinedOdds = Math.round(productOdds(slice) * 100) / 100;
  const stake = CRYSTAL_BALL_STAKE;
  const returnIfHit = Math.round(stake * combinedOdds * 100) / 100;
  const pnl = Math.round((returnIfHit - stake) * 100) / 100;
  return {
    legCount,
    combinedOdds,
    stake,
    returnIfHit,
    pnl,
    roiPct: Math.round((pnl / stake) * 1000) / 10,
    priced: pricedOf(slice),
    legs: slice,
    available: true,
  };
}

/** Latest round with at least one completed fixture. */
export async function latestCompletedRound(
  season: number,
): Promise<number | null> {
  const [row] = await db
    .select({ round: games.round })
    .from(games)
    .where(and(eq(games.season, season), eq(games.status, "complete")))
    .orderBy(desc(games.round))
    .limit(1);
  return row?.round ?? null;
}

/** Players (and player×stat) that appeared on our System book for these games. */
async function loadOurSystemPlayers(gameIds: number[]): Promise<{
  byGame: Map<number, Set<number>>;
  byGameStat: Map<number, Set<string>>;
}> {
  const byGame = new Map<number, Set<number>>();
  const byGameStat = new Map<number, Set<string>>();
  if (gameIds.length === 0) return { byGame, byGameStat };

  const rows = await db
    .select({
      gameId: systemTickets.gameId,
      playerId: systemTicketLegs.playerId,
      playerName: systemTicketLegs.playerName,
      statType: systemTicketLegs.statType,
    })
    .from(systemTicketLegs)
    .innerJoin(systemTickets, eq(systemTickets.id, systemTicketLegs.ticketId))
    .where(inArray(systemTickets.gameId, gameIds));

  for (const r of rows) {
    let ids = byGame.get(r.gameId);
    if (!ids) {
      ids = new Set();
      byGame.set(r.gameId, ids);
    }
    let keys = byGameStat.get(r.gameId);
    if (!keys) {
      keys = new Set();
      byGameStat.set(r.gameId, keys);
    }
    if (r.playerId != null) {
      ids.add(r.playerId);
      keys.add(`${r.playerId}:${r.statType}`);
    }
  }
  return { byGame, byGameStat };
}

/**
 * Build cleared-leg candidates for a player across all markets.
 */
function clearedLegsForPlayer(
  row: {
    playerId: number;
    playerName: string;
    team: string | null;
    disposals: number | null;
    marks: number | null;
    tackles: number | null;
    goals: number | null;
  },
  prices: Map<string, number>,
  fix: { id: number; home: string; away: string },
  useEstimates: boolean,
  mode: OddsMode,
): RawLeg[] {
  const out: RawLeg[] = [];
  for (const stat of STATS) {
    const actual = actualOf(row, stat);
    if (actual == null) continue;

    const prefix = `${row.playerId}:${stat}:`;
    let sawBook = false;
    for (const [key, odds] of prices) {
      if (!key.startsWith(prefix) || odds <= 1) continue;
      const line = Number(key.slice(prefix.length));
      if (!Number.isFinite(line) || !(actual > line)) continue;
      sawBook = true;
      out.push({
        gameId: fix.id,
        playerId: row.playerId,
        playerName: row.playerName,
        team: row.team,
        statType: stat,
        line,
        actual,
        odds,
        source: "book",
      });
    }

    if (!sawBook || useEstimates) {
      for (const line of rungsFor(stat)) {
        if (!(actual > line)) continue;
        if (out.some((c) => c.statType === stat && c.line === line && c.source === "book")) {
          continue;
        }
        out.push({
          gameId: fix.id,
          playerId: row.playerId,
          playerName: row.playerName,
          team: row.team,
          statType: stat,
          line,
          actual,
          odds: estimateOdds(stat, line, actual, mode),
          source: "estimate",
        });
      }
    }
  }
  return out;
}

/** One best cleared market per player for this mode. */
function playerPoolForMode(
  allCleared: RawLeg[],
  mode: OddsMode,
): RawLeg[] {
  const byPlayer = new Map<number, RawLeg[]>();
  for (const leg of allCleared) {
    const list = byPlayer.get(leg.playerId) ?? [];
    list.push(leg);
    byPlayer.set(leg.playerId, list);
  }

  const pool: RawLeg[] = [];
  for (const [, legs] of byPlayer) {
    const sorted = [...legs].sort((a, b) =>
      mode === "longest"
        ? b.odds - a.odds || b.line - a.line
        : a.odds - b.odds || a.line - b.line,
    );
    const pick = sorted[0];
    if (pick) pool.push(pick);
  }
  return pool;
}

function pickAnyMulti(
  pool: RawLeg[],
  n: CrystalLegCount,
  mode: OddsMode,
  ourPlayers: Set<number>,
  ourStats: Set<string>,
): CrystalBallMulti {
  if (pool.length < n) {
    return toMulti([], n, false);
  }
  const ranked = [...pool].sort((a, b) =>
    mode === "longest"
      ? b.odds - a.odds ||
        (ourPlayers.has(b.playerId) ? 0 : 1) -
          (ourPlayers.has(a.playerId) ? 0 : 1)
      : a.odds - b.odds ||
        (ourPlayers.has(b.playerId) ? 0 : 1) -
          (ourPlayers.has(a.playerId) ? 0 : 1),
  );
  const legs: CrystalBallLeg[] = ranked.slice(0, n).map((l) => ({
    playerId: l.playerId,
    playerName: l.playerName,
    team: l.team,
    statType: l.statType,
    line: l.line,
    actual: l.actual,
    odds: l.odds,
    source: l.source,
    inOurMulti:
      ourPlayers.has(l.playerId) ||
      ourStats.has(`${l.playerId}:${l.statType}`),
  }));
  return toMulti(legs, n, true);
}

/**
 * Crystal ball: every completed game → ANY 5 / 10 / 15 leg multis,
 * longest + shortest odds variants. Flags players from our System book.
 */
export async function buildCrystalBallReport(
  season: number,
  round: number,
): Promise<CrystalBallReport> {
  const fixtures = await db
    .select({
      id: games.id,
      home: games.home,
      away: games.away,
      commenceTime: games.commenceTime,
    })
    .from(games)
    .where(
      and(
        eq(games.season, season),
        eq(games.round, round),
        eq(games.status, "complete"),
      ),
    )
    .orderBy(asc(games.commenceTime));

  const gamesComplete = fixtures.length;
  const emptyModes = (): CrystalBallGame["modes"] => {
    const blank = (n: CrystalLegCount) => toMulti([], n, false);
    return {
      longest: { 5: blank(5), 10: blank(10), 15: blank(15) },
      shortest: { 5: blank(5), 10: blank(10), 15: blank(15) },
    };
  };

  if (gamesComplete === 0) {
    return {
      season,
      round,
      gamesWithOdds: 0,
      gamesComplete: 0,
      gamesInReport: 0,
      stakeEach: CRYSTAL_BALL_STAKE,
      games: [],
      note: "No completed games in this round yet.",
    };
  }

  const gameIds = fixtures.map((g) => g.id);

  const [oddsCoverage, ourMaps] = await Promise.all([
    db
      .select({
        gameId: oddsSnapshots.gameId,
        n: sql<number>`count(*)::int`,
      })
      .from(oddsSnapshots)
      .where(
        and(
          inArray(oddsSnapshots.gameId, gameIds),
          isNotNull(oddsSnapshots.playerId),
        ),
      )
      .groupBy(oddsSnapshots.gameId),
    loadOurSystemPlayers(gameIds),
  ]);

  const gamesWithOdds = oddsCoverage.filter((r) => (r.n ?? 0) > 0).length;
  const bookGameIds = new Set(
    oddsCoverage.filter((r) => (r.n ?? 0) > 0).map((r) => r.gameId!),
  );

  const reportGames: CrystalBallGame[] = [];

  for (const fix of fixtures) {
    const gameId = fix.id;
    const [stats, prices] = await Promise.all([
      db
        .select({
          playerId: playerGameStats.playerId,
          playerName: players.name,
          team: players.team,
          disposals: playerGameStats.disposals,
          marks: playerGameStats.marks,
          tackles: playerGameStats.tackles,
          goals: playerGameStats.goals,
        })
        .from(playerGameStats)
        .innerJoin(players, eq(players.id, playerGameStats.playerId))
        .where(
          and(
            eq(playerGameStats.gameId, gameId),
            eq(playerGameStats.settled, true),
            eq(playerGameStats.didPlay, true),
          ),
        ),
      loadOddsSnapshotPrices(gameId),
    ]);

    const ourPlayers = ourMaps.byGame.get(gameId) ?? new Set();
    const ourStats = ourMaps.byGameStat.get(gameId) ?? new Set();
    const useEstimates = !bookGameIds.has(gameId);

    if (stats.length === 0) {
      reportGames.push({
        gameId,
        home: fix.home,
        away: fix.away,
        commenceTime: fix.commenceTime,
        ourPlayerCount: ourPlayers.size,
        modes: emptyModes(),
      });
      continue;
    }

    const modes = emptyModes();
    for (const mode of ["longest", "shortest"] as const) {
      const allCleared: RawLeg[] = [];
      for (const row of stats) {
        allCleared.push(
          ...clearedLegsForPlayer(row, prices, fix, useEstimates, mode),
        );
      }
      const pool = playerPoolForMode(allCleared, mode);
      for (const n of CRYSTAL_LEG_COUNTS) {
        modes[mode][n] = pickAnyMulti(pool, n, mode, ourPlayers, ourStats);
      }
    }

    reportGames.push({
      gameId,
      home: fix.home,
      away: fix.away,
      commenceTime: fix.commenceTime,
      ourPlayerCount: ourPlayers.size,
      modes,
    });
  }

  const gamesInReport = reportGames.filter((g) =>
    CRYSTAL_LEG_COUNTS.some((n) => g.modes.longest[n].available),
  ).length;

  let note = `Each game: ANY 5 / 10 / 15 leg crystal-ball multis. Toggle longest vs shortest odds. ★ = player was on our System book. $${CRYSTAL_BALL_STAKE} flat stake.`;
  if (gamesWithOdds < gamesComplete) {
    note += ` Book odds: ${gamesWithOdds}/${gamesComplete} games (rest estimated).`;
  }

  return {
    season,
    round,
    gamesWithOdds,
    gamesComplete,
    gamesInReport,
    stakeEach: CRYSTAL_BALL_STAKE,
    games: reportGames,
    note,
  };
}

/** Portfolio totals for the selected odds mode — all 5 / 10 / 15 tickets per game. */
export function crystalBallPortfolio(
  report: CrystalBallReport,
  mode: OddsMode,
): {
  tickets: number;
  totalStaked: number;
  totalReturned: number;
  netProfit: number;
  roiPct: number;
} {
  const multis = report.games.flatMap((g) =>
    CRYSTAL_LEG_COUNTS.map((n) => g.modes[mode][n]).filter((m) => m.available),
  );
  const totalStaked = multis.length * CRYSTAL_BALL_STAKE;
  const totalReturned = multis.reduce((s, m) => s + m.returnIfHit, 0);
  const netProfit = totalReturned - totalStaked;
  return {
    tickets: multis.length,
    totalStaked,
    totalReturned: Math.round(totalReturned * 100) / 100,
    netProfit: Math.round(netProfit * 100) / 100,
    roiPct:
      totalStaked > 0 ? Math.round((netProfit / totalStaked) * 1000) / 10 : 0,
  };
}

export function formatCrystalLeg(leg: CrystalBallLeg): string {
  const market = `${leg.statType.charAt(0).toUpperCase()}${leg.statType.slice(1)} ${targetLabel(leg.line)}`;
  const src = leg.source === "book" ? "" : " ~est";
  const star = leg.inOurMulti ? " ★" : "";
  return `${leg.playerName}${star} · ${market} (got ${leg.actual} @ ${leg.odds.toFixed(2)}${src})`;
}
