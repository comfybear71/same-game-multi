CREATE TABLE IF NOT EXISTS "player_live_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"player_id" text NOT NULL,
	"player_name" text NOT NULL,
	"team" text NOT NULL,
	"goals" integer DEFAULT 0 NOT NULL,
	"kicks" integer DEFAULT 0 NOT NULL,
	"handballs" integer DEFAULT 0 NOT NULL,
	"disposals" integer DEFAULT 0 NOT NULL,
	"marks" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_live_stats_match_player_unique" UNIQUE("match_id","player_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_live_stats_match_idx" ON "player_live_stats" USING btree ("match_id");
