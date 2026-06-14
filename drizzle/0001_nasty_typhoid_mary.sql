CREATE TABLE IF NOT EXISTS "player_game_features" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"stat_type" "stat_type" NOT NULL,
	"season_average" double precision,
	"recent_form" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_game_feature_unique" UNIQUE("player_id","game_id","stat_type")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "jumper" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_game_features" ADD CONSTRAINT "player_game_features_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_game_features" ADD CONSTRAINT "player_game_features_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pgf_game_idx" ON "player_game_features" USING btree ("game_id");