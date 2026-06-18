import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  bookmakerLines,
  players,
  playerGameFeatures,
  playerGameStats,
  predictions,
  type ModelKey,
  type StatType,
} from "@/db/schema";
import { getPlayerCalibration } from "@/lib/data/calibration";
import { calKey, type Calibration } from "@/lib/predictions/calibration";
import { STAT_TYPES } from "@/lib/predictions/features";
import { getPlayerNews, type InjuryNews } from "@/lib/ingest/injuries";

// Assemble a "stat board" for a game: for each stat type, a list of players
// with their recent form, season average, bookmaker line, our prediction, the
// edge, a hit rate, and the actual once settled. Drives the form-first,
// Sportsbet-style game view.

export interface PlayerStatRow {
  playerId: number;
  name: string;
  team: string;
  jumper: number | null;
  line: number | null;
  seasonAvg: number | null;
  recentForm: number[]; // most-recent-first
  models: Record<ModelKey, number | null>;
  prediction: number | null; // headline = Model C (smart)
  edge: number | null; // prediction - line
  hitRate: number | null; // share of recent games over the line (0..1)
  actual: number | null;
  // How the player's actuals have compared to our baseline (Model B) on this
  // stat — drives the "we've under-rated him" note. Null until we have data.
  calibration: Calibration | null;
  // Latest matched injury/team news for this player (null when none). Same
  // object on every stat row for the player.
  news: InjuryNews | null;
  // The AI's headline pick across all four stats for this player, floored
  // (favouring the downside rather than rounding to nearest) so the card can
  // show one clear suggestion line regardless of which stat tab is active.
  aiPicks: Partial<Record<StatType, number>>;
}

export interface StatBoard {
  home: string;
  away: string;
  teams: string[];
  byStat: Record<StatType, PlayerStatRow[]>;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export async function getStatBoard(
  gameId: number,
  home: string,
  away: string,
): Promise<StatBoard> {
  const empty: StatBoard = {
    home,
    away,
    teams: [home, away],
    byStat: Object.fromEntries(
      STAT_TYPES.map((s) => [s, [] as PlayerStatRow[]]),
    ) as Record<StatType, PlayerStatRow[]>,
  };

  const preds = await db
    .select({
      playerId: predictions.playerId,
      name: players.name,
      team: players.team,
      jumper: players.jumper,
      statType: predictions.statType,
      model: predictions.model,
      value: predictions.predictedValue,
    })
    .from(predictions)
    .innerJoin(players, eq(predictions.playerId, players.id))
    .where(eq(predictions.gameId, gameId));

  if (preds.length === 0) return empty;

  const playerIds = [...new Set(preds.map((p) => p.playerId))];
  const [lines, feats, actuals, calibration] = await Promise.all([
    db.select().from(bookmakerLines).where(eq(bookmakerLines.gameId, gameId)),
    db.select().from(playerGameFeatures).where(eq(playerGameFeatures.gameId, gameId)),
    db
      .select()
      .from(playerGameStats)
      .where(and(eq(playerGameStats.gameId, gameId), eq(playerGameStats.settled, true))),
    getPlayerCalibration(playerIds),
  ]);

  // Median line per (playerId, stat).
  const lineGroups = new Map<string, number[]>();
  for (const l of lines) {
    if (l.playerId == null) continue;
    const k = `${l.playerId}:${l.statType}`;
    const arr = lineGroups.get(k) ?? [];
    arr.push(l.line);
    lineGroups.set(k, arr);
  }

  const featByKey = new Map<string, (typeof feats)[number]>();
  for (const f of feats) featByKey.set(`${f.playerId}:${f.statType}`, f);

  const actualByPlayer = new Map<number, (typeof actuals)[number]>();
  for (const a of actuals) actualByPlayer.set(a.playerId, a);

  // Collect per (player, stat) rows.
  type Acc = PlayerStatRow & { _stat: StatType };
  const rows = new Map<string, Acc>();
  for (const p of preds) {
    const key = `${p.playerId}:${p.statType}`;
    let row = rows.get(key);
    if (!row) {
      const feat = featByKey.get(key);
      const line = median(lineGroups.get(key) ?? []);
      const recentForm = feat?.recentForm ?? [];
      const hitRate =
        line != null && recentForm.length > 0
          ? recentForm.filter((v) => v > line).length / recentForm.length
          : null;
      const actual = actualByPlayer.get(p.playerId);
      row = {
        _stat: p.statType,
        playerId: p.playerId,
        name: p.name,
        team: p.team,
        jumper: p.jumper,
        line,
        seasonAvg: feat?.seasonAverage ?? null,
        recentForm,
        models: { A: null, B: null, C: null },
        prediction: null,
        edge: null,
        hitRate,
        actual: actual
          ? (actual as unknown as Record<string, number | null>)[p.statType]
          : null,
        calibration: calibration.get(calKey(p.playerId, p.statType)) ?? null,
        aiPicks: {},
        news: null,
      };
      rows.set(key, row);
    }
    row.models[p.model] = p.value;
  }

  // Finalise headline prediction + edge, group by stat.
  const board = empty;
  for (const row of rows.values()) {
    row.prediction = row.models.C ?? row.models.B ?? row.models.A;
    row.edge =
      row.prediction != null && row.line != null ? row.prediction - row.line : null;
  }

  // Floored headline pick per (player, stat) — shared across every row for
  // that player so each card can show the full disposals/marks/tackles/goals
  // line regardless of which stat tab produced the row.
  const picksByPlayer = new Map<number, Partial<Record<StatType, number>>>();
  for (const row of rows.values()) {
    if (row.prediction == null) continue;
    const picks = picksByPlayer.get(row.playerId) ?? {};
    picks[row._stat] = Math.floor(row.prediction);
    picksByPlayer.set(row.playerId, picks);
  }

  // Injury/team news, matched to this game's roster (cached; degrades to none).
  const roster = [
    ...new Map(
      preds.map((p) => [p.playerId, { id: p.playerId, name: p.name, team: p.team }]),
    ).values(),
  ];
  const newsByPlayer = await getPlayerNews(roster);

  for (const row of rows.values()) {
    row.aiPicks = picksByPlayer.get(row.playerId) ?? {};
    row.news = newsByPlayer.get(row.playerId) ?? null;
    const { _stat, ...clean } = row;
    board.byStat[_stat].push(clean);
  }

  // Sort each stat: biggest positive edge first, lined players before unlined.
  for (const stat of STAT_TYPES) {
    board.byStat[stat].sort((a, b) => {
      if (a.edge == null && b.edge == null) return b.name.localeCompare(a.name) * -1;
      if (a.edge == null) return 1;
      if (b.edge == null) return -1;
      return b.edge - a.edge;
    });
  }

  return board;
}
