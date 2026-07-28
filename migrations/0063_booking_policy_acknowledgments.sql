-- Append-only booking-policy acknowledgment history for public booking
-- attempts. Existing appointments require no backfill. This migration only
-- creates storage; public-reschedule writes remain reserved for a later
-- release.

-- A composite parent key lets the acknowledgment foreign key prove that the
-- appointment belongs to the same salon recorded on the snapshot.
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_salon_id_id_idx"
  ON "appointment" ("salon_id", "id");
--> statement-breakpoint

CREATE TABLE "appointment_booking_policy_acknowledgment" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL,
  "appointment_id" text NOT NULL,
  "policy_version" text NOT NULL,
  "policy_title_snapshot" text NOT NULL,
  "policy_text_snapshot" text NOT NULL,
  "acknowledgment_text_snapshot" text NOT NULL,
  "source" text NOT NULL,
  "scheduled_start_at_snapshot" timestamp with time zone NOT NULL,
  "scheduled_end_at_snapshot" timestamp with time zone NOT NULL,
  "attempt_id" uuid NOT NULL,
  "request_hash" text NOT NULL,
  "appointment_updated_at_snapshot" timestamp with time zone NOT NULL,
  "reservation_revision_snapshot" integer,
  "acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "appointment_booking_policy_ack_source_valid"
    CHECK ("source" IN ('public_booking', 'public_reschedule')),
  CONSTRAINT "appointment_booking_policy_ack_version_valid"
    CHECK ("policy_version" ~ '^policy-v1:[0-9a-f]{64}$'),
  CONSTRAINT "appointment_booking_policy_ack_title_valid"
    CHECK (
      char_length("policy_title_snapshot") BETWEEN 1 AND 60
      AND char_length(btrim("policy_title_snapshot")) > 0
    ),
  CONSTRAINT "appointment_booking_policy_ack_policy_text_valid"
    CHECK (
      char_length("policy_text_snapshot") BETWEEN 1 AND 1500
      AND char_length(btrim("policy_text_snapshot")) > 0
    ),
  CONSTRAINT "appointment_booking_policy_ack_text_valid"
    CHECK (
      char_length("acknowledgment_text_snapshot") BETWEEN 1 AND 220
      AND char_length(btrim("acknowledgment_text_snapshot")) > 0
    ),
  CONSTRAINT "appointment_booking_policy_ack_request_hash_valid"
    CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "appointment_booking_policy_ack_schedule_valid"
    CHECK ("scheduled_end_at_snapshot" > "scheduled_start_at_snapshot"),
  CONSTRAINT "appointment_booking_policy_ack_revision_valid"
    CHECK (
      "reservation_revision_snapshot" IS NULL
      OR "reservation_revision_snapshot" >= 0
    ),
  CONSTRAINT "appointment_booking_policy_ack_salon_fk"
    FOREIGN KEY ("salon_id")
    REFERENCES "salon"("id")
    ON DELETE CASCADE,
  CONSTRAINT "appointment_booking_policy_ack_appointment_fk"
    FOREIGN KEY ("salon_id", "appointment_id")
    REFERENCES "appointment"("salon_id", "id")
    ON DELETE CASCADE
);
--> statement-breakpoint

-- This is the sole acknowledgment dedupe authority: one logical attempt UUID
-- can be attached to only one appointment in a salon/source. A second
-- four-column unique constraint would be strictly weaker and redundant.
CREATE UNIQUE INDEX "booking_policy_ack_attempt_unique"
  ON "appointment_booking_policy_acknowledgment"
    ("salon_id", "source", "attempt_id");
--> statement-breakpoint

-- Supports appointment history and exact schedule-snapshot lookup without
-- conflating timestamps with reservation identity.
CREATE INDEX "appointment_booking_policy_ack_history_idx"
  ON "appointment_booking_policy_acknowledgment" (
    "salon_id",
    "appointment_id",
    "source",
    "scheduled_start_at_snapshot",
    "scheduled_end_at_snapshot",
    "acknowledged_at"
  );
