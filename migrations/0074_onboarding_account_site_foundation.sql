-- 0074_onboarding_account_site_foundation.sql
--
-- Account-backed Onboarding V1 foundation. This migration does not publish a
-- site, change an entitlement, or activate a provider. It adds a tenant-owned
-- site identity, append-only revisions, an idempotent anonymous-draft claim,
-- and role-specific media claim records.

-- Clerk-first owners may authenticate with verified email and no phone. Null
-- is never accepted by the legacy OTP lookup, and the existing unique index
-- continues to protect every non-null phone identity.
ALTER TABLE "admin_user" ALTER COLUMN "phone_e164" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "onboarding_source_service_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "service_salon_onboarding_source_idx"
  ON "service" ("salon_id", "onboarding_source_service_id")
  WHERE "onboarding_source_service_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "add_on" ADD COLUMN "onboarding_source_add_on_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "add_on_salon_onboarding_source_idx"
  ON "add_on" ("salon_id", "onboarding_source_add_on_id")
  WHERE "onboarding_source_add_on_id" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE "onboarding_site" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "created_by_admin_id" text NOT NULL REFERENCES "admin_user"("id") ON DELETE RESTRICT,
  "status" text DEFAULT 'draft' NOT NULL,
  "current_revision" integer DEFAULT 0 NOT NULL,
  "style_preset_id" text NOT NULL,
  "palette_preset_id" text NOT NULL,
  "service_menu_applied" boolean DEFAULT true NOT NULL,
  "plan_intent" text,
  "plan_intent_idempotency_key_hash" text,
  "plan_intent_updated_at" timestamp with time zone,
  "is_current" boolean DEFAULT true NOT NULL,
  "dashboard_welcome_dismissed_at" timestamp with time zone,
  "dashboard_tour_completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "onboarding_site_status_check"
    CHECK ("status" IN ('draft', 'published', 'archived')),
  CONSTRAINT "onboarding_site_revision_check"
    CHECK ("current_revision" >= 0),
  CONSTRAINT "onboarding_site_style_check"
    CHECK ("style_preset_id" IN ('modern', 'editorial', 'soft', 'minimal', 'bold', 'luxury')),
  CONSTRAINT "onboarding_site_palette_check"
    CHECK ("palette_preset_id" IN ('luster_berry', 'blush_cocoa', 'terracotta_cream', 'sage_stone', 'lilac_plum', 'navy_ivory', 'monochrome', 'black_champagne')),
  CONSTRAINT "onboarding_site_plan_intent_check"
    CHECK ("plan_intent" IS NULL OR "plan_intent" IN ('free', 'founding_interest', 'monthly_interest')),
  CONSTRAINT "onboarding_site_salon_id_id_key" UNIQUE ("salon_id", "id")
);
--> statement-breakpoint
CREATE INDEX "onboarding_site_salon_idx" ON "onboarding_site" ("salon_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_site_one_current_per_salon_idx"
  ON "onboarding_site" ("salon_id") WHERE "is_current" = true;
--> statement-breakpoint

CREATE TABLE "onboarding_site_revision" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL,
  "site_id" text NOT NULL,
  "revision" integer NOT NULL,
  "created_by_admin_id" text NOT NULL REFERENCES "admin_user"("id") ON DELETE RESTRICT,
  "snapshot_version" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "snapshot_fingerprint" text NOT NULL,
  "document_version" integer NOT NULL,
  "document" jsonb NOT NULL,
  "document_fingerprint" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "onboarding_site_revision_number_check" CHECK ("revision" >= 1),
  CONSTRAINT "onboarding_site_revision_snapshot_version_check" CHECK ("snapshot_version" = 1),
  CONSTRAINT "onboarding_site_revision_document_version_check" CHECK ("document_version" = 1),
  CONSTRAINT "onboarding_site_revision_site_salon_fk"
    FOREIGN KEY ("salon_id", "site_id")
    REFERENCES "onboarding_site" ("salon_id", "id") ON DELETE CASCADE,
  CONSTRAINT "onboarding_site_revision_salon_id_id_key" UNIQUE ("salon_id", "id"),
  CONSTRAINT "onboarding_site_revision_site_revision_idx" UNIQUE ("site_id", "revision")
);
--> statement-breakpoint
CREATE INDEX "onboarding_site_revision_salon_idx"
  ON "onboarding_site_revision" ("salon_id");
--> statement-breakpoint

CREATE TABLE "onboarding_draft_claim" (
  "id" text PRIMARY KEY NOT NULL,
  "anonymous_draft_token_hash" text NOT NULL UNIQUE,
  "last_idempotency_key_hash" text NOT NULL,
  "claimed_by_admin_id" text NOT NULL REFERENCES "admin_user"("id") ON DELETE RESTRICT,
  "salon_id" text NOT NULL,
  "site_id" text NOT NULL,
  "revision_id" text NOT NULL,
  "status" text DEFAULT 'claimed' NOT NULL,
  "claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "onboarding_draft_claim_status_check" CHECK ("status" = 'claimed'),
  CONSTRAINT "onboarding_draft_claim_site_salon_fk"
    FOREIGN KEY ("salon_id", "site_id")
    REFERENCES "onboarding_site" ("salon_id", "id") ON DELETE CASCADE,
  CONSTRAINT "onboarding_draft_claim_revision_salon_fk"
    FOREIGN KEY ("salon_id", "revision_id")
    REFERENCES "onboarding_site_revision" ("salon_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "onboarding_draft_claim_admin_idx"
  ON "onboarding_draft_claim" ("claimed_by_admin_id");
--> statement-breakpoint
CREATE INDEX "onboarding_draft_claim_salon_idx"
  ON "onboarding_draft_claim" ("salon_id");
--> statement-breakpoint
CREATE INDEX "onboarding_draft_claim_site_idx"
  ON "onboarding_draft_claim" ("site_id");
--> statement-breakpoint

CREATE TABLE "onboarding_site_media" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL,
  "site_id" text NOT NULL,
  "revision_id" text NOT NULL,
  "role" text NOT NULL,
  "local_item_id" text NOT NULL,
  "claim_status" text DEFAULT 'pending' NOT NULL,
  "upload_lease_id" text,
  "storage_provider" text,
  "storage_key" text,
  "public_url" text,
  "image_item_id" text,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size" integer,
  "width" integer,
  "height" integer,
  "alt_text" text,
  "accessible_summary" text,
  "decorative" boolean,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "display_mode" text,
  "failure_code" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "onboarding_site_media_role_check"
    CHECK ("role" IN ('profile', 'logo', 'gallery', 'custom_design')),
  CONSTRAINT "onboarding_site_media_status_check"
    CHECK ("claim_status" IN ('pending', 'uploading', 'ready', 'failed')),
  CONSTRAINT "onboarding_site_media_upload_lease_check"
    CHECK (("claim_status" = 'uploading' AND "upload_lease_id" IS NOT NULL)
      OR ("claim_status" <> 'uploading' AND "upload_lease_id" IS NULL)),
  CONSTRAINT "onboarding_site_media_dimensions_check"
    CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0)),
  CONSTRAINT "onboarding_site_media_file_size_check"
    CHECK ("file_size" IS NULL OR "file_size" > 0),
  CONSTRAINT "onboarding_site_media_ready_storage_check"
    CHECK ("claim_status" <> 'ready' OR ("storage_provider" IS NOT NULL AND "storage_key" IS NOT NULL)),
  CONSTRAINT "onboarding_site_media_site_salon_fk"
    FOREIGN KEY ("salon_id", "site_id")
    REFERENCES "onboarding_site" ("salon_id", "id") ON DELETE CASCADE,
  CONSTRAINT "onboarding_site_media_revision_salon_fk"
    FOREIGN KEY ("salon_id", "revision_id")
    REFERENCES "onboarding_site_revision" ("salon_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "onboarding_site_media_site_idx"
  ON "onboarding_site_media" ("salon_id", "site_id");
--> statement-breakpoint
CREATE INDEX "onboarding_site_media_revision_idx"
  ON "onboarding_site_media" ("salon_id", "revision_id");
--> statement-breakpoint
CREATE INDEX "onboarding_site_media_role_idx"
  ON "onboarding_site_media" ("salon_id", "site_id", "role");
--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_site_media_revision_role_local_idx"
  ON "onboarding_site_media" ("revision_id", "role", "local_item_id");
--> statement-breakpoint

CREATE FUNCTION "onboarding_site_set_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "onboarding_site_updated_at"
BEFORE UPDATE ON "onboarding_site"
FOR EACH ROW EXECUTE FUNCTION "onboarding_site_set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "onboarding_draft_claim_updated_at"
BEFORE UPDATE ON "onboarding_draft_claim"
FOR EACH ROW EXECUTE FUNCTION "onboarding_site_set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "onboarding_site_media_updated_at"
BEFORE UPDATE ON "onboarding_site_media"
FOR EACH ROW EXECUTE FUNCTION "onboarding_site_set_updated_at"();
