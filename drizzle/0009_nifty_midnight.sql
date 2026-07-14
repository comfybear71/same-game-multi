CREATE TABLE IF NOT EXISTS "system_policy" (
	"id" serial PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"source_run_id" integer,
	"weights" jsonb NOT NULL,
	"defaults" jsonb NOT NULL,
	"rationale" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_ticket_legs" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"player_id" integer,
	"player_name" text NOT NULL,
	"team" text,
	"stat_type" "stat_type" NOT NULL,
	"line" double precision NOT NULL,
	"prediction" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"actual_value" integer,
	"hit" boolean
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"strategy_key" text NOT NULL,
	"focus" text NOT NULL,
	"leg_count" integer NOT NULL,
	"tier" text DEFAULT 'balanced' NOT NULL,
	"modelled_chance" double precision,
	"est_odds" double precision,
	"legs_hit" integer DEFAULT 0 NOT NULL,
	"legs_total" integer DEFAULT 0 NOT NULL,
	"slip_hit" boolean,
	"flat_return" double precision DEFAULT 0 NOT NULL,
	"graded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_tickets_game_strategy_uq" UNIQUE("game_id","strategy_key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "system_policy" ADD CONSTRAINT "system_policy_source_run_id_backtest_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."backtest_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "system_ticket_legs" ADD CONSTRAINT "system_ticket_legs_ticket_id_system_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."system_tickets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "system_ticket_legs" ADD CONSTRAINT "system_ticket_legs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "system_tickets" ADD CONSTRAINT "system_tickets_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "system_ticket_legs_ticket_idx" ON "system_ticket_legs" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "system_tickets_game_idx" ON "system_tickets" USING btree ("game_id");