ALTER TABLE "system_tickets" ADD COLUMN "voided" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "system_ticket_legs" ADD COLUMN "voided" boolean DEFAULT false NOT NULL;
