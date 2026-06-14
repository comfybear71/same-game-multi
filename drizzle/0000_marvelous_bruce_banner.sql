DO $$ BEGIN
 CREATE TYPE "public"."bet_status" AS ENUM('pending', 'won', 'lost', 'void');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."game_status" AS ENUM('scheduled', 'in_progress', 'complete');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."leg_result" AS ENUM('pending', 'hit', 'miss', 'void');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."model" AS ENUM('A', 'B', 'C');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."stat_type" AS ENUM('disposals', 'marks', 'tackles', 'goals');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bet_legs" (
	"id" serial PRIMARY KEY NOT NULL,
	"bet_id" integer NOT NULL,
	"player_id" integer,
	"game_id" integer,
	"stat_type" "stat_type" NOT NULL,
	"line" double precision NOT NULL,
	"odds" double precision,
	"confidence" integer,
	"screenshot_url" text,
	"notes" text,
	"result" "leg_result" DEFAULT 'pending' NOT NULL,
	"actual_value" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"round" integer,
	"total_odds" double precision,
	"total_stake" double precision,
	"status" "bet_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bookmaker_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"player_id" integer,
	"player_name" text NOT NULL,
	"stat_type" "stat_type" NOT NULL,
	"bookmaker" text NOT NULL,
	"line" double precision NOT NULL,
	"over_odds" double precision,
	"under_odds" double precision,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "games" (
	"id" serial PRIMARY KEY NOT NULL,
	"round" integer,
	"season" integer,
	"home" text NOT NULL,
	"away" text NOT NULL,
	"venue" text,
	"commence_time" timestamp with time zone NOT NULL,
	"status" "game_status" DEFAULT 'scheduled' NOT NULL,
	"odds_api_id" text,
	"squiggle_id" integer,
	"home_score" integer,
	"away_score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_odds_api_id_unique" UNIQUE("odds_api_id"),
	CONSTRAINT "games_squiggle_id_unique" UNIQUE("squiggle_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_accuracy" (
	"id" serial PRIMARY KEY NOT NULL,
	"season" integer,
	"round" integer NOT NULL,
	"model" "model" NOT NULL,
	"stat_type" "stat_type" NOT NULL,
	"mae" double precision,
	"accuracy" double precision,
	"roi" double precision,
	"sample_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_accuracy_unique" UNIQUE("season","round","model","stat_type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_game_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"disposals" integer,
	"marks" integer,
	"tackles" integer,
	"goals" integer,
	"did_play" boolean,
	"settled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_game_unique" UNIQUE("player_id","game_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"team" text NOT NULL,
	"afl_tables_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_name_team_unique" UNIQUE("name","team")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"stat_type" "stat_type" NOT NULL,
	"model" "model" NOT NULL,
	"predicted_value" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prediction_unique" UNIQUE("player_id","game_id","stat_type","model")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bet_legs" ADD CONSTRAINT "bet_legs_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bet_legs" ADD CONSTRAINT "bet_legs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bet_legs" ADD CONSTRAINT "bet_legs_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bets" ADD CONSTRAINT "bets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookmaker_lines" ADD CONSTRAINT "bookmaker_lines_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookmaker_lines" ADD CONSTRAINT "bookmaker_lines_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_game_stats" ADD CONSTRAINT "player_game_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_game_stats" ADD CONSTRAINT "player_game_stats_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "predictions" ADD CONSTRAINT "predictions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "predictions" ADD CONSTRAINT "predictions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bet_legs_bet_idx" ON "bet_legs" USING btree ("bet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookmaker_lines_lookup_idx" ON "bookmaker_lines" USING btree ("game_id","stat_type","bookmaker");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "games_commence_idx" ON "games" USING btree ("commence_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "games_round_idx" ON "games" USING btree ("season","round");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pgs_game_idx" ON "player_game_stats" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pgs_player_idx" ON "player_game_stats" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "players_team_idx" ON "players" USING btree ("team");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "predictions_game_idx" ON "predictions" USING btree ("game_id");