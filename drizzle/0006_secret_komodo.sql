DO $$ BEGIN
 CREATE TYPE "public"."lineup_status" AS ENUM('named', 'interchange', 'emergency');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lineup_players" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"team" text NOT NULL,
	"player_name" text NOT NULL,
	"jumper" integer,
	"position" text,
	"status" "lineup_status" DEFAULT 'named' NOT NULL,
	"player_id" integer,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lineup_game_player_unique" UNIQUE("game_id","team","player_name")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lineup_players" ADD CONSTRAINT "lineup_players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lineup_players" ADD CONSTRAINT "lineup_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lineup_game_idx" ON "lineup_players" USING btree ("game_id");