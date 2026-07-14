DO $$ BEGIN
 CREATE TYPE "public"."bankroll_run_status" AS ENUM('running', 'complete', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bankroll_checkpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"season" integer NOT NULL,
	"after_round" integer,
	"unit" double precision NOT NULL,
	"bank" double precision NOT NULL,
	"capital_injected" double precision NOT NULL,
	"net_profit" double precision NOT NULL,
	"games_played" integer NOT NULL,
	"tickets_placed" integer NOT NULL,
	"tickets_hit" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bankroll_round_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"season" integer NOT NULL,
	"round" integer NOT NULL,
	"unit_before" double precision NOT NULL,
	"unit_after" double precision NOT NULL,
	"stake" double precision NOT NULL,
	"returns" double precision NOT NULL,
	"pnl" double precision NOT NULL,
	"bank_after" double precision NOT NULL,
	"capital_injected" double precision NOT NULL,
	"games" integer NOT NULL,
	"tickets_placed" integer NOT NULL,
	"tickets_hit" integer NOT NULL,
	"policy_top" jsonb,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bankroll_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"source_run_id" integer NOT NULL,
	"params" jsonb NOT NULL,
	"status" "bankroll_run_status" DEFAULT 'running' NOT NULL,
	"learned_policy" jsonb,
	"rationale" text,
	"final_unit" double precision,
	"final_bank" double precision,
	"capital_injected" double precision DEFAULT 0 NOT NULL,
	"net_profit" double precision,
	"games_played" integer DEFAULT 0 NOT NULL,
	"tickets_placed" integer DEFAULT 0 NOT NULL,
	"tickets_hit" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bankroll_checkpoints" ADD CONSTRAINT "bankroll_checkpoints_run_id_bankroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."bankroll_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bankroll_round_log" ADD CONSTRAINT "bankroll_round_log_run_id_bankroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."bankroll_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bankroll_runs" ADD CONSTRAINT "bankroll_runs_source_run_id_backtest_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."backtest_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bankroll_checkpoints_run_season_idx" ON "bankroll_checkpoints" USING btree ("run_id","season");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bankroll_round_log_run_round_idx" ON "bankroll_round_log" USING btree ("run_id","season","round");