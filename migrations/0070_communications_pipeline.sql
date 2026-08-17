-- 0070_communications_pipeline.sql
--
-- Gate B / B2 — Migration B of the Luster billing & communications track.
-- Governing contract: docs/luster-billing-communications-rev-2-2.md §9-§11.
--
-- Creates the durable communication pipeline: communication intents with
-- leases and notAfter, the global shared-sender consent event log (keyed on
-- the LOGICAL sender identity + recipient, deliberately salon-free), the
-- minimal no-body inbound event record, the default-off platform
-- communication control singleton, and the NULL-permissive extensions to
-- notification_delivery (legacy email and live BYO rows must keep working
-- untouched — every new column is nullable, no backfill).
--
-- Short management links deliberately create NO new table: they alias the
-- existing appointment_access_token capability (digest-only storage,
-- expiry/revocation/scoping unchanged) — one authorization model, not two.
--
-- Everything here is DARK: the dispatcher route requires CRON_SECRET, the
-- platform control row ships disabled, and the shared sender still requires
-- COMMUNICATIONS_SMS_ENABLED plus this control row plus credits.

CREATE FUNCTION "comms_set_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- communication_intent — WHAT should be said, to whom, when, and whether it
-- is still true. Owns scheduling, relevance, quiet-hours decisions (Gate C),
-- notAfter, credit-reservation linkage and supersession. The provider
-- attempt itself lives on notification_delivery.
-- ---------------------------------------------------------------------------
CREATE TABLE "communication_intent" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "appointment_id" text REFERENCES "appointment"("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  "event_type" text NOT NULL,
  "audience" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "recipient" text NOT NULL,
  "destination_country" text,
  "template_key" text NOT NULL,
  "template_version" text NOT NULL,
  "variables" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "rule_id" text,
  "start_revision" text,
  "scheduling_revision" text NOT NULL,
  "body_snapshot" text,
  "body_fingerprint" text,
  "segment_count" integer,
  "encoding" text,
  "status" text NOT NULL DEFAULT 'pending',
  "scheduled_for" timestamptz NOT NULL,
  "not_after" timestamptz NOT NULL,
  "available_at" timestamptz NOT NULL DEFAULT now(),
  "attempts" integer NOT NULL DEFAULT 0,
  "locked_by" text,
  "lease_expires_at" timestamptz,
  "delivery_id" text REFERENCES "notification_delivery"("id") ON DELETE SET NULL,
  "credit_reservation_id" text REFERENCES "sms_credit_reservation"("id") ON DELETE SET NULL,
  "required_credits" integer,
  "blocked_reason" text,
  "blocked_at" timestamptz,
  "superseded_by_intent_id" text,
  "resolved_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "communication_intent_channel_valid" CHECK ("channel" IN ('sms', 'email')),
  CONSTRAINT "communication_intent_audience_valid"
    CHECK ("audience" IN ('client', 'owner', 'technician')),
  -- send_outcome_unknown is a first-class status: the reaper skip predicate
  -- and the never-resend rule both key on it. There is NO transition from
  -- send_outcome_unknown back to pending anywhere.
  CONSTRAINT "communication_intent_status_valid"
    CHECK ("status" IN ('pending', 'claimed', 'sending', 'sent', 'send_outcome_unknown',
                        'failed', 'canceled', 'suppressed', 'expired', 'blocked_no_credit')),
  -- Two-letter uppercase country snapshot; the CA-only pilot restriction is
  -- policy (§9.5), not storage — DESTINATION_NOT_SUPPORTED must be
  -- representable.
  CONSTRAINT "communication_intent_country_shape"
    CHECK ("destination_country" IS NULL
           OR ("destination_country" = upper("destination_country")
               AND char_length("destination_country") = 2)),
  CONSTRAINT "communication_intent_window_ordered" CHECK ("not_after" > "scheduled_for"),
  CONSTRAINT "communication_intent_attempts_nonnegative" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "communication_intent_dedupe_uniq" ON "communication_intent" ("dedupe_key");
--> statement-breakpoint
-- The dispatcher's hot claim query; partial so terminal rows are never rescanned.
CREATE INDEX "communication_intent_due_idx"
  ON "communication_intent" ("available_at", "scheduled_for")
  WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX "communication_intent_lease_idx"
  ON "communication_intent" ("lease_expires_at")
  WHERE "status" IN ('claimed', 'sending');
--> statement-breakpoint
CREATE INDEX "communication_intent_salon_idx"
  ON "communication_intent" ("salon_id", "status", "scheduled_for");
--> statement-breakpoint
CREATE INDEX "communication_intent_appointment_idx"
  ON "communication_intent" ("salon_id", "appointment_id", "status");
--> statement-breakpoint
CREATE TRIGGER "communication_intent_touch" BEFORE UPDATE ON "communication_intent"
  FOR EACH ROW EXECUTE FUNCTION "comms_set_updated_at"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- sms_global_consent_event — the shared-sender global opt-out log. Keyed on
-- (sender_identity, recipient): the LOGICAL Luster sender, never the phone
-- number and never a Messaging Service SID, so a future toll-free swap
-- preserves every opt-out. DELIBERATELY has no salon column: a consumer's
-- opt-out must outlive any tenant, so this table is absent from the salon
-- purge plan and from the incoming-FK ledger by design. Append-only; the
-- current state is the highest seq. seq is the ordering authority (clock
-- skew across serverless instances makes created_at untrustworthy).
-- ---------------------------------------------------------------------------
CREATE TABLE "sms_global_consent_event" (
  "id" text PRIMARY KEY NOT NULL,
  "seq" bigint GENERATED ALWAYS AS IDENTITY,
  "sender_identity" text NOT NULL,
  "recipient" text NOT NULL,
  "state" text NOT NULL,
  "keyword_classification" text,
  "opt_out_type" text,
  "source" text NOT NULL,
  "provider_sid" text,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sms_global_consent_event_state_valid" CHECK ("state" IN ('suppressed', 'restored')),
  CONSTRAINT "sms_global_consent_event_source_valid"
    CHECK ("source" IN ('twilio_inbound', 'twilio_advanced_opt_out', 'operator', 'import'))
);
--> statement-breakpoint
CREATE INDEX "sms_global_consent_recipient_idx"
  ON "sms_global_consent_event" ("sender_identity", "recipient", "seq" DESC);
--> statement-breakpoint
-- Inbound webhook retries must be idempotent.
CREATE UNIQUE INDEX "sms_global_consent_provider_sid_uniq"
  ON "sms_global_consent_event" ("provider_sid")
  WHERE "provider_sid" IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION "sms_global_consent_forbid_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sms_global_consent_event is append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "sms_global_consent_immutable" BEFORE UPDATE ON "sms_global_consent_event"
  FOR EACH ROW EXECUTE FUNCTION "sms_global_consent_forbid_update"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- sms_inbound_event — minimal inbound evidence. NO BODY COLUMN AND NO
-- METADATA JSONB, EVER (contract §10.7): only a keyword classification and a
-- body-present indicator. attributed_salon_id is SET NULL (an incoming salon
-- FK, so it IS in the FK ledger and gets a purge null-out step).
-- ---------------------------------------------------------------------------
CREATE TABLE "sms_inbound_event" (
  "id" text PRIMARY KEY NOT NULL,
  "attributed_salon_id" text REFERENCES "salon"("id") ON DELETE SET NULL,
  "sender_identity" text,
  "from_recipient" text NOT NULL,
  "to_number" text NOT NULL,
  "keyword_classification" text NOT NULL,
  "attribution_state" text NOT NULL,
  "body_present" boolean NOT NULL,
  "segment_count" integer,
  "provider_price_raw" numeric,
  "provider_currency" text,
  "provider_sid" text NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sms_inbound_event_keyword_valid"
    CHECK ("keyword_classification" IN ('stop', 'start', 'help', 'cancel', 'other')),
  CONSTRAINT "sms_inbound_event_attribution_valid"
    CHECK ("attribution_state" IN ('attributed', 'unattributed', 'ambiguous'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sms_inbound_event_provider_sid_uniq" ON "sms_inbound_event" ("provider_sid");
--> statement-breakpoint
-- The 90-day retention sweep scans by age.
CREATE INDEX "sms_inbound_event_received_idx" ON "sms_inbound_event" ("received_at");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- platform_communication_control — the operator kill-switch singleton.
-- Ships DISABLED: sms_enabled defaults false and the seeded row makes the
-- default-off state durable, so a deploy alone can never enable sending
-- (contract §20 step 11 — enabling this row is the FINAL send-enabling
-- action, after every other switch).
-- ---------------------------------------------------------------------------
CREATE TABLE "platform_communication_control" (
  "id" text PRIMARY KEY NOT NULL,
  "sms_enabled" boolean NOT NULL DEFAULT false,
  "disabled_event_types" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "dispatch_batch_limit" integer NOT NULL DEFAULT 100,
  "per_salon_batch_limit" integer NOT NULL DEFAULT 1,
  "daily_send_limit" integer NOT NULL DEFAULT 5000,
  "daily_anomaly_threshold" integer NOT NULL DEFAULT 250,
  "updated_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "platform_communication_control_singleton" CHECK ("id" = 'singleton')
);
--> statement-breakpoint
INSERT INTO "platform_communication_control" ("id") VALUES ('singleton');
--> statement-breakpoint
CREATE TRIGGER "platform_communication_control_touch" BEFORE UPDATE ON "platform_communication_control"
  FOR EACH ROW EXECUTE FUNCTION "comms_set_updated_at"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- notification_delivery extensions — every column NULLABLE with no backfill:
-- the table already holds every historic email and live BYO SMS row, and a
-- NOT NULL DEFAULT would retro-classify them into the new settlement and
-- reconciliation sweeps. status_rank stays NULL on legacy rows; the callback
-- guard accepts NULL-rank rows exactly once (matching today's blind
-- overwrite) and then enforces monotonic ordering. Money fields are exact
-- types (numeric / bigint), never floats.
-- ---------------------------------------------------------------------------
ALTER TABLE "notification_delivery" ADD COLUMN "intent_id" text;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "credit_reservation_id" text;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "segment_count" integer;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "encoding" text;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "sender_identity" text;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "messaging_service_sid" text;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "status_rank" integer;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "settlement_state" text;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "settled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "provider_price_raw" numeric;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "provider_currency" text;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "provider_segments" integer;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "fx_rate" numeric;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "fx_rate_source" text;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "fx_converted_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "provider_cost_cad_micros" bigint;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "anomaly_code" text;
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "reconciled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "notification_delivery"
  ADD CONSTRAINT "notification_delivery_settlement_valid"
  CHECK ("settlement_state" IS NULL
         OR "settlement_state" IN ('settling', 'settled', 'refunded', 'released', 'not_applicable'));
--> statement-breakpoint
-- Reconciliation sweep: SMS rows with a provider SID not yet reconciled.
CREATE INDEX "notification_delivery_reconcile_idx"
  ON "notification_delivery" ("reconciled_at", "created_at")
  WHERE "channel" = 'sms' AND "provider_message_id" IS NOT NULL AND "reconciled_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "notification_delivery_settlement_idx"
  ON "notification_delivery" ("settlement_state", "updated_at")
  WHERE "settlement_state" IN ('settling');
