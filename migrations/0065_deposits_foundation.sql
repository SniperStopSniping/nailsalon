-- Schema-only foundation for connected-account history, appointment deposits,
-- and durable, replay-safe webhook intake with a minimized payload projection.
-- ORM mapping is deliberately deferred to the next PR, so these empty tables
-- are invisible to the running application.
-- Creation here is deliberately unguarded: an object of the same name that
-- already exists must fail this migration rather than be adopted unverified.

-- The appointment foreign key below requires immediate uniqueness on the
-- ordered (salon_id, id) key. The first arm matches that structure under any
-- index name; names never prove that the prerequisite is satisfied.
-- PostgreSQL will not accept a deferrable unique constraint as an FK target,
-- which is why indimmediate is load-bearing. The final arm creates a standalone
-- immediate unique index. It cannot reject existing rows because appointment.id
-- is already the table's primary key.
-- AD-21 names the prerequisite for appointment_deposit_appointment_fk.
DO $$
DECLARE
  qualifying_index_count integer;
  same_name_definition text;
BEGIN
  -- (1) Is the foreign key's precondition already satisfied by ANY index, under ANY name?
  SELECT count(*)
    INTO qualifying_index_count
    FROM pg_index AS indexes
    INNER JOIN pg_class AS index_classes
      ON index_classes.oid = indexes.indexrelid
    INNER JOIN pg_class AS indexed_relations
      ON indexed_relations.oid = indexes.indrelid
    INNER JOIN pg_namespace AS indexed_namespaces
      ON indexed_namespaces.oid = indexed_relations.relnamespace
   WHERE indexed_namespaces.nspname = 'public'
     AND indexed_relations.relname = 'appointment'
     AND index_classes.relkind = 'i'
     AND indexes.indisunique
     AND indexes.indimmediate
     AND indexes.indisvalid
     AND indexes.indisready
     AND indexes.indpred IS NULL
     AND indexes.indexprs IS NULL
     AND indexes.indnkeyatts = 2
     AND indexes.indnatts = indexes.indnkeyatts
     AND ARRAY(
           SELECT attributes.attname::text
             FROM unnest(indexes.indkey) WITH ORDINALITY AS keys(attribute_number, ordinality)
             INNER JOIN pg_attribute AS attributes
                     ON attributes.attrelid = indexes.indrelid
                    AND attributes.attnum   = keys.attribute_number
            WHERE keys.ordinality <= indexes.indnkeyatts
            ORDER BY keys.ordinality
         ) = ARRAY['salon_id', 'id']::text[];

  IF qualifying_index_count > 0 THEN
    RETURN;
  END IF;

  -- (2) No qualifying index exists. Before creating ours, refuse to be fooled by the NAME.
  SELECT pg_get_indexdef(index_classes.oid)
    INTO same_name_definition
    FROM pg_class AS index_classes
    INNER JOIN pg_namespace AS index_namespaces
      ON index_namespaces.oid = index_classes.relnamespace
   WHERE index_namespaces.nspname = 'public'
     AND index_classes.relkind = 'i'
     AND index_classes.relname = 'appointment_salon_id_id_uniq';

  IF same_name_definition IS NOT NULL THEN
    RAISE EXCEPTION
      'AD-21 precondition unsatisfied: index "appointment_salon_id_id_uniq" exists but is not a valid, immediate (non-deferrable), non-partial, non-expression UNIQUE index on appointment (salon_id, id) in that key order. Actual definition: %',
      same_name_definition
      USING ERRCODE = '55000';
  END IF;

  -- (3) Genuinely absent under BOTH tests -> create it, plainly and unguardedly.
  EXECUTE 'CREATE UNIQUE INDEX "appointment_salon_id_id_uniq" ON "appointment" ("salon_id","id")';
END;
$$;
--> statement-breakpoint
-- Rows form append-only binding history; binding identity is immutable per row.
-- The surrogate id permits revoked history to coexist with a later binding, and
-- salon deletion cascades because these rows carry no client money. livemode
-- cannot be inferred from an account id. Charge readiness, payout readiness, and
-- onboarding completion remain distinct states. requirements_due is an object
-- so current, eventual, past-due, pending-verification, deadline, future-deadline,
-- and restriction details survive transitions without a remote lookup.
-- Connected, revoked, synced, created, and updated timestamps retain provenance.
-- Revocation cause distinguishes a local disconnect from deauthorization; the
-- paired fields prevent either half of a revocation from existing alone.
CREATE TABLE "salon_stripe_account" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "stripe_account_id" text NOT NULL,
  "livemode" boolean NOT NULL,
  "charges_enabled" boolean NOT NULL DEFAULT false,
  "payouts_enabled" boolean NOT NULL DEFAULT false,
  "details_submitted" boolean NOT NULL DEFAULT false,
  "requirements_due" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "disabled_reason" text,
  "connected_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz,
  "revocation_cause" text,
  "last_synced_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "salon_stripe_account_revocation_cause_valid"
    CHECK ("revocation_cause" IN ('revoked_local','deauthorized')),
  CONSTRAINT "salon_stripe_account_revocation_paired"
    CHECK (("revoked_at" IS NULL) = ("revocation_cause" IS NULL))
);
--> statement-breakpoint
-- Partial uniqueness permits retained revoked history and future rebinding.
CREATE UNIQUE INDEX "salon_stripe_account_live_salon_uniq"
  ON "salon_stripe_account" ("salon_id")
  WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "salon_stripe_account_live_account_uniq"
  ON "salon_stripe_account" ("stripe_account_id")
  WHERE "revoked_at" IS NULL;
--> statement-breakpoint
-- Total lookup covers both live and revoked bindings for in-flight events.
CREATE INDEX "salon_stripe_account_account_idx"
  ON "salon_stripe_account" ("stripe_account_id");
--> statement-breakpoint
-- This terminal-history money record snapshots the connected account and all
-- provider identifiers needed after a rebind. Provider ids remain nullable
-- until post-commit creation. The lowercase currency literal matches Stripe's
-- ISO-code parameters. Durable poll-window counters bound retrieval work, and
-- refund_key_epoch begins at one to keep first-attempt idempotency keys stable.
-- The composite appointment reference is tenant-ordered and deliberately
-- restricts deletion while a local record of client money exists.
CREATE TABLE "appointment_deposit" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL,
  "appointment_id" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "disclosed_amount_cents" integer,
  "currency" text NOT NULL DEFAULT 'cad',
  "status" text NOT NULL,
  "stripe_account_id" text NOT NULL,
  "stripe_checkout_session_id" text,
  "stripe_payment_intent_id" text,
  "stripe_checkout_url" text,
  "checkout_success_url" text,
  "checkout_cancel_url" text,
  "resolution_note" text,
  "stripe_refund_id" text,
  "refunded_at" timestamptz,
  "late_check_done_at" timestamptz,
  "poll_retrievals" integer NOT NULL DEFAULT 0,
  "poll_window_retrievals" integer NOT NULL DEFAULT 0,
  "poll_window_started_at" timestamptz,
  "refund_terminal_failure_count" integer NOT NULL DEFAULT 0,
  "refund_key_epoch" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "appointment_deposit_amount_positive"
    CHECK ("amount_cents" > 0),
  CONSTRAINT "appointment_deposit_currency_cad"
    CHECK ("currency" = 'cad'),
  CONSTRAINT "appointment_deposit_status_valid"
    CHECK ("status" IN ('checkout_created','paid','expired','canceled','refunded','waived')),
  CONSTRAINT "appointment_deposit_appointment_fk"
    FOREIGN KEY ("salon_id","appointment_id")
    REFERENCES "appointment"("salon_id","id")
    ON DELETE RESTRICT
);
--> statement-breakpoint
-- Nullable provider ids remain globally unique whenever they are present.
CREATE UNIQUE INDEX "appointment_deposit_session_uniq"
  ON "appointment_deposit" ("stripe_checkout_session_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_deposit_pi_uniq"
  ON "appointment_deposit" ("stripe_payment_intent_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_deposit_refund_uniq"
  ON "appointment_deposit" ("stripe_refund_id");
--> statement-breakpoint
-- Terminal rows may accumulate, while only one active deposit may claim an appointment.
CREATE UNIQUE INDEX "appointment_deposit_one_active"
  ON "appointment_deposit" ("appointment_id")
  WHERE "status" IN ('checkout_created','paid');
--> statement-breakpoint
CREATE INDEX "appointment_deposit_salon_status_idx"
  ON "appointment_deposit" ("salon_id","status");
--> statement-breakpoint
-- Event identity supports replay-safe claims. Routing status is closed and
-- indexed; diagnostic outcome is intentionally open. Nullable projection fields
-- minimize retained payload data while preserving trusted provider provenance,
-- retry fencing, tenant context, and a hard purge horizon for exceptional raw data.
CREATE TABLE "stripe_webhook_event" (
  "id" text PRIMARY KEY NOT NULL,
  "event_id" text NOT NULL,
  "type" text NOT NULL,
  "account" text,
  "livemode" boolean NOT NULL,
  "salon_id" text,
  "status" text NOT NULL,
  "outcome" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "available_at" timestamptz,
  "last_error" text,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz,
  "session_id" text,
  "payment_intent_id" text,
  "payment_status" text,
  "amount_total" integer,
  "currency" text,
  "metadata_appointment_id" text,
  "metadata_salon_id" text,
  "metadata_deposit_id" text,
  "client_reference_id" text,
  "projection_status" text,
  "raw_payload" jsonb,
  "payload_purge_after" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "stripe_webhook_event_status_valid" CHECK ("status" IN (
    'processing',
    'processed',
    'failed_retryable',
    'poisoned',
    'held_mismatch',
    'held_duplicate_session',
    'account_mismatch',
    'unbound_unresolved',
    'orphan_unresolved',
    'ignored_non_connect_scope',
    'ignored_livemode',
    'ignored_unhandled',
    'ignored_foreign_session',
    'ignored_unpaid',
    'ignored_over_cap'
  ))
);
--> statement-breakpoint
-- This unique definition makes the downstream insert-claim atomic.
CREATE UNIQUE INDEX "stripe_webhook_event_event_id_uniq"
  ON "stripe_webhook_event" ("event_id");
--> statement-breakpoint
CREATE INDEX "stripe_webhook_event_status_available_idx"
  ON "stripe_webhook_event" ("status","available_at");
--> statement-breakpoint
-- Plain creation fails loudly if this migration's function name is already held.
-- BEFORE UPDATE maintenance covers all three tables without overwriting a
-- deliberately supplied insert timestamp.
CREATE FUNCTION "deposits_set_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "salon_stripe_account_set_updated_at"
  BEFORE UPDATE
  ON "salon_stripe_account"
  FOR EACH ROW
  EXECUTE FUNCTION "deposits_set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "appointment_deposit_set_updated_at"
  BEFORE UPDATE
  ON "appointment_deposit"
  FOR EACH ROW
  EXECUTE FUNCTION "deposits_set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "stripe_webhook_event_set_updated_at"
  BEFORE UPDATE
  ON "stripe_webhook_event"
  FOR EACH ROW
  EXECUTE FUNCTION "deposits_set_updated_at"();
