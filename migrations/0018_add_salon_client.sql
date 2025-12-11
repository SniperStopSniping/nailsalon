-- Salon Client Table
-- Salon-scoped client profiles for multi-tenant isolation
-- Links global clients to salons with salon-specific data and stats

CREATE TABLE IF NOT EXISTS "salon_client" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id"),
  "client_id" text REFERENCES "client"("id"),
  "phone" text NOT NULL,
  "full_name" text,
  "email" text,
  "preferred_technician_id" text REFERENCES "technician"("id"),
  "notes" text,
  "last_visit_at" timestamp,
  "total_visits" integer DEFAULT 0,
  "total_spent" integer DEFAULT 0,
  "no_show_count" integer DEFAULT 0,
  "loyalty_points" integer DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Unique constraint: one profile per global client per salon
CREATE UNIQUE INDEX IF NOT EXISTS "salon_client_salon_client_idx" ON "salon_client" ("salon_id", "client_id");

-- Unique constraint: one profile per phone per salon
CREATE UNIQUE INDEX IF NOT EXISTS "salon_client_salon_phone_idx" ON "salon_client" ("salon_id", "phone");

-- Search and filter indexes
CREATE INDEX IF NOT EXISTS "salon_client_salon_idx" ON "salon_client" ("salon_id");
CREATE INDEX IF NOT EXISTS "salon_client_phone_idx" ON "salon_client" ("phone");
CREATE INDEX IF NOT EXISTS "salon_client_email_idx" ON "salon_client" ("salon_id", "email");
CREATE INDEX IF NOT EXISTS "salon_client_last_visit_idx" ON "salon_client" ("salon_id", "last_visit_at");
