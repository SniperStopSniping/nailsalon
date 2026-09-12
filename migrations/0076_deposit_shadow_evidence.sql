-- D6-R1 inactive foundation: minimized shadow evidence only.
-- This migration has no provider calls, no backfill, and no foreign key to a
-- live deposit/appointment row. R1 must remain compatible with existing purge
-- and legacy financial ownership until later gates explicitly change them.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint

CREATE TABLE "deposit_shadow_state" (
  "deposit_id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL,
  "appointment_id" text NOT NULL,
  "account" text NOT NULL,
  "livemode" boolean NOT NULL,
  "payment_intent_id" text,
  "charge_id" text,
  "engine" text NOT NULL DEFAULT 'legacy',
  "generation" integer NOT NULL DEFAULT 0,
  "version" integer NOT NULL DEFAULT 0,
  "fence" integer NOT NULL DEFAULT 0,
  "lease_until" timestamptz,
  "next_due_at" timestamptz NOT NULL DEFAULT now(),
  "oldest_unresolved_at" timestamptz DEFAULT now(),
  "last_checked_at" timestamptz,
  "last_claimed_at" timestamptz,
  "last_complete_at" timestamptz,
  "work_class" text NOT NULL DEFAULT 'discovery',
  "attempts" integer NOT NULL DEFAULT 0,
  "reason" text DEFAULT 'historical_unknown',
  "certificate" jsonb,
  "cursor" jsonb,
  "legacy_fingerprint" text,
  CONSTRAINT "deposit_shadow_state_engine_check" CHECK ("engine" = 'legacy'),
  CONSTRAINT "deposit_shadow_state_generation_check" CHECK ("generation" >= 0),
  CONSTRAINT "deposit_shadow_state_version_check" CHECK ("version" >= 0),
  CONSTRAINT "deposit_shadow_state_fence_check" CHECK ("fence" >= 0),
  CONSTRAINT "deposit_shadow_state_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "deposit_shadow_state_identity_uniq" UNIQUE ("salon_id", "deposit_id", "account", "livemode")
);
--> statement-breakpoint
CREATE INDEX "deposit_shadow_state_fair_due_idx"
  ON "deposit_shadow_state" ("next_due_at", "salon_id", "account", "livemode", "work_class", "deposit_id");
--> statement-breakpoint

CREATE TABLE "deposit_shadow_receipt" (
  "event_id" text PRIMARY KEY NOT NULL,
  "event_type" text NOT NULL,
  "account" text,
  "livemode" boolean NOT NULL,
  "provider_created" bigint,
  "api_version" text,
  "projection" jsonb NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "deposit_id" text,
  "salon_id" text,
  "generation" integer,
  "next_due_at" timestamptz NOT NULL DEFAULT now(),
  "attempts" integer NOT NULL DEFAULT 0,
  "completed_at" timestamptz,
  "reason" text,
  CONSTRAINT "deposit_shadow_receipt_projection_object_check" CHECK (jsonb_typeof("projection") = 'object'),
  CONSTRAINT "deposit_shadow_receipt_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "deposit_shadow_receipt_generation_check" CHECK ("generation" IS NULL OR "generation" >= 0)
);
--> statement-breakpoint
CREATE INDEX "deposit_shadow_receipt_due_idx"
  ON "deposit_shadow_receipt" ("next_due_at", "event_id")
  WHERE "completed_at" IS NULL;
--> statement-breakpoint

CREATE TABLE "deposit_shadow_command" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL,
  "deposit_id" text NOT NULL,
  "account" text NOT NULL,
  "livemode" boolean NOT NULL,
  "payment_intent_id" text,
  "intended_cents" integer,
  "currency" text,
  "requested_at" timestamptz,
  "actor_id" text,
  "actor_role" text,
  "reason" text,
  "source" text NOT NULL DEFAULT 'legacy_import',
  "obligation_state" text NOT NULL DEFAULT 'resolution_required',
  "evidence" jsonb NOT NULL,
  CONSTRAINT "deposit_shadow_command_intended_cents_check" CHECK ("intended_cents" IS NULL OR "intended_cents" > 0),
  CONSTRAINT "deposit_shadow_command_source_check" CHECK ("source" = 'legacy_import'),
  CONSTRAINT "deposit_shadow_command_obligation_state_check"
    CHECK ("obligation_state" IN ('open', 'satisfied_by_verified_returns', 'resolution_required')),
  CONSTRAINT "deposit_shadow_command_evidence_object_check" CHECK (jsonb_typeof("evidence") = 'object'),
  CONSTRAINT "deposit_shadow_command_state_fk"
    FOREIGN KEY ("salon_id", "deposit_id", "account", "livemode")
    REFERENCES "deposit_shadow_state" ("salon_id", "deposit_id", "account", "livemode") ON DELETE RESTRICT
);
--> statement-breakpoint

CREATE TABLE "deposit_shadow_attempt" (
  "id" text PRIMARY KEY NOT NULL,
  "command_id" text NOT NULL REFERENCES "deposit_shadow_command"("id") ON DELETE RESTRICT,
  "ordinal" integer NOT NULL,
  "intended_cents" integer,
  "parameters" jsonb,
  "parameters_digest" text,
  "idempotency_key" text,
  "dispatch_knowledge" text NOT NULL DEFAULT 'unknown',
  "provider_refund_id" text,
  "request_id" text,
  "evidence" jsonb NOT NULL,
  CONSTRAINT "deposit_shadow_attempt_ordinal_check" CHECK ("ordinal" > 0),
  CONSTRAINT "deposit_shadow_attempt_intended_cents_check" CHECK ("intended_cents" IS NULL OR "intended_cents" > 0),
  CONSTRAINT "deposit_shadow_attempt_parameters_object_check" CHECK ("parameters" IS NULL OR jsonb_typeof("parameters") = 'object'),
  CONSTRAINT "deposit_shadow_attempt_evidence_object_check" CHECK (jsonb_typeof("evidence") = 'object'),
  CONSTRAINT "deposit_shadow_attempt_dispatch_knowledge_check" CHECK ("dispatch_knowledge" IN (
    'recorded', 'dispatch_in_progress', 'outcome_unknown', 'provider_pending',
    'provider_requires_action', 'provider_succeeded', 'provider_failed',
    'provider_canceled', 'rejected_before_execution', 'unknown'
  )),
  CONSTRAINT "deposit_shadow_attempt_command_ordinal_uniq" UNIQUE ("command_id", "ordinal")
);
--> statement-breakpoint

CREATE TABLE "deposit_shadow_object" (
  "account" text NOT NULL,
  "livemode" boolean NOT NULL,
  "object_id" text NOT NULL,
  "salon_id" text NOT NULL,
  "deposit_id" text NOT NULL,
  "kind" text NOT NULL,
  "facts" jsonb NOT NULL,
  "version" integer NOT NULL,
  "cycle_id" text,
  CONSTRAINT "deposit_shadow_object_pk" PRIMARY KEY ("account", "livemode", "object_id"),
  CONSTRAINT "deposit_shadow_object_kind_check" CHECK ("kind" IN ('refund', 'charge', 'dispute')),
  CONSTRAINT "deposit_shadow_object_facts_object_check" CHECK (jsonb_typeof("facts") = 'object'),
  CONSTRAINT "deposit_shadow_object_version_check" CHECK ("version" > 0),
  CONSTRAINT "deposit_shadow_object_state_fk"
    FOREIGN KEY ("salon_id", "deposit_id", "account", "livemode")
    REFERENCES "deposit_shadow_state" ("salon_id", "deposit_id", "account", "livemode") ON DELETE RESTRICT
);
--> statement-breakpoint

CREATE TABLE "deposit_shadow_observation" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL,
  "deposit_id" text NOT NULL,
  "account" text NOT NULL,
  "livemode" boolean NOT NULL,
  "cycle_id" text NOT NULL,
  "generation" integer NOT NULL,
  "version" integer NOT NULL,
  "fence" integer NOT NULL,
  "accepted_at" timestamptz NOT NULL DEFAULT now(),
  "reason" text,
  "evidence" jsonb NOT NULL,
  CONSTRAINT "deposit_shadow_observation_generation_check" CHECK ("generation" >= 0),
  CONSTRAINT "deposit_shadow_observation_version_check" CHECK ("version" >= 0),
  CONSTRAINT "deposit_shadow_observation_fence_check" CHECK ("fence" >= 0),
  CONSTRAINT "deposit_shadow_observation_evidence_object_check" CHECK (jsonb_typeof("evidence") = 'object'),
  CONSTRAINT "deposit_shadow_observation_state_fk"
    FOREIGN KEY ("salon_id", "deposit_id", "account", "livemode")
    REFERENCES "deposit_shadow_state" ("salon_id", "deposit_id", "account", "livemode") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX "deposit_shadow_observation_state_idx"
  ON "deposit_shadow_observation" ("salon_id", "deposit_id", "account", "livemode", "accepted_at");
--> statement-breakpoint

CREATE FUNCTION "deposit_shadow_receipt_immutable_header"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."event_id" IS DISTINCT FROM OLD."event_id"
     OR NEW."event_type" IS DISTINCT FROM OLD."event_type"
     OR NEW."account" IS DISTINCT FROM OLD."account"
     OR NEW."livemode" IS DISTINCT FROM OLD."livemode"
     OR NEW."provider_created" IS DISTINCT FROM OLD."provider_created"
     OR NEW."api_version" IS DISTINCT FROM OLD."api_version"
     OR NEW."projection" IS DISTINCT FROM OLD."projection"
     OR NEW."received_at" IS DISTINCT FROM OLD."received_at" THEN
    RAISE EXCEPTION 'deposit shadow receipt header and projection are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "deposit_shadow_receipt_immutable_header_trigger"
  BEFORE UPDATE ON "deposit_shadow_receipt"
  FOR EACH ROW EXECUTE FUNCTION "deposit_shadow_receipt_immutable_header"();
--> statement-breakpoint

CREATE FUNCTION "deposit_shadow_forbid_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "deposit_shadow_command_immutable" BEFORE UPDATE OR DELETE ON "deposit_shadow_command"
  FOR EACH ROW EXECUTE FUNCTION "deposit_shadow_forbid_update"();
--> statement-breakpoint
CREATE TRIGGER "deposit_shadow_attempt_immutable" BEFORE UPDATE OR DELETE ON "deposit_shadow_attempt"
  FOR EACH ROW EXECUTE FUNCTION "deposit_shadow_forbid_update"();
--> statement-breakpoint
CREATE TRIGGER "deposit_shadow_receipt_no_delete" BEFORE DELETE ON "deposit_shadow_receipt"
  FOR EACH ROW EXECUTE FUNCTION "deposit_shadow_forbid_update"();
--> statement-breakpoint
CREATE TRIGGER "deposit_shadow_observation_append_only" BEFORE UPDATE OR DELETE ON "deposit_shadow_observation"
  FOR EACH ROW EXECUTE FUNCTION "deposit_shadow_forbid_update"();
--> statement-breakpoint

CREATE FUNCTION "deposit_shadow_object_scope_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."account" IS DISTINCT FROM OLD."account"
     OR NEW."livemode" IS DISTINCT FROM OLD."livemode"
     OR NEW."object_id" IS DISTINCT FROM OLD."object_id"
     OR NEW."salon_id" IS DISTINCT FROM OLD."salon_id"
     OR NEW."deposit_id" IS DISTINCT FROM OLD."deposit_id"
     OR NEW."kind" IS DISTINCT FROM OLD."kind" THEN
    RAISE EXCEPTION 'deposit shadow object namespace and scope are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "deposit_shadow_object_scope_immutable_trigger"
  BEFORE UPDATE ON "deposit_shadow_object"
  FOR EACH ROW EXECUTE FUNCTION "deposit_shadow_object_scope_immutable"();
--> statement-breakpoint
CREATE TRIGGER "deposit_shadow_object_no_delete" BEFORE DELETE ON "deposit_shadow_object"
  FOR EACH ROW EXECUTE FUNCTION "deposit_shadow_forbid_update"();
