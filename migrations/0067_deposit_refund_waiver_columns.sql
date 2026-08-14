-- Refund lifecycle, reconciliation, waiver provenance, and provider-health
-- state for appointment deposits. Forward-only; every statement is safe to
-- replay against a database where this migration has already completed.

ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "refund_status" text;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "refund_status_changed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "refund_amount_cents" integer;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "prior_refund_ids" text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "refund_reconcile_attempts" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "refund_reconcile_claimed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "refund_requested_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "refund_requested_by" text;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "refund_requested_by_role" text;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "refund_trigger" text;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "refund_requested_env" text;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "refund_last_error_code" text;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "refund_failure_reason" text;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "external_refund_observed_cents" integer;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "refund_conflict_flag" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "refund_requested_impersonated" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "waived_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "waived_by" text;
--> statement-breakpoint
ALTER TABLE "appointment_deposit" ADD COLUMN IF NOT EXISTS "waiver_reason" text;
--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "appointment_deposit"
    ADD CONSTRAINT "appointment_deposit_refund_status_valid"
    CHECK (
      "refund_status" IS NULL
      OR "refund_status" IN ('requested', 'pending', 'succeeded', 'failed')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "appointment_deposit"
    ADD CONSTRAINT "appointment_deposit_refund_status_stamped"
    CHECK ("refund_status" IS NULL OR "refund_status_changed_at" IS NOT NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "appointment_deposit"
    ADD CONSTRAINT "appointment_deposit_refund_error_code_valid"
    CHECK (
      "refund_last_error_code" IS NULL
      OR "refund_last_error_code" = ANY (ARRAY[
        'charge_disputed',
        'refund_disputed_payment',
        'charge_already_refunded',
        'rate_limit',
        'lock_timeout',
        'idempotency_key_in_use',
        'platform_api_key_expired',
        'account_invalid',
        'livemode_mismatch',
        'ACCOUNT_DISCONNECTED',
        'ACCOUNT_REBOUND',
        'UNKNOWN_PROVIDER_ERROR'
      ])
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "appointment_deposit"
    ADD CONSTRAINT "appointment_deposit_refund_failure_reason_valid"
    CHECK (
      "refund_failure_reason" IS NULL
      OR "refund_failure_reason" = ANY (ARRAY[
        'charge_for_pending_refund_disputed',
        'declined',
        'expired_or_canceled_card',
        'insufficient_funds',
        'lost_or_stolen_card',
        'merchant_request',
        'unknown'
      ])
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "appointment_deposit_refund_open_idx"
  ON "appointment_deposit" ("refund_status", "refund_status_changed_at")
  WHERE "refund_status" IN ('requested', 'pending');
--> statement-breakpoint

UPDATE "appointment_deposit"
SET
  "refund_status" = 'pending',
  "refund_status_changed_at" = COALESCE("refunded_at", "updated_at", now())
WHERE "status" = 'refunded'
  AND "stripe_refund_id" IS NOT NULL
  AND "refund_status" IS NULL;
