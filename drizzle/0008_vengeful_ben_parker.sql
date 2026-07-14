DO $$ BEGIN
 CREATE TYPE "public"."backtest_run_status" AS ENUM('running', 'complete', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backtest_legs" (
	"id" serial PRIMARY KEY NOT NULL,
	"slip_id" integer NOT NULL,
	"player_name" text NOT NULL,
	"team" text,
	"stat_type" "stat_type" NOT NULL,
	"line" double precision NOT NULL,
	"prediction" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"actual_value" integer,
	"hit" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backtest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"seasons" jsonb NOT NULL,
	"status" "backtest_run_status" DEFAULT 'running' NOT NULL,
	"games_processed" integer DEFAULT 0 NOT NULL,
	"slips_written" integer DEFAULT 0 NOT NULL,
	"last_game_id" integer,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backtest_slips" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"season" integer NOT NULL,
	"round" integer,
	"strategy_key" text NOT NULL,
	"focus" text NOT NULL,
	"leg_count" integer NOT NULL,
	"modelled_chance" double precision,
	"est_odds" double precision,
	"legs_hit" integer DEFAULT 0 NOT NULL,
	"legs_total" integer DEFAULT 0 NOT NULL,
	"slip_hit" boolean DEFAULT false NOT NULL,
	"flat_return" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "backtest_legs" ADD CONSTRAINT "backtest_legs_slip_id_backtest_slips_id_fk" FOREIGN KEY ("slip_id") REFERENCES "public"."backtest_slips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "backtest_slips" ADD CONSTRAINT "backtest_slips_run_id_backtest_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."backtest_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "backtest_slips" ADD CONSTRAINT "backtest_slips_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backtest_legs_slip_idx" ON "backtest_legs" USING btree ("slip_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backtest_slips_run_strategy_idx" ON "backtest_slips" USING btree ("run_id","strategy_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backtest_slips_run_game_idx" ON "backtest_slips" USING btree ("run_id","game_id");