DO $$
BEGIN
  CREATE TYPE "service_category" AS ENUM (
    'manicure',
    'builder_gel',
    'extensions',
    'pedicure',
    'hands',
    'feet',
    'combo'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "add_on_category" AS ENUM (
    'nail_art',
    'repair',
    'removal',
    'pedicure_addon'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "add_on_pricing_type" AS ENUM ('fixed', 'per_unit');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "service_add_on_selection_mode" AS ENUM ('optional', 'required', 'conditional');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "service"
  ALTER COLUMN "category" TYPE "service_category"
  USING "category"::"service_category";

ALTER TABLE "service"
  ADD COLUMN IF NOT EXISTS "description_items" jsonb,
  ADD COLUMN IF NOT EXISTS "slug" text,
  ADD COLUMN IF NOT EXISTS "price_display_text" text,
  ADD COLUMN IF NOT EXISTS "is_intro_price" boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "intro_price_label" text,
  ADD COLUMN IF NOT EXISTS "intro_price_expires_at" timestamp,
  ADD COLUMN IF NOT EXISTS "booking_questions" jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS "service_salon_slug_idx" ON "service" ("salon_id", "slug");
CREATE INDEX IF NOT EXISTS "service_active_category_idx" ON "service" ("salon_id", "is_active", "category");

CREATE TABLE IF NOT EXISTS "add_on" (
  "id" text PRIMARY KEY,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "category" "add_on_category" NOT NULL,
  "description_items" jsonb,
  "price_cents" integer NOT NULL,
  "price_display_text" text,
  "duration_minutes" integer NOT NULL,
  "pricing_type" "add_on_pricing_type" DEFAULT 'fixed' NOT NULL,
  "unit_label" text,
  "max_quantity" integer,
  "is_active" boolean DEFAULT true,
  "display_order" integer DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "add_on_salon_slug_idx" ON "add_on" ("salon_id", "slug");
CREATE INDEX IF NOT EXISTS "add_on_active_category_idx" ON "add_on" ("salon_id", "is_active", "category");

CREATE TABLE IF NOT EXISTS "service_add_on" (
  "id" text PRIMARY KEY,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "service_id" text NOT NULL REFERENCES "service"("id") ON DELETE CASCADE,
  "add_on_id" text NOT NULL REFERENCES "add_on"("id") ON DELETE CASCADE,
  "selection_mode" "service_add_on_selection_mode" DEFAULT 'optional' NOT NULL,
  "conditions" jsonb,
  "default_quantity" integer,
  "max_quantity_override" integer,
  "display_order" integer DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "service_add_on_salon_idx" ON "service_add_on" ("salon_id");
CREATE INDEX IF NOT EXISTS "service_add_on_service_idx" ON "service_add_on" ("service_id");
CREATE UNIQUE INDEX IF NOT EXISTS "service_add_on_unique_idx" ON "service_add_on" ("service_id", "add_on_id");

ALTER TABLE "appointment"
  ADD COLUMN IF NOT EXISTS "base_price_cents" integer,
  ADD COLUMN IF NOT EXISTS "add_ons_price_cents" integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "base_duration_minutes" integer,
  ADD COLUMN IF NOT EXISTS "add_ons_duration_minutes" integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "buffer_minutes" integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "blocked_duration_minutes" integer;

ALTER TABLE "appointment_services"
  ADD COLUMN IF NOT EXISTS "name_snapshot" text,
  ADD COLUMN IF NOT EXISTS "category_snapshot" text,
  ADD COLUMN IF NOT EXISTS "price_cents_snapshot" integer,
  ADD COLUMN IF NOT EXISTS "duration_minutes_snapshot" integer,
  ADD COLUMN IF NOT EXISTS "price_display_text_snapshot" text,
  ADD COLUMN IF NOT EXISTS "resolved_intro_price_label_snapshot" text;

CREATE TABLE IF NOT EXISTS "appointment_add_on" (
  "id" text PRIMARY KEY,
  "appointment_id" text NOT NULL REFERENCES "appointment"("id") ON DELETE CASCADE,
  "add_on_id" text REFERENCES "add_on"("id"),
  "quantity_snapshot" integer DEFAULT 1 NOT NULL,
  "name_snapshot" text NOT NULL,
  "category_snapshot" text NOT NULL,
  "pricing_type_snapshot" text NOT NULL,
  "unit_price_cents_snapshot" integer NOT NULL,
  "duration_minutes_snapshot" integer NOT NULL,
  "line_total_cents_snapshot" integer NOT NULL,
  "line_duration_minutes_snapshot" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "appointment_add_on_appointment_idx" ON "appointment_add_on" ("appointment_id");
CREATE INDEX IF NOT EXISTS "appointment_add_on_add_on_idx" ON "appointment_add_on" ("add_on_id");
