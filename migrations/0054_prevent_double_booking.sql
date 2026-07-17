-- Double-booking backstop.
-- The booking route re-validates availability inside its transaction (behind a
-- per-technician advisory lock); these constraints are the database-level
-- guarantee in case any write path skips that guard.

-- 1) No two active appointments may share the same technician and start time.
--    Cancelled / no-show / completed / soft-deleted rows stay bookable-over.
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_tech_active_slot_unique"
ON "appointment" ("technician_id", "start_time")
WHERE "status" IN ('pending', 'confirmed', 'in_progress')
  AND "deleted_at" IS NULL
  AND "technician_id" IS NOT NULL;
--> statement-breakpoint


-- 2) Best-effort stronger guarantee: reject any overlapping active
--    appointments for the same technician. Uses [start_time, end_time) only —
--    buffer arithmetic is not immutable, so buffered overlap remains the
--    transaction guard's job. Skipped gracefully where btree_gist is
--    unavailable (e.g. PGlite) or where pre-existing rows still overlap;
--    `npm run db:verify:booking-constraints` reports the actual state.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  ALTER TABLE "appointment"
    ADD CONSTRAINT "appointment_tech_active_no_overlap"
    EXCLUDE USING gist (
      "technician_id" WITH =,
      tstzrange("start_time", "end_time", '[)') WITH &&
    )
    WHERE ("status" IN ('pending', 'confirmed', 'in_progress') AND "deleted_at" IS NULL AND "technician_id" IS NOT NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN others THEN RAISE NOTICE 'Skipping appointment overlap exclusion constraint: %', SQLERRM;
END $$;
