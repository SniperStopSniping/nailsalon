CREATE TABLE IF NOT EXISTS "client" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"first_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_phone_idx" ON "client" USING btree ("phone");