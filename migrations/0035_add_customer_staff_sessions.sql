-- Customer and Staff Auth Sessions
-- Adds server-side session tables for customer and staff login flows

CREATE TABLE IF NOT EXISTS "client_session" (
  "id" text PRIMARY KEY NOT NULL,
  "client_phone" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "last_seen_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint


CREATE INDEX IF NOT EXISTS "client_session_phone_idx" ON "client_session" ("client_phone");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "client_session_expires_idx" ON "client_session" ("expires_at");
--> statement-breakpoint


CREATE TABLE IF NOT EXISTS "staff_session" (
  "id" text PRIMARY KEY NOT NULL,
  "technician_id" text NOT NULL REFERENCES "technician"("id") ON DELETE CASCADE,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "expires_at" timestamp NOT NULL,
  "last_seen_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint


CREATE INDEX IF NOT EXISTS "staff_session_technician_idx" ON "staff_session" ("technician_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "staff_session_salon_idx" ON "staff_session" ("salon_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "staff_session_expires_idx" ON "staff_session" ("expires_at");
