-- 0072_l1_catalog_foundation.sql
--
-- Luster L1 — PR1, dark catalog-domain foundation.
--
-- Adds the schema surface that service variants, booking modes and the
-- request lifecycle will later use. Everything here is INERT: every column is
-- nullable with no default, nothing is backfilled, no existing row changes
-- meaning, and the feature keys that would activate any of it ship OFF. A
-- salon's behaviour on the day after this migration is identical to the day
-- before.
--
-- Legacy rows keep NULL in every new column and are therefore untouched by
-- each CHECK below, all of which are written to pass on NULL.
--
-- This migration deliberately does NOT touch the Discover portfolio schema
-- from 0071, deposits, billing, communications, or any public rendering path.

-- ---------------------------------------------------------------------------
-- service — variant identity and booking modes
-- ---------------------------------------------------------------------------
ALTER TABLE "service" ADD COLUMN "parent_service_id" text;
--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "variant_label" text;
--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "variant_kind" text;
--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "selection_mode" text;
--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "confirmation_mode" text;
--> statement-breakpoint

-- Tenant identity for the composite parent reference below. `id` is already
-- unique on its own as the primary key; this pair exists so a foreign key can
-- carry `salon_id` through it, which is what makes the parent link
-- tenant-safe rather than merely referentially valid.
ALTER TABLE "service"
  ADD CONSTRAINT "service_salon_id_id_key" UNIQUE ("salon_id", "id");
--> statement-breakpoint

-- A variant's parent must belong to the SAME salon. Carrying `salon_id` in
-- both sides of the foreign key makes a cross-tenant parent unrepresentable
-- at the database level, rather than something application code has to
-- remember to check on every write path.
--
-- MATCH SIMPLE (the default) means the constraint is satisfied whenever any
-- referencing column is NULL, so every existing row — all of which have a
-- NULL parent — remains valid without a backfill.
--
-- NO ACTION on delete and update is deliberate: a parent with variants cannot
-- be silently deleted, and unlinking a variant stays an explicit application
-- operation rather than a cascade side effect. A composite ON DELETE SET NULL
-- would null `salon_id` too, which must never happen.
ALTER TABLE "service"
  ADD CONSTRAINT "service_parent_service_salon_fk"
  FOREIGN KEY ("salon_id", "parent_service_id")
  REFERENCES "service" ("salon_id", "id")
  ON UPDATE NO ACTION ON DELETE NO ACTION;
--> statement-breakpoint

-- Referencing side of the parent link is not indexed automatically. All rows
-- are NULL today so this costs nothing to create, and it keeps the eventual
-- parent lookups and delete checks from degrading to sequential scans.
CREATE INDEX "service_parent_service_idx"
  ON "service" ("salon_id", "parent_service_id")
  WHERE "parent_service_id" IS NOT NULL;
--> statement-breakpoint

-- Bounded vocabularies. Written as `IS NULL OR ...` so legacy rows pass.
ALTER TABLE "service"
  ADD CONSTRAINT "service_selection_mode_check"
  CHECK ("selection_mode" IS NULL OR "selection_mode" IN ('direct', 'guided'));
--> statement-breakpoint
ALTER TABLE "service"
  ADD CONSTRAINT "service_confirmation_mode_check"
  CHECK (
    "confirmation_mode" IS NULL
    OR "confirmation_mode" IN ('instant', 'request_approval', 'consultation')
  );
--> statement-breakpoint

-- A child (a service with a parent) must carry the label that distinguishes it
-- from its siblings — an unlabelled variant is not addressable.
ALTER TABLE "service"
  ADD CONSTRAINT "service_variant_child_requires_label_check"
  CHECK ("parent_service_id" IS NULL OR "variant_label" IS NOT NULL);
--> statement-breakpoint

-- `variant_kind` describes how a PARENT's children vary (by length, by shape,
-- …). A child does not redefine the axis it sits on, so it must not carry one.
ALTER TABLE "service"
  ADD CONSTRAINT "service_variant_child_forbids_kind_check"
  CHECK ("parent_service_id" IS NULL OR "variant_kind" IS NULL);
--> statement-breakpoint

-- A service cannot be its own parent.
ALTER TABLE "service"
  ADD CONSTRAINT "service_no_self_parent_check"
  CHECK ("parent_service_id" IS NULL OR "parent_service_id" <> "id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- appointment — booking-mode snapshots and the request lifecycle field
-- ---------------------------------------------------------------------------
-- Snapshots, like the existing price/duration snapshots on
-- appointment_services: an appointment renders from what was true when it was
-- booked, not from the live service row.
ALTER TABLE "appointment" ADD COLUMN "selection_mode_snapshot" text;
--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "confirmation_mode_snapshot" text;
--> statement-breakpoint

-- timestamptz: an expiry deadline is an absolute instant, and salons that
-- later span time zones must not disagree about when a request lapsed.
-- Nothing reads or writes this yet; no expiry behaviour is activated.
ALTER TABLE "appointment" ADD COLUMN "request_expires_at" timestamp with time zone;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- appointment_services — variant snapshots
-- ---------------------------------------------------------------------------
ALTER TABLE "appointment_services" ADD COLUMN "variant_label_snapshot" text;
--> statement-breakpoint
ALTER TABLE "appointment_services" ADD COLUMN "variant_kind_snapshot" text;
