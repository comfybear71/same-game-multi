import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

/** The four player stat markets we track (AFL only). */
export const statTypeEnum = pgEnum("stat_type", [
  "disposals",
  "marks",
  "tackles",
  "goals",
]);

/** Prediction models. A = season avg, B = form-weighted, C = smart. */
export const modelEnum = pgEnum("model", ["A", "B", "C"]);

/** Lifecycle of a game. */
export const gameStatusEnum = pgEnum("game_status", [
  "scheduled",
  "in_progress",
  "complete",
]);

/** Lifecycle of a bet slip (same-game multi). */
export const betStatusEnum = pgEnum("bet_status", [
  "pending",
  "won",
  "lost",
  "void",
]);

/** Result of an individual leg once settled. */
export const legResultEnum = pgEnum("leg_result", [
  "pending",
  "hit",
  "miss",
  "void",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Teams & Players
// ─────────────────────────────────────────────────────────────────────────────

export const players = pgTable(
  "players",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    team: text("team").notNull(),
    // Guernsey number (from the player's most recent match).
    jumper: integer("jumper"),
    // Optional external identifiers to help dedupe across data sources.
    aflTablesSlug: text("afl_tables_slug"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    nameTeamUnique: unique("players_name_team_unique").on(t.name, t.team),
    teamIdx: index("players_team_idx").on(t.team),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Games / Fixtures
// ─────────────────────────────────────────────────────────────────────────────

export const games = pgTable(
  "games",
  {
    id: serial("id").primaryKey(),
    round: integer("round"),
    season: integer("season"),
    home: text("home").notNull(),
    away: text("away").notNull(),
    venue: text("venue"),
    // Stored as UTC; rendered in AWST (UTC+8) in the UI.
    commenceTime: timestamp("commence_time", { withTimezone: true }).notNull(),
    status: gameStatusEnum("status").notNull().default("scheduled"),
    // External source IDs (used for joins + dedupe).
    oddsApiId: text("odds_api_id").unique(),
    squiggleId: integer("squiggle_id").unique(),
    // Final scores, populated on settle.
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    commenceIdx: index("games_commence_idx").on(t.commenceTime),
    roundIdx: index("games_round_idx").on(t.season, t.round),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Player game stats (actuals + rolling inputs)
// ─────────────────────────────────────────────────────────────────────────────

// One row per player per game. Actual stat columns are NULL until the game is
// settled from Squiggle / AFL Tables.
export const playerGameStats = pgTable(
  "player_game_stats",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    disposals: integer("disposals"),
    marks: integer("marks"),
    tackles: integer("tackles"),
    goals: integer("goals"),
    // Whether the player actually took part (handles late outs).
    didPlay: boolean("did_play"),
    settled: boolean("settled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    playerGameUnique: unique("player_game_unique").on(t.playerId, t.gameId),
    gameIdx: index("pgs_game_idx").on(t.gameId),
    playerIdx: index("pgs_player_idx").on(t.playerId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Predictions (one row per player / game / stat / model)
// ─────────────────────────────────────────────────────────────────────────────

export const predictions = pgTable(
  "predictions",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    statType: statTypeEnum("stat_type").notNull(),
    model: modelEnum("model").notNull(),
    predictedValue: doublePrecision("predicted_value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniquePrediction: unique("prediction_unique").on(
      t.playerId,
      t.gameId,
      t.statType,
      t.model,
    ),
    gameIdx: index("predictions_game_idx").on(t.gameId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Per-player, per-stat features for a game (recent form for charts + hit rate)
// ─────────────────────────────────────────────────────────────────────────────

export const playerGameFeatures = pgTable(
  "player_game_features",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    statType: statTypeEnum("stat_type").notNull(),
    seasonAverage: doublePrecision("season_average"),
    // Most-recent-first list of this stat across recent games (e.g. last 10).
    recentForm: jsonb("recent_form").$type<number[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueFeature: unique("player_game_feature_unique").on(
      t.playerId,
      t.gameId,
      t.statType,
    ),
    gameIdx: index("pgf_game_idx").on(t.gameId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Bookmaker prop lines (first-class source for the Edge Finder)
// ─────────────────────────────────────────────────────────────────────────────

export const bookmakerLines = pgTable(
  "bookmaker_lines",
  {
    id: serial("id").primaryKey(),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    playerId: integer("player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    // Player name as returned by the bookmaker, kept for reconciliation.
    playerName: text("player_name").notNull(),
    statType: statTypeEnum("stat_type").notNull(),
    bookmaker: text("bookmaker").notNull(),
    line: doublePrecision("line").notNull(),
    overOdds: doublePrecision("over_odds"),
    underOdds: doublePrecision("under_odds"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    lookupIdx: index("bookmaker_lines_lookup_idx").on(
      t.gameId,
      t.statType,
      t.bookmaker,
    ),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Bets (slip) + legs
// ─────────────────────────────────────────────────────────────────────────────

export const bets = pgTable("bets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  round: integer("round"),
  totalOdds: doublePrecision("total_odds"),
  totalStake: doublePrecision("total_stake"),
  status: betStatusEnum("status").notNull().default("pending"),
  notes: text("notes"),
  // Screenshot of the whole slip (Vercel Blob URL).
  screenshotUrl: text("screenshot_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
});

export const betLegs = pgTable(
  "bet_legs",
  {
    id: serial("id").primaryKey(),
    betId: integer("bet_id")
      .notNull()
      .references(() => bets.id, { onDelete: "cascade" }),
    playerId: integer("player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    // Raw player name as entered / read from the slip (kept even when unmatched).
    playerName: text("player_name"),
    gameId: integer("game_id").references(() => games.id, {
      onDelete: "set null",
    }),
    statType: statTypeEnum("stat_type").notNull(),
    // The line being bet (e.g. 25.5 disposals, over).
    line: doublePrecision("line").notNull(),
    odds: doublePrecision("odds"),
    confidence: integer("confidence"), // 1–5 self-rating
    screenshotUrl: text("screenshot_url"), // Vercel Blob URL
    notes: text("notes"),
    result: legResultEnum("result").notNull().default("pending"),
    // Actual value the leg settled against (filled on settle).
    actualValue: integer("actual_value"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    betIdx: index("bet_legs_bet_idx").on(t.betId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Model accuracy (rolling scorecard per round / model / stat)
// ─────────────────────────────────────────────────────────────────────────────

export const modelAccuracy = pgTable(
  "model_accuracy",
  {
    id: serial("id").primaryKey(),
    season: integer("season"),
    round: integer("round").notNull(),
    model: modelEnum("model").notNull(),
    statType: statTypeEnum("stat_type").notNull(),
    // Mean absolute error and a within-tolerance hit rate (0–1).
    mae: doublePrecision("mae"),
    accuracy: doublePrecision("accuracy"),
    roi: doublePrecision("roi"),
    sampleSize: integer("sample_size"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueScore: unique("model_accuracy_unique").on(
      t.season,
      t.round,
      t.model,
      t.statType,
    ),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// API response cache (keeps The Odds API / Squiggle usage cheap)
// ─────────────────────────────────────────────────────────────────────────────

export const apiCache = pgTable("api_cache", {
  // Cache key, e.g. "odds:fixtures" or "odds:props:<eventId>".
  key: text("key").primaryKey(),
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  bets: many(bets),
}));

export const gamesRelations = relations(games, ({ many }) => ({
  playerGameStats: many(playerGameStats),
  predictions: many(predictions),
  bookmakerLines: many(bookmakerLines),
}));

export const playersRelations = relations(players, ({ many }) => ({
  playerGameStats: many(playerGameStats),
  predictions: many(predictions),
}));

export const playerGameStatsRelations = relations(
  playerGameStats,
  ({ one }) => ({
    player: one(players, {
      fields: [playerGameStats.playerId],
      references: [players.id],
    }),
    game: one(games, {
      fields: [playerGameStats.gameId],
      references: [games.id],
    }),
  }),
);

export const betsRelations = relations(bets, ({ one, many }) => ({
  user: one(users, { fields: [bets.userId], references: [users.id] }),
  legs: many(betLegs),
}));

export const betLegsRelations = relations(betLegs, ({ one }) => ({
  bet: one(bets, { fields: [betLegs.betId], references: [bets.id] }),
  player: one(players, {
    fields: [betLegs.playerId],
    references: [players.id],
  }),
  game: one(games, { fields: [betLegs.gameId], references: [games.id] }),
}));

// Convenience types
export type Game = typeof games.$inferSelect;
export type NewGame = typeof games.$inferInsert;
export type Player = typeof players.$inferSelect;
export type PlayerGameStat = typeof playerGameStats.$inferSelect;
export type Prediction = typeof predictions.$inferSelect;
export type PlayerGameFeature = typeof playerGameFeatures.$inferSelect;
export type BookmakerLine = typeof bookmakerLines.$inferSelect;
export type Bet = typeof bets.$inferSelect;
export type BetLeg = typeof betLegs.$inferSelect;
export type ModelAccuracy = typeof modelAccuracy.$inferSelect;
export type StatType = (typeof statTypeEnum.enumValues)[number];
export type ModelKey = (typeof modelEnum.enumValues)[number];
export type LegResult = (typeof legResultEnum.enumValues)[number];
