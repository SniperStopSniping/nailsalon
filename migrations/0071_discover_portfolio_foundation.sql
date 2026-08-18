-- 0071_discover_portfolio_foundation.sql
--
-- Luster Discover — PR1, Portfolio foundation and plan limits.
-- Governing specification: docs/DISCOVER_V1_BRIEF.md (draft PR #116).
--
-- Creates the canonical salon-owned portfolio: fresh owner-uploaded marketing
-- media, with Discover browsing metadata (service family + length), a
-- normalized 4:5 crop, durable publication-rights evidence, owner-managed
-- ordering, and business-level Discover participation.
--
-- BOUNDARY: `appointment_photo` is deliberately untouched. Those rows are
-- per-appointment client before/after records keyed to a client's phone
-- number. They are client records, not marketing assets — nothing here
-- migrates, promotes, reads or republishes them, and public-display consent
-- is never inferred from them.
--
-- Owner intent and plan eligibility are separate concerns. `owner_visible`
-- and `discover_included` are owner-owned and are NEVER rewritten by a plan
-- change; which photos remain within a shrunken allowance is derived at read
-- time from `sort_order`, so a downgrade is non-destructive and an upgrade
-- restores eligibility automatically.
--
-- Discover surfaces themselves (profile, nearby, swipe) are NOT part of this
-- migration or this PR.

CREATE FUNCTION "discover_set_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Per-salon Portfolio photo limit override. NULL means "use the plan default",
-- mirroring how `salon.max_locations` overrides the plan's location limit.
ALTER TABLE "salon" ADD COLUMN "max_portfolio_photos" integer;
--> statement-breakpoint

CREATE TYPE "discover_service_family" AS ENUM (
  'gel_x',
  'acrylic',
  'builder_gel',
  'hard_gel',
  'polygel',
  'dip_powder',
  'manicure',
  'pedicure',
  'unspecified'
);
--> statement-breakpoint

CREATE TYPE "discover_nail_length" AS ENUM (
  'short',
  'medium',
  'long',
  'xl',
  'unspecified'
);
--> statement-breakpoint

-- Admin-owned moderation, separate from owner intent:
--   allowed      — no moderation action;
--   discover_off — removed from Discover surfaces only, still profile-eligible;
--   disabled     — removed everywhere.
CREATE TYPE "portfolio_moderation_state" AS ENUM (
  'allowed',
  'discover_off',
  'disabled'
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- salon_portfolio_photo — the canonical portfolio. One library per business,
-- serving the owner's profile grid today and (in later PRs) Discover surfaces.
--
-- Every non-deleted row consumes one slot of the business's Portfolio photo
-- limit, regardless of visibility or Discover inclusion: the limit is storage
-- capacity, never an exposure or ranking allowance.
-- ---------------------------------------------------------------------------
CREATE TABLE "salon_portfolio_photo" (
  "id" text PRIMARY KEY NOT NULL,
  "public_id" text NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "location_id" text REFERENCES "salon_location"("id") ON DELETE SET NULL,
  "technician_id" text REFERENCES "technician"("id") ON DELETE SET NULL,

  "cloudinary_public_id" text NOT NULL,
  "image_url" text NOT NULL,
  "original_width" integer NOT NULL,
  "original_height" integer NOT NULL,
  "mime_type" text NOT NULL,
  "file_size_bytes" integer NOT NULL,

  "sort_order" integer DEFAULT 0 NOT NULL,

  -- Owner intent. Never rewritten by plan changes.
  "owner_visible" boolean DEFAULT true NOT NULL,
  "discover_included" boolean DEFAULT true NOT NULL,

  "service_family" "discover_service_family" DEFAULT 'unspecified' NOT NULL,
  "nail_length" "discover_nail_length" DEFAULT 'unspecified' NOT NULL,

  -- Normalized crop rectangle and focal point, as fractions of the original.
  "crop_x" numeric(6, 5),
  "crop_y" numeric(6, 5),
  "crop_width" numeric(6, 5),
  "crop_height" numeric(6, 5),
  "focal_x" numeric(6, 5),
  "focal_y" numeric(6, 5),

  "alt_text" text,

  "moderation_state" "portfolio_moderation_state" DEFAULT 'allowed' NOT NULL,

  -- Durable publication-rights evidence: who confirmed, when, and against
  -- which version of the confirmation text.
  "publication_rights_confirmed_at" timestamp with time zone NOT NULL,
  "publication_rights_confirmed_by" text NOT NULL,
  "publication_rights_version" text NOT NULL,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,

  CONSTRAINT "salon_portfolio_photo_dimensions_positive"
    CHECK ("original_width" > 0 AND "original_height" > 0),
  CONSTRAINT "salon_portfolio_photo_file_size_positive"
    CHECK ("file_size_bytes" > 0),
  -- Crop is stored as normalized fractions; a partially-set crop is not a
  -- usable crop, so all four rectangle components move together.
  CONSTRAINT "salon_portfolio_photo_crop_complete" CHECK (
    (
      "crop_x" IS NULL AND "crop_y" IS NULL
      AND "crop_width" IS NULL AND "crop_height" IS NULL
    )
    OR (
      "crop_x" IS NOT NULL AND "crop_y" IS NOT NULL
      AND "crop_width" IS NOT NULL AND "crop_height" IS NOT NULL
      AND "crop_x" >= 0 AND "crop_y" >= 0
      AND "crop_width" > 0 AND "crop_height" > 0
      AND "crop_x" + "crop_width" <= 1
      AND "crop_y" + "crop_height" <= 1
    )
  ),
  CONSTRAINT "salon_portfolio_photo_focal_bounds" CHECK (
    ("focal_x" IS NULL AND "focal_y" IS NULL)
    OR (
      "focal_x" IS NOT NULL AND "focal_y" IS NOT NULL
      AND "focal_x" >= 0 AND "focal_x" <= 1
      AND "focal_y" >= 0 AND "focal_y" <= 1
    )
  )
);
--> statement-breakpoint

CREATE UNIQUE INDEX "salon_portfolio_photo_public_id_idx"
  ON "salon_portfolio_photo" ("public_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "salon_portfolio_photo_cloudinary_idx"
  ON "salon_portfolio_photo" ("cloudinary_public_id");
--> statement-breakpoint
CREATE INDEX "salon_portfolio_photo_salon_idx"
  ON "salon_portfolio_photo" ("salon_id");
--> statement-breakpoint
CREATE INDEX "salon_portfolio_photo_salon_order_idx"
  ON "salon_portfolio_photo" ("salon_id", "sort_order");
--> statement-breakpoint
CREATE INDEX "salon_portfolio_photo_location_idx"
  ON "salon_portfolio_photo" ("location_id");
--> statement-breakpoint
CREATE INDEX "salon_portfolio_photo_technician_idx"
  ON "salon_portfolio_photo" ("technician_id");
--> statement-breakpoint

CREATE TRIGGER "salon_portfolio_photo_set_updated_at"
BEFORE UPDATE ON "salon_portfolio_photo"
FOR EACH ROW EXECUTE FUNCTION "discover_set_updated_at"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- salon_discover_settings — business-level Discover participation.
--
-- An absent row means "not enabled". Existing businesses are opted out by
-- default and no existing content is published without consent. Admin
-- suspension is independent of the owner toggle and never affects the salon's
-- booking page.
-- ---------------------------------------------------------------------------
CREATE TABLE "salon_discover_settings" (
  "salon_id" text PRIMARY KEY NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "discover_enabled" boolean DEFAULT false NOT NULL,
  "admin_suspended_at" timestamp with time zone,
  "admin_suspended_reason" text,
  "updated_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TRIGGER "salon_discover_settings_set_updated_at"
BEFORE UPDATE ON "salon_discover_settings"
FOR EACH ROW EXECUTE FUNCTION "discover_set_updated_at"();
