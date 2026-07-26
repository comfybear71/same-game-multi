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
  lineupPlayers,
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
import { resolveLineupPlayerIds } from "@/lib/ingest/lineupPlayerResolve";
import { buildLineupCompletenessReport, type LineupCompletenessReport } from "@/lib/ingest/lineupCompleteness";
import { getPlayerNews, type InjuryNews } from "@/lib/ingest/injuries";
import { normalisePlayerName } from "@/lib/playerName";
import {
  pickPrice,
  loadOddsSnapshotPrices,
  loadBookmakerLinePrices,
  mergePriceMaps,
  playerHasAnyOdds,
} from "@/lib/system/oddsPrices";
import { STAT_TYPES } from "./features";
import { rungsFor } from "./modelLine";
import { capGoalsLine } from "./suggest";

/** @deprecated Full squad boards — no row cap. Kept for tests referencing the old limit. */
export const TOP10_LIMIT = Number.POSITIVE_INFINITY;

export type Top10Row = {
  rank: number;
  playerId: number;
  playerName: string;
  jumper: number | null;
  team: string;
  position: string | null;
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
  missingPrediction: boolean;
  missingOdds: boolean;
  missingPlayerLink: boolean;
  missingPosition: boolean;
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
  oddsSource: "snapshots" | "bookmaker_lines" | "mixed" | "none";
  completeness: LineupCompletenessReport | null;
};

type RawPlayerStat = {
  playerId: number;
  playerName: string;
  jumper: number | null;
  team: string;
  position: string | null;
  statType: StatType;
  prediction: number;
  seasonAvg: number | null;
  recentForm: number[];
  fantasyAvg: number | null;
  benchmark: BenchmarkBand | "unknown";
  history: { hits: number; bets: number } | null;
  news: InjuryNews | null;
  rungs: number[];
  missingPrediction: boolean;
  missingPlayerLink: boolean;
  missingPosition: boolean;
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
  if (a.missingPrediction !== b.missingPrediction) {
    return a.missingPrediction ? 1 : -1;
  }
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
  const line =
    pickBoardLine(raw.rungs, raw.prediction, raw.statType, raw.seasonAvg) ??
    rungsFor(raw.statType)[0] ??
    0.5;
  const odds =
    raw.playerId > 0
      ? pickPrice(prices, raw.playerId, raw.statType, line)
      : null;
  const missingOdds =
    raw.playerId > 0 && !raw.missingPlayerLink
      ? !playerHasAnyOdds(prices, raw.playerId, raw.statType)
      : true;
  const lastGame = raw.recentForm[0] ?? null;
  return {
    rank,
    playerId: raw.playerId,
    playerName: raw.playerName,
    jumper: raw.jumper,
    team: raw.team,
    position: raw.position,
    statType: raw.statType,
    line,
    odds: odds != null ? Math.round(odds * 100) / 100 : null,
    prediction: raw.prediction,
    seasonAvg: raw.seasonAvg,
    lastGame,
    recentForm: raw.recentForm,
    fantasyAvg: raw.fantasyAvg,
    benchmark: raw.benchmark,
    reason: raw.missingPrediction
      ? "No projection — generate predictions or fix player link"
      : buildTop10Reason({
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
    missingPrediction: raw.missingPrediction,
    missingOdds,
    missingPlayerLink: raw.missingPlayerLink,
    missingPosition: raw.missingPosition,
  };
}

type SquadRow = {
  id: number;
  playerName: string;
  team: string;
  jumper: number | null;
  position: string | null;
  status: string;
  playerId: number | null;
};

function sameBoardPerson(a: RawPlayerStat, b: RawPlayerStat): boolean {
  if (a.statType !== b.statType) return false;
  const teamA = canonicalTeam(a.team) ?? a.team;
  const teamB = canonicalTeam(b.team) ?? b.team;
  if (teamA !== teamB) return false;
  if (a.playerId > 0 && b.playerId > 0 && a.playerId === b.playerId) return true;
  return normalisePlayerName(a.playerName) === normalisePlayerName(b.playerName);
}

/** Keep projection row when duplicate stub exists (lineup player_id was null). */
function preferBoardRow(existing: RawPlayerStat, incoming: RawPlayerStat): RawPlayerStat {
  if (existing.missingPrediction && !incoming.missingPrediction) return incoming;
  if (incoming.missingPrediction && !existing.missingPrediction) return existing;
  if (existing.playerId <= 0 && incoming.playerId > 0) return incoming;
  if (incoming.playerId <= 0 && existing.playerId > 0) return existing;
  return existing;
}

function squadMeta(
  squad: SquadRow[],
  playerId: number,
  name: string,
  team: string,
): { position: string | null; jumper: number | null; missingPosition: boolean } {
  const teamC = canonicalTeam(team) ?? team;
  const lp = squad.find(
    (r) =>
      (r.playerId != null && r.playerId === playerId && playerId > 0) ||
      ((canonicalTeam(r.team) ?? r.team) === teamC &&
        r.playerName.toLowerCase() === name.toLowerCase()),
  );
  if (!lp) {
    return { position: null, jumper: null, missingPosition: false };
  }
  return {
    position: lp.position,
    jumper: lp.jumper,
    missingPosition: lp.status === "named" && !lp.position?.trim(),
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
      completeness: null,
    };
  }

  const homeC = canonicalTeam(game.home) ?? game.home;
  const awayC = canonicalTeam(game.away) ?? game.away;

  const emergencies = await getEmergencyMatcher(gameId);
  const historyByKey =
    userId != null ? (await getPlayerBettingRecord(userId)).byKey : {};

  const lineupRows = await db
    .select({
      id: lineupPlayers.id,
      playerName: lineupPlayers.playerName,
      team: lineupPlayers.team,
      jumper: lineupPlayers.jumper,
      position: lineupPlayers.position,
      status: lineupPlayers.status,
      playerId: lineupPlayers.playerId,
    })
    .from(lineupPlayers)
    .where(eq(lineupPlayers.gameId, gameId));

  const idByLineup = await resolveLineupPlayerIds(gameId, homeC, awayC);

  const squad: SquadRow[] = lineupRows
    .filter((r) => r.status !== "emergency")
    .map((r) => ({
      ...r,
      playerId: idByLineup.get(r.id) ?? r.playerId,
    }));

  function onSquad(playerId: number, name: string, team: string): boolean {
    if (squad.length === 0) return true;
    const teamC = canonicalTeam(team) ?? team;
    const nn = normalisePlayerName(name);
    return squad.some(
      (lp) =>
        (lp.playerId != null && lp.playerId === playerId && playerId > 0) ||
        ((canonicalTeam(lp.team) ?? lp.team) === teamC &&
          normalisePlayerName(lp.playerName) === nn),
    );
  }

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

  const predByPlayerStat = new Map<string, (typeof activePreds)[number]>();
  for (const p of activePreds) {
    predByPlayerStat.set(`${p.playerId}:${p.statType}`, p);
  }

  const roster = [
    ...new Map(
      activePreds.map((p) => [p.playerId, { id: p.playerId, name: p.name, team: p.team }]),
    ).values(),
  ];

  const [lines, feats, newsByPlayer, { bands }, snapPrices, bookPrices, completeness] =
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
      buildLineupCompletenessReport(gameId, homeC, awayC).catch(() => null),
    ]);

  const prices = mergePriceMaps(bookPrices, snapPrices);
  let oddsSource: Top10BoardResponse["oddsSource"] = "none";
  if (snapPrices.size > 0 && bookPrices.size > 0) oddsSource = "mixed";
  else if (snapPrices.size > 0) oddsSource = "snapshots";
  else if (bookPrices.size > 0) oddsSource = "bookmaker_lines";

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

  function addRaw(raw: RawPlayerStat) {
    const teamKey = `${raw.statType}:${raw.team}`;
    const list = rawByStatTeam.get(teamKey) ?? [];
    const dupIdx = list.findIndex((r) => sameBoardPerson(r, raw));
    if (dupIdx >= 0) {
      list[dupIdx] = preferBoardRow(list[dupIdx], raw);
      rawByStatTeam.set(teamKey, list);
      return;
    }
    list.push(raw);
    rawByStatTeam.set(teamKey, list);
  }

  for (const p of activePreds) {
    if (!STAT_TYPES.includes(p.statType)) continue;
    if (!onSquad(p.playerId, p.name, p.team ?? "")) continue;
    const news = newsByPlayer.get(p.playerId) ?? null;
    if (news?.status === "out") continue;

    const key = `${p.playerId}:${p.statType}`;
    const team = canonicalTeam(p.team) ?? p.team;
    const meta = squadMeta(squad, p.playerId, p.name, team);
    addRaw({
      playerId: p.playerId,
      playerName: p.name,
      jumper: meta.jumper ?? p.jumper,
      team,
      position: meta.position,
      statType: p.statType,
      prediction: p.value,
      seasonAvg: seasonAvgByKey.get(key) ?? null,
      recentForm: formByKey.get(key) ?? [],
      fantasyAvg: p.recentFantasyAvg,
      benchmark: bands.get(key) ?? "unknown",
      history: historyByKey[playerRecordKey(p.name, p.statType)] ?? null,
      news,
      rungs: rungsByKey.get(key) ?? [],
      missingPrediction: false,
      missingPlayerLink: false,
      missingPosition: meta.missingPosition,
    });
  }

  for (const lp of squad) {
    const team = canonicalTeam(lp.team) ?? lp.team;
    if (team !== homeC && team !== awayC) continue;
    if (
      emergencies.matches({
        name: lp.playerName,
        team: lp.team,
        jumper: lp.jumper,
      })
    ) {
      continue;
    }
    const pid = lp.playerId ?? 0;
    for (const statType of STAT_TYPES) {
      const pred = pid > 0 ? predByPlayerStat.get(`${pid}:${statType}`) : undefined;
      if (pred) continue;
      addRaw({
        playerId: pid,
        playerName: lp.playerName,
        jumper: lp.jumper,
        team,
        position: lp.position,
        statType,
        prediction: 0,
        seasonAvg: null,
        recentForm: [],
        fantasyAvg: null,
        benchmark: "unknown",
        history: historyByKey[playerRecordKey(lp.playerName, statType)] ?? null,
        news: pid > 0 ? newsByPlayer.get(pid) ?? null : null,
        rungs: pid > 0 ? rungsByKey.get(`${pid}:${statType}`) ?? [] : [],
        missingPrediction: true,
        missingPlayerLink: pid <= 0,
        missingPosition: lp.status === "named" && !lp.position?.trim(),
      });
    }
  }

  for (const list of rawByStatTeam.values()) {
    for (const raw of list) {
      const meta = squadMeta(squad, raw.playerId, raw.playerName, raw.team);
      if (raw.position == null && meta.position) raw.position = meta.position;
      if (meta.jumper != null) raw.jumper = meta.jumper;
      if (meta.missingPosition) raw.missingPosition = true;
    }
  }

  const markets: Top10MarketBoard[] = STAT_TYPES.map((statType) => {
    const homeRaw = (rawByStatTeam.get(`${statType}:${homeC}`) ?? []).sort(sortTop10);
    const awayRaw = (rawByStatTeam.get(`${statType}:${awayC}`) ?? []).sort(sortTop10);

    return {
      statType,
      home: {
        team: homeC,
        rows: homeRaw.map((r, i) => toTop10Row(r, i + 1, prices)),
      },
      away: {
        team: awayC,
        rows: awayRaw.map((r, i) => toTop10Row(r, i + 1, prices)),
      },
    };
  });

  return {
    gameId,
    home: homeC,
    away: awayC,
    markets,
    oddsSource,
    completeness,
  };
}

/** playerId:statType → squad board rank within that club×market. */
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

/** Set of playerId:statType keys on any squad board for this game. */
export async function top10KeySet(gameId: number): Promise<Set<string>> {
  const map = await top10RankMap(gameId);
  return new Set(map.keys());
}
