-- Appointment timestamps were originally created as `timestamp without time zone`.
-- Luster has always written UTC wall-clock values from its hosted runtime, so
-- reinterpret those existing values as UTC while changing the columns to
-- timezone-aware instants. This preserves every existing appointment time.
-- Keep a PII-free rollback snapshot inside the database before changing types.
CREATE TABLE IF NOT EXISTS "luster_migration_backup_0052_appointment_times" AS
SELECT
  "id",
  "start_time",
  "end_time",
  "discount_applied_at",
  "started_at",
  "completed_at",
  "locked_at",
  "arrived_at",
  "review_followup_sent_at",
  "created_at",
  "updated_at",
  now() AS "backed_up_at"
FROM "appointment";

CREATE TABLE IF NOT EXISTS "luster_migration_backup_0052_client_times" AS
SELECT
  "id",
  "last_visit_at",
  "last_late_cancel_at",
  now() AS "backed_up_at"
FROM "salon_client";

ALTER TABLE "appointment"
  ALTER COLUMN "start_time" TYPE timestamp with time zone USING "start_time" AT TIME ZONE 'UTC',
  ALTER COLUMN "end_time" TYPE timestamp with time zone USING "end_time" AT TIME ZONE 'UTC',
  ALTER COLUMN "discount_applied_at" TYPE timestamp with time zone USING "discount_applied_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "started_at" TYPE timestamp with time zone USING "started_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "completed_at" TYPE timestamp with time zone USING "completed_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "locked_at" TYPE timestamp with time zone USING "locked_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "arrived_at" TYPE timestamp with time zone USING "arrived_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "review_followup_sent_at" TYPE timestamp with time zone USING "review_followup_sent_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';

-- CRM visit timestamps are appointment-derived instants and need the same
-- semantics so rebooking dates remain stable outside a UTC process.
ALTER TABLE "salon_client"
  ALTER COLUMN "last_visit_at" TYPE timestamp with time zone USING "last_visit_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "last_late_cancel_at" TYPE timestamp with time zone USING "last_late_cancel_at" AT TIME ZONE 'UTC';
