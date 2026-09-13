-- Disabled by default. No appointment scan, backfill, or message producer.
ALTER TABLE salon_client ADD COLUMN review_requests_suppressed boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE salon_client ADD COLUMN review_requests_eligible_after timestamptz;
--> statement-breakpoint
ALTER TABLE salon_retention_settings ADD COLUMN automatic_review_requests boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE salon_retention_settings ADD COLUMN review_requests_enabled_at timestamptz;
--> statement-breakpoint
ALTER TABLE salon_retention_settings ADD COLUMN review_request_delay_minutes integer NOT NULL DEFAULT 60 CHECK (review_request_delay_minutes BETWEEN 0 AND 10080);
--> statement-breakpoint
ALTER TABLE salon_retention_settings ADD COLUMN review_request_message text;
--> statement-breakpoint
-- IDs intentionally retain business evidence after a client/appointment is removed.
-- Eligibility always requires a current same-salon client AND appointment.
CREATE TABLE review_request (
 id text PRIMARY KEY,
 salon_id text NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
 client_id text NOT NULL,
 appointment_id text,
 recipient text NOT NULL,
 source text NOT NULL CHECK (source IN ('automatic','manual')),
 status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled')),
 intent_id text NOT NULL UNIQUE,
 completed_at timestamptz NOT NULL,
 scheduled_for timestamptz NOT NULL,
 cancelled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX review_request_client_once ON review_request(salon_id, client_id) WHERE status <> 'cancelled';
--> statement-breakpoint
CREATE UNIQUE INDEX review_request_phone_once ON review_request(salon_id, recipient) WHERE status <> 'cancelled';
--> statement-breakpoint
