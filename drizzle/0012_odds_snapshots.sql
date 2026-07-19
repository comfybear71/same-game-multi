CREATE TABLE IF NOT EXISTS "odds_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"odds_api_event_id" text NOT NULL,
	"game_id" integer,
	"player_name" text NOT NULL,
	"player_id" integer,
	"market_key" text NOT NULL,
	"stat_family" text,
	"line" double precision NOT NULL,
	"over_odds" double precision,
	"under_odds" double precision,
	"bookmaker" text NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "odds_snapshots" ADD CONSTRAINT "odds_snapshots_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "odds_snapshots" ADD CONSTRAINT "odds_snapshots_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "odds_snapshots_event_idx" ON "odds_snapshots" USING btree ("odds_api_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "odds_snapshots_game_snap_idx" ON "odds_snapshots" USING btree ("game_id","snapshot_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "odds_snapshots_lookup_idx" ON "odds_snapshots" USING btree ("odds_api_event_id","player_name","market_key","bookmaker","line");
