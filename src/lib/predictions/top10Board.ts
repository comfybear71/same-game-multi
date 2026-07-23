/**
 * Top 10 punter boards — per team × market shortlists with sensible default lines.
 *
 * Line pick is deliberately NOT "highest clearable rung" (see suggest.chooseRung).
 * Default rung sits near season average / main bookie ladder; clearProbability
 * is display-only, never used to pick the rung.
 */

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { canonicalTeam } from "@/lib/afl/teams";
import {
  bookmakerLines,
  games,
  players,
  playerGameFeatures,
  predictions,
  type StatType,
} from "@/db/schema";
import { getPlayerBettingRecord, playerRecordKey } from "@/lib/data/bets";
import {
  bandRank,
  type BenchmarkBand,
  getGameBenchmarkBands,
} from "@/lib/data/leaders";
import { lineTarget } from "@/lib/format";
import { getEmergencyMatcher } from "@/lib/ingest/lineup";
import { getPlayerNews, type InjuryNews } from "@/lib/ingest/injuries";
import { pickPrice, loadOddsSnapshotPrices, loadBookmakerLinePrices } from "@/lib/system/oddsPrices";
import { STAT_TYPES } from "./features";
import { rungsFor } from "./modelLine";
import { capGoalsLine } from "./suggest";

export const TOP10_LIMIT = 10;

export type Top10Row = {
  rank: number;
  playerId: number;
  playerName: string;
  jumper: number | null;
  team: string;
  statType: StatType;
  line: number;
  odds: number | null;
  prediction: number;
  seasonAvg: number | null;
  lastGame: number | null;
  recentForm: number[];
  fantasyAvg: number | null;
  benchmark: BenchmarkBand | "unknown";
  reason: string;
  availableRungs: number[];
  history: { hits: number; bets: number } | null;
  news: InjuryNews | null;
};

export type Top10TeamBoard = {
  team: string;
  rows: Top10Row[];
};

export type Top10MarketBoard = {
  statType: StatType;
  home: Top10TeamBoard;
  away: Top10TeamBoard;
};

export type Top10BoardResponse = {
  gameId: number;
  home: string;
  away: string;
  markets: Top10MarketBoard[];
  oddsSource: "snapshots" | "bookmaker_lines" | "none";
};

type RawPlayerStat = {
  playerId: number;
  playerName: string;
  jumper: number | null;
  team: string;
  statType: StatType;
  prediction: number;
  seasonAvg: number | null;
  recentForm: number[];
  fantasyAvg: number | null;
  benchmark: BenchmarkBand | "unknown";
  history: { hits: number; bets: number } | null;
  news: InjuryNews | null;
  rungs: number[];
};

/**
 * Default board line: near season avg / middle of the ladder — never the top rung.
 * Exported for unit tests.
 */
export function pickBoardLine(
  rungs: number[],
  prediction: number,
  statType: StatType,
  seasonAvg: number | null,
): number | null {
  const ladder = rungs.length > 0 ? [...new Set(rungs)].sort((a, b) => a - b) : rungsFor(statType);
  if (ladder.length === 0) return null;

  const anchor =
    seasonAvg != null && Number.isFinite(seasonAvg) && seasonAvg > 0
      ? seasonAvg
      : Math.floor(prediction);

  const clearable = ladder.filter((r) => prediction > r);
  let pool = clearable.length > 0 ? clearable : ladder;

  // Never default to the highest offered rung (stops 30+ on ~20 disposal avg).
  const topRung = ladder[ladder.length - 1]!;
  if (pool.length > 1 && pool[pool.length - 1] === topRung) {
    pool = pool.slice(0, -1);
  }

  let best = pool[0]!;
  let bestDist = Math.abs(lineTarget(best) - anchor);
  for (const r of pool.slice(1)) {
    const dist = Math.abs(lineTarget(r) - anchor);
    if (dist < bestDist || (dist === bestDist && r < best)) {
      bestDist = dist;
      best = r;
    }
  }

  if (statType === "goals") return capGoalsLine(best, seasonAvg);
  return best;
}

/** Rank score for Top 10 ordering — season/form led, not clearProbability. */
export function rankTop10Score(row: {
  seasonAvg: number | null;
  prediction: number;
  recentForm: number[];
  fantasyAvg: number | null;
  benchmark: BenchmarkBand | "unknown";
}): number {
  const avg = row.seasonAvg ?? row.prediction;
  const formSlice = row.recentForm.slice(0, 5);
  const formMean =
    formSlice.length > 0
      ? formSlice.reduce((a, b) => a + b, 0) / formSlice.length
      : avg;
  const bandPts =
    row.benchmark === "elite"
      ? 8
      : row.benchmark === "above"
        ? 4
        : row.benchmark === "average"
          ? 0
          : row.benchmark === "below"
            ? -4
            : 0;
  const fantasy = row.fantasyAvg ?? 0;
  return avg * 2 + formMean * 0.5 + fantasy * 0.02 + bandPts;
}

const BAND_LABEL: Record<BenchmarkBand, string> = {
  elite: "Elite",
  above: "Above avg",
  average: "Average",
  below: "Below avg",
};

/** Plain-English one-liner for the punter board row. */
export function buildTop10Reason(row: {
  benchmark: BenchmarkBand | "unknown";
  seasonAvg: number | null;
  lastGame: number | null;
  statType: StatType;
  history: { hits: number; bets: number } | null;
}): string {
  const parts: string[] = [];
  if (row.benchmark !== "unknown") parts.push(BAND_LABEL[row.benchmark]);
  if (row.seasonAvg != null) parts.push(`avg ${Math.round(row.seasonAvg * 10) / 10}`);
  if (row.lastGame != null) parts.push(`last ${row.lastGame}`);
  if (row.history && row.history.bets > 0) {
    parts.push(`you ${row.history.hits}/${row.history.bets}`);
  }
  if (parts.length === 0) return `Top ${row.statType} projection`;
  return parts.join(" · ");
}

function sortTop10(a: RawPlayerStat, b: RawPlayerStat): number {
  const scoreDiff = rankTop10Score(b) - rankTop10Score(a);
  if (scoreDiff !== 0) return scoreDiff;
  return (
    bandRank(a.benchmark) - bandRank(b.benchmark) ||
    (b.seasonAvg ?? b.prediction) - (a.seasonAvg ?? a.prediction)
  );
}

function toTop10Row(
  raw: RawPlayerStat,
  rank: number,
  prices: Map<string, number>,
): Top10Row {
  const line = pickBoardLine(raw.rungs, raw.prediction, raw.statType, raw.seasonAvg)!;
  const odds = pickPrice(prices, raw.playerId, raw.statType, line);
  const lastGame = raw.recentForm[0] ?? null;
  return {
    rank,
    playerId: raw.playerId,
    playerName: raw.playerName,
    jumper: raw.jumper,
    team: raw.team,
    statType: raw.statType,
    line,
    odds: odds != null ? Math.round(odds * 100) / 100 : null,
    prediction: raw.prediction,
    seasonAvg: raw.seasonAvg,
    lastGame,
    recentForm: raw.recentForm,
    fantasyAvg: raw.fantasyAvg,
    benchmark: raw.benchmark,
    reason: buildTop10Reason({
      benchmark: raw.benchmark,
      seasonAvg: raw.seasonAvg,
      lastGame,
      statType: raw.statType,
      history: raw.history,
    }),
    availableRungs:
      raw.rungs.length > 0
        ? [...new Set(raw.rungs)].sort((a, b) => a - b)
        : rungsFor(raw.statType),
    history: raw.history,
    news: raw.news,
  };
}

export async function buildTop10Board(
  gameId: number,
  userId: number | null,
): Promise<Top10BoardResponse> {
  const [game] = await db
    .select({ home: games.home, away: games.away })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);

  if (!game) {
    return {
      gameId,
      home: "",
      away: "",
      markets: [],
      oddsSource: "none",
    };
  }

  const homeC = canonicalTeam(game.home) ?? game.home;
  const awayC = canonicalTeam(game.away) ?? game.away;

  const emergencies = await getEmergencyMatcher(gameId);
  const historyByKey =
    userId != null ? (await getPlayerBettingRecord(userId)).byKey : {};

  const preds = await db
    .select({
      playerId: predictions.playerId,
      name: players.name,
      jumper: players.jumper,
      team: players.team,
      recentFantasyAvg: players.recentFantasyAvg,
      statType: predictions.statType,
      value: predictions.predictedValue,
    })
    .from(predictions)
    .innerJoin(players, eq(predictions.playerId, players.id))
    .where(and(eq(predictions.gameId, gameId), eq(predictions.model, "C")));

  const activePreds = preds.filter(
    (p) =>
      !emergencies.matches({
        name: p.name,
        team: p.team,
        jumper: p.jumper,
      }),
  );

  const roster = [
    ...new Map(
      activePreds.map((p) => [p.playerId, { id: p.playerId, name: p.name, team: p.team }]),
    ).values(),
  ];

  const [lines, feats, newsByPlayer, { bands }, snapPrices, bookPrices] =
    await Promise.all([
      db.select().from(bookmakerLines).where(eq(bookmakerLines.gameId, gameId)),
      db
        .select()
        .from(playerGameFeatures)
        .where(eq(playerGameFeatures.gameId, gameId)),
      getPlayerNews(roster),
      getGameBenchmarkBands(gameId),
      loadOddsSnapshotPrices(gameId).catch(() => new Map<string, number>()),
      loadBookmakerLinePrices(gameId).catch(() => new Map<string, number>()),
    ]);

  const oddsSource: Top10BoardResponse["oddsSource"] =
    snapPrices.size > 0 ? "snapshots" : bookPrices.size > 0 ? "bookmaker_lines" : "none";
  const prices = snapPrices.size > 0 ? snapPrices : bookPrices;

  const rungsByKey = new Map<string, number[]>();
  for (const l of lines) {
    if (l.playerId == null) continue;
    const k = `${l.playerId}:${l.statType}`;
    const arr = rungsByKey.get(k) ?? [];
    arr.push(l.line);
    rungsByKey.set(k, arr);
  }

  const formByKey = new Map<string, number[]>();
  const seasonAvgByKey = new Map<string, number | null>();
  for (const f of feats) {
    formByKey.set(`${f.playerId}:${f.statType}`, f.recentForm ?? []);
    seasonAvgByKey.set(`${f.playerId}:${f.statType}`, f.seasonAverage ?? null);
  }

  const rawByStatTeam = new Map<string, RawPlayerStat[]>();
  for (const p of activePreds) {
    if (!STAT_TYPES.includes(p.statType)) continue;
    const news = newsByPlayer.get(p.playerId) ?? null;
    if (news?.status === "out") continue;

    const key = `${p.playerId}:${p.statType}`;
    const team = canonicalTeam(p.team) ?? p.team;
    const raw: RawPlayerStat = {
      playerId: p.playerId,
      playerName: p.name,
      jumper: p.jumper,
      team,
      statType: p.statType,
      prediction: p.value,
      seasonAvg: seasonAvgByKey.get(key) ?? null,
      recentForm: formByKey.get(key) ?? [],
      fantasyAvg: p.recentFantasyAvg,
      benchmark: bands.get(key) ?? "unknown",
      history: historyByKey[playerRecordKey(p.name, p.statType)] ?? null,
      news,
      rungs: rungsByKey.get(key) ?? [],
    };

    const teamKey = `${p.statType}:${team}`;
    const list = rawByStatTeam.get(teamKey) ?? [];
    list.push(raw);
    rawByStatTeam.set(teamKey, list);
  }

  const markets: Top10MarketBoard[] = STAT_TYPES.map((statType) => {
    const homeRaw = (rawByStatTeam.get(`${statType}:${homeC}`) ?? []).sort(sortTop10);
    const awayRaw = (rawByStatTeam.get(`${statType}:${awayC}`) ?? []).sort(sortTop10);

    return {
      statType,
      home: {
        team: homeC,
        rows: homeRaw.slice(0, TOP10_LIMIT).map((r, i) => toTop10Row(r, i + 1, prices)),
      },
      away: {
        team: awayC,
        rows: awayRaw.slice(0, TOP10_LIMIT).map((r, i) => toTop10Row(r, i + 1, prices)),
      },
    };
  });

  return {
    gameId,
    home: homeC,
    away: awayC,
    markets,
    oddsSource,
  };
}

/** playerId:statType → Top 10 rank (1–10) within that club×market board. */
export async function top10RankMap(
  gameId: number,
): Promise<Map<string, { rank: number; team: string; line: number; seasonAvg: number | null }>> {
  const board = await buildTop10Board(gameId, null);
  const map = new Map<
    string,
    { rank: number; team: string; line: number; seasonAvg: number | null }
  >();
  for (const m of board.markets) {
    for (const side of [m.home, m.away]) {
      for (const row of side.rows) {
        map.set(`${row.playerId}:${row.statType}`, {
          rank: row.rank,
          team: row.team,
          line: row.line,
          seasonAvg: row.seasonAvg,
        });
      }
    }
  }
  return map;
}

/** Set of playerId:statType keys on any Top 10 board for this game. */
export async function top10KeySet(gameId: number): Promise<Set<string>> {
  const map = await top10RankMap(gameId);
  return new Set(map.keys());
}
