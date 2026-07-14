ALTER TABLE "system_tickets" ADD COLUMN "placed_odds" double precision;--> statement-breakpoint
ALTER TABLE "system_tickets" ADD COLUMN "stake" double precision;--> statement-breakpoint
ALTER TABLE "system_tickets" ADD COLUMN "cash_return" double precision DEFAULT 0 NOT NULL;