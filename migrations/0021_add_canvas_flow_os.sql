-- Canvas Flow OS - Step 9.1 Migration
-- Adds canvas state machine + photo policies + auto-post queue

-- =============================================================================
-- ENUMS
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "canvas_state" AS ENUM('waiting', 'working', 'wrap_up', 'complete', 'cancelled', 'no_show');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "photo_requirement_mode" AS ENUM('off', 'optional', 'required');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "autopost_status" AS ENUM('queued', 'processing', 'posted', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- =============================================================================
-- ALTER appointment TABLE (add canvas columns)
-- =============================================================================

ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "canvas_state" "canvas_state" DEFAULT 'waiting';
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "canvas_state_updated_at" timestamp with time zone;
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

-- New indexes for appointment
CREATE INDEX IF NOT EXISTS "appointment_tech_start_time_idx" ON "appointment" ("technician_id", "start_time" DESC);
CREATE INDEX IF NOT EXISTS "appointment_deleted_at_idx" ON "appointment" ("deleted_at");

-- =============================================================================
-- CREATE appointment_artifacts TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "appointment_artifacts" (
  "id" text PRIMARY KEY NOT NULL,
  "appointment_id" text NOT NULL UNIQUE,
  "before_photo_url" text,
  "after_photo_url" text,
  "before_photo_uploaded_at" timestamp with time zone,
  "after_photo_uploaded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "appointment_artifacts" DROP CONSTRAINT IF EXISTS "appointment_artifacts_appointment_id_appointment_id_fk";
ALTER TABLE "appointment_artifacts" ADD CONSTRAINT "appointment_artifacts_appointment_id_appointment_id_fk" 
  FOREIGN KEY ("appointment_id") REFERENCES "appointment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE UNIQUE INDEX IF NOT EXISTS "artifacts_appointment_idx" ON "appointment_artifacts" ("appointment_id");

-- =============================================================================
-- CREATE salon_policies TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "salon_policies" (
  "salon_id" text PRIMARY KEY NOT NULL,
  "require_before_photo_to_start" "photo_requirement_mode" DEFAULT 'off' NOT NULL,
  "require_after_photo_to_finish" "photo_requirement_mode" DEFAULT 'off' NOT NULL,
  "require_after_photo_to_pay" "photo_requirement_mode" DEFAULT 'off' NOT NULL,
  "auto_post_enabled" boolean DEFAULT false NOT NULL,
  "auto_post_platforms" text[] DEFAULT '{}' NOT NULL,
  "auto_post_include_price" boolean DEFAULT false NOT NULL,
  "auto_post_include_color" boolean DEFAULT false NOT NULL,
  "auto_post_include_brand" boolean DEFAULT false NOT NULL,
  "auto_post_ai_caption_enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "salon_policies" DROP CONSTRAINT IF EXISTS "salon_policies_salon_id_salon_id_fk";
ALTER TABLE "salon_policies" ADD CONSTRAINT "salon_policies_salon_id_salon_id_fk" 
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- =============================================================================
-- CREATE super_admin_policies TABLE (SINGLETON)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "super_admin_policies" (
  "id" text PRIMARY KEY NOT NULL DEFAULT 'singleton',
  "require_before_photo_to_start" "photo_requirement_mode",
  "require_after_photo_to_finish" "photo_requirement_mode",
  "require_after_photo_to_pay" "photo_requirement_mode",
  "auto_post_enabled" boolean,
  "auto_post_ai_caption_enabled" boolean,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Insert singleton row if not exists
INSERT INTO "super_admin_policies" ("id") VALUES ('singleton') ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- CREATE autopost_queue TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "autopost_queue" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL,
  "appointment_id" text NOT NULL,
  "status" "autopost_status" DEFAULT 'queued' NOT NULL,
  "platform" text NOT NULL,
  "payload_json" jsonb,
  "error" text,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "scheduled_for" timestamp with time zone,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "autopost_queue" DROP CONSTRAINT IF EXISTS "autopost_queue_salon_id_salon_id_fk";
ALTER TABLE "autopost_queue" ADD CONSTRAINT "autopost_queue_salon_id_salon_id_fk" 
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "autopost_queue" DROP CONSTRAINT IF EXISTS "autopost_queue_appointment_id_appointment_id_fk";
ALTER TABLE "autopost_queue" ADD CONSTRAINT "autopost_queue_appointment_id_appointment_id_fk" 
  FOREIGN KEY ("appointment_id") REFERENCES "appointment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE INDEX IF NOT EXISTS "autopost_queue_salon_idx" ON "autopost_queue" ("salon_id");
CREATE INDEX IF NOT EXISTS "autopost_queue_appointment_idx" ON "autopost_queue" ("appointment_id");
CREATE INDEX IF NOT EXISTS "autopost_queue_status_scheduled_idx" ON "autopost_queue" ("status", "scheduled_for");


