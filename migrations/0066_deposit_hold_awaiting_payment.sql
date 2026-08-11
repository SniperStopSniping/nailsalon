-- Deposit holds: the appointment row IS the hold.
--
-- A client-initiated booking at a deposits-enabled salon commits its appointment
-- in a new status `awaiting_payment` inside the existing guarded booking
-- transaction, and the Stripe Checkout Session is created strictly after that
-- commit. There is no `booking_hold` table and no Redis slot lock: a hold is
-- exactly `status = 'awaiting_payment' AND deleted_at IS NULL`, with
-- `deposit_hold_expires_at` set.
--
-- A hold must therefore occupy the slot exactly as `pending` does, which means
-- BOTH double-booking backstops from 0054 have to be recreated with the widened
-- status predicate. The constant `BLOCKING_APPOINTMENT_STATUSES` and these two
-- predicates are machine-checked against each other by
-- `src/libs/bookingBlockingStatuses.test.ts`, which resolves the LATEST
-- migration defining them — this one.
--
-- Forward-only. There is no down migration.

ALTER TABLE "appointment" ADD COLUMN "deposit_hold_expires_at" timestamptz;
--> statement-breakpoint

-- 1) Recreate 0054's partial unique index with 'awaiting_payment' added.
--
-- DELIBERATELY OUTSIDE ANY `DO` BLOCK: a failure here must abort the migration.
-- Dropping the production double-booking backstop and then swallowing the
-- failure of its replacement is the exact outcome this placement forecloses.
DROP INDEX IF EXISTS "appointment_tech_active_slot_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_tech_active_slot_unique"
ON "appointment" ("technician_id", "start_time")
WHERE "status" IN ('pending', 'confirmed', 'in_progress', 'awaiting_payment')
  AND "deleted_at" IS NULL
  AND "technician_id" IS NOT NULL;
--> statement-breakpoint

-- 2) Recreate 0054's best-effort gist exclusion with the same widened predicate.
--
-- `CREATE EXTENSION` MUST be the first statement in the block. The whole vitest
-- suite bootstraps PGlite through every migration (`src/libs/DB.ts`), and PGlite
-- ships no `btree_gist`: with the CREATE EXTENSION first, PGlite raises
-- SQLSTATE 0A000 (feature_not_supported), this handler fires, and the block ends
-- before the ALTER runs. Without it the ALTER raises SQLSTATE 42704
-- (undefined_object, "data type text has no default operator class for access
-- method gist"), the migration aborts, and EVERY test in the repository fails.
--
-- The handler is deliberately NARROWED — no `WHEN others`. 0054 used
-- `WHEN others THEN RAISE NOTICE`, and RAISE NOTICE does not abort the
-- transaction, so a swallowed ADD failure would commit the DROP above and
-- silently delete the production overlap backstop. Anything not listed here
-- propagates and aborts the migration; PL/pgSQL rolls the block back as a unit,
-- so the pre-existing constraint is restored rather than the table left
-- unprotected.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  ALTER TABLE "appointment" DROP CONSTRAINT IF EXISTS "appointment_tech_active_no_overlap";
  ALTER TABLE "appointment"
    ADD CONSTRAINT "appointment_tech_active_no_overlap"
    EXCLUDE USING gist (
      "technician_id" WITH =,
      tstzrange("start_time", "end_time", '[)') WITH &&
    )
    WHERE ("status" IN ('pending', 'confirmed', 'in_progress', 'awaiting_payment') AND "deleted_at" IS NULL AND "technician_id" IS NOT NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN feature_not_supported THEN RAISE NOTICE 'btree_gist unsupported; skipping exclusion constraint';
  WHEN undefined_file THEN RAISE NOTICE 'btree_gist control file absent; skipping exclusion constraint';
  WHEN undefined_object THEN RAISE NOTICE 'no gist operator class; skipping exclusion constraint';
  WHEN insufficient_privilege THEN RAISE NOTICE 'cannot install btree_gist; skipping exclusion constraint';
END $$;
--> statement-breakpoint

-- 3) Where btree_gist really is installed, the exclusion constraint MUST exist
--    after the recreate. This turns a real (non-gist) failure into a loud abort
--    instead of a silently dropped backstop.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid = 'appointment'::regclass
                       AND conname = 'appointment_tech_active_no_overlap')
  THEN RAISE EXCEPTION 'appointment_tech_active_no_overlap missing after recreate';
  END IF;
END $$;
--> statement-breakpoint

-- 4) Reaper support. The existing `appointment_status_idx (salon_id, status)`
--    does not serve the reaper's cross-salon, expiry-ordered scan.
CREATE INDEX IF NOT EXISTS "appointment_awaiting_payment_expiry_idx" ON "appointment"
("deposit_hold_expires_at") WHERE "status" = 'awaiting_payment';
