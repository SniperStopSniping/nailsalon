-- 0069_billing_credit_foundation.sql
--
-- Gate B / B1 — Migration A of the Luster billing & communications track.
-- Governing contract: docs/luster-billing-communications-rev-2-2.md §6-§8, §13.
--
-- Creates the complete financial foundation for versioned subscriptions and
-- shared-SMS credit accounting: subscription state with monthly credit
-- windows (annual subscribers still receive MONTHLY allowances), durable
-- credit-window evidence, durable business identity with versioned
-- fingerprint links (HMAC rotation must never reset eligibility), one-time
-- starter-grant evidence, founding-promotion claims (reserve-before-checkout),
-- checkout-attempt serialization, the append-only lot ledger, the per-salon
-- account/serialization row, transactional reservations with per-lot
-- allocation, inert Stripe billing-event persistence, and top-up purchase
-- records.
--
-- Everything here is DARK: no route, webhook, cron or provider call reads
-- these tables in B1. Creation is deliberately unguarded (no IF NOT EXISTS):
-- an object of the same name that already exists must fail this migration
-- rather than be adopted unverified.

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger for the billing domain. deposits_set_updated_at
-- belongs to the deposits track; the billing track owns its own function so
-- neither track's migrations depend on the other's.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "billing_set_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- billing_subscription — authoritative versioned-billing state. Deliberately
-- parallel to the legacy salon stripe_* columns (which remain owned by the
-- legacy webhook): this table is the only source for plan/offer identity,
-- paid_through, credit-window anchoring and founding rate protection.
-- last_event_created/last_event_id form the monotonic fence for the future
-- Gate C webhook; nothing writes this table in B1 outside tests.
-- ---------------------------------------------------------------------------
CREATE TABLE "billing_subscription" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "stripe_subscription_id" text NOT NULL,
  "stripe_customer_id" text NOT NULL,
  "plan_definition_key" text NOT NULL,
  "billing_offer_key" text NOT NULL,
  "pending_offer_key" text,
  "promotion_key" text,
  "rate_protected_through" timestamptz,
  "billing_cadence" text NOT NULL,
  "status" text NOT NULL,
  "cancel_at_period_end" boolean NOT NULL DEFAULT false,
  "paid_through" timestamptz NOT NULL,
  "credit_cycle_anchor" timestamptz NOT NULL,
  "credit_cycle_index" integer NOT NULL DEFAULT 0,
  "current_credit_window_start" timestamptz,
  "current_credit_window_end" timestamptz,
  "next_credit_grant_at" timestamptz,
  "last_event_created" timestamptz,
  "last_event_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_subscription_cadence_valid"
    CHECK ("billing_cadence" IN ('monthly', 'annual')),
  CONSTRAINT "billing_subscription_status_valid"
    CHECK ("status" IN ('incomplete', 'incomplete_expired', 'trialing', 'active',
                        'past_due', 'canceled', 'unpaid', 'paused')),
  -- Windows are half-open [start, end): equality of start and end is invalid,
  -- and the pair is set or cleared together.
  CONSTRAINT "billing_subscription_window_pairing"
    CHECK (("current_credit_window_start" IS NULL) = ("current_credit_window_end" IS NULL)),
  CONSTRAINT "billing_subscription_window_ordered"
    CHECK ("current_credit_window_start" IS NULL
           OR "current_credit_window_start" < "current_credit_window_end"),
  CONSTRAINT "billing_subscription_cycle_index_nonnegative"
    CHECK ("credit_cycle_index" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscription_stripe_sub_uniq"
  ON "billing_subscription" ("stripe_subscription_id");
--> statement-breakpoint
-- One LIVE subscription per salon; canceled/expired history rows remain.
CREATE UNIQUE INDEX "billing_subscription_live_salon_uniq"
  ON "billing_subscription" ("salon_id")
  WHERE "status" NOT IN ('canceled', 'incomplete_expired');
--> statement-breakpoint
CREATE INDEX "billing_subscription_salon_idx"
  ON "billing_subscription" ("salon_id", "status");
--> statement-breakpoint
CREATE TRIGGER "billing_subscription_touch" BEFORE UPDATE ON "billing_subscription"
  FOR EACH ROW EXECUTE FUNCTION "billing_set_updated_at"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- billing_credit_window — durable exactly-once evidence for every monthly
-- credit window a subscription has ever evaluated. Historical grant state
-- must never be inferred solely from mutable billing_subscription fields
-- (contract §6.5b). idempotency_key is the financial dedupe backbone for
-- window grants and is unique on its own.
-- ---------------------------------------------------------------------------
CREATE TABLE "billing_credit_window" (
  "id" text PRIMARY KEY NOT NULL,
  "billing_subscription_id" text NOT NULL
    REFERENCES "billing_subscription"("id") ON DELETE CASCADE,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "credit_cycle_index" integer NOT NULL,
  "plan_definition_key" text NOT NULL,
  "window_start" timestamptz NOT NULL,
  "window_end" timestamptz NOT NULL,
  "status" text NOT NULL,
  "grant_ledger_id" text,
  "idempotency_key" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz,
  CONSTRAINT "billing_credit_window_status_valid"
    CHECK ("status" IN ('pending', 'granted', 'skipped_unpaid', 'skipped_missed', 'reversed')),
  CONSTRAINT "billing_credit_window_ordered" CHECK ("window_start" < "window_end"),
  CONSTRAINT "billing_credit_window_index_nonnegative" CHECK ("credit_cycle_index" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_credit_window_cycle_uniq"
  ON "billing_credit_window" ("billing_subscription_id", "credit_cycle_index");
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_credit_window_idem_uniq"
  ON "billing_credit_window" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "billing_credit_window_salon_idx"
  ON "billing_credit_window" ("salon_id", "status");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- billing_business_identity — the canonical durable business identity that
-- starter grants and founding-promotion claims attach to. Deliberately has
-- NO salon foreign key: the identity must outlive any individual salon
-- (contract §7.3 — owner transfer and salon recreation must not reset
-- eligibility). An audited business split is future controlled tooling.
-- ---------------------------------------------------------------------------
CREATE TABLE "billing_business_identity" (
  "id" text PRIMARY KEY NOT NULL,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TRIGGER "billing_business_identity_touch" BEFORE UPDATE ON "billing_business_identity"
  FOR EACH ROW EXECUTE FUNCTION "billing_set_updated_at"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- billing_business_identity_link — versioned fingerprint links attaching
-- external identifiers to one durable identity. email_hmac link values are
-- keyed, versioned HMAC digests (never raw email, never unkeyed SHA-256);
-- rotating BILLING_IDENTITY_HMAC_VERSION attaches a NEW link row to the SAME
-- identity, so rotation can never mint a second identity. link_value for
-- link_type='salon' is the salon id AS A VALUE, intentionally without a
-- foreign key, so the link survives salon purge as durable evidence.
-- ---------------------------------------------------------------------------
CREATE TABLE "billing_business_identity_link" (
  "id" text PRIMARY KEY NOT NULL,
  "business_identity_id" text NOT NULL
    REFERENCES "billing_business_identity"("id") ON DELETE CASCADE,
  "link_type" text NOT NULL,
  "link_value" text NOT NULL,
  "hmac_key_version" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_identity_link_type_valid"
    CHECK ("link_type" IN ('clerk_user', 'salon', 'stripe_customer', 'email_hmac')),
  -- Only email_hmac links carry a key version; every other type must not.
  CONSTRAINT "billing_identity_link_version_pairing"
    CHECK (("link_type" = 'email_hmac') = ("hmac_key_version" IS NOT NULL))
);
--> statement-breakpoint
-- A given external identifier resolves to exactly one business identity.
CREATE UNIQUE INDEX "billing_identity_link_value_uniq"
  ON "billing_business_identity_link" ("link_type", "link_value");
--> statement-breakpoint
CREATE INDEX "billing_identity_link_identity_idx"
  ON "billing_business_identity_link" ("business_identity_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- billing_starter_grant — durable once-per-business starter-grant evidence.
-- Survives salon purge (salon_id is provenance only, SET NULL; ledger_id is
-- SET NULL because ledger rows die with their salon while this evidence must
-- not). The unique business_identity_id IS the anti-duplication guarantee.
-- ---------------------------------------------------------------------------
CREATE TABLE "billing_starter_grant" (
  "id" text PRIMARY KEY NOT NULL,
  "business_identity_id" text NOT NULL
    REFERENCES "billing_business_identity"("id") ON DELETE CASCADE,
  "salon_id" text REFERENCES "salon"("id") ON DELETE SET NULL,
  "ledger_id" text,
  "credits" integer NOT NULL,
  "granted_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_starter_grant_credits_positive" CHECK ("credits" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_starter_grant_identity_uniq"
  ON "billing_starter_grant" ("business_identity_id");
--> statement-breakpoint
CREATE INDEX "billing_starter_grant_salon_idx" ON "billing_starter_grant" ("salon_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- billing_promotion_counter — a pure per-promotion serialization anchor for
-- transactional redemption-cap enforcement: reserve flows take
-- SELECT ... FOR UPDATE on this row, then count live claims. Counts are
-- deliberately NOT cached here; the claims table stays authoritative.
-- ---------------------------------------------------------------------------
CREATE TABLE "billing_promotion_counter" (
  "promotion_key" text PRIMARY KEY NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO "billing_promotion_counter" ("promotion_key") VALUES ('founding_annual_2026');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- billing_promotion_claim — claim-before-checkout lifecycle for the founding
-- promotion (contract §7.3): eligibility is transactionally RESERVED before
-- any Stripe checkout session exists, so caps and once-per-business hold
-- under parallel checkout attempts. Cancel/resubscribe cannot re-reserve:
-- released/expired claims free the slot, but a redeemed claim never does.
-- ---------------------------------------------------------------------------
CREATE TABLE "billing_promotion_claim" (
  "id" text PRIMARY KEY NOT NULL,
  "promotion_key" text NOT NULL,
  "business_identity_id" text NOT NULL
    REFERENCES "billing_business_identity"("id") ON DELETE CASCADE,
  "salon_id" text REFERENCES "salon"("id") ON DELETE SET NULL,
  "billing_checkout_attempt_id" text,
  "stripe_checkout_session_id" text,
  "status" text NOT NULL,
  "reserved_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz,
  "redeemed_at" timestamptz,
  "released_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_promotion_claim_status_valid"
    CHECK ("status" IN ('reserved', 'redeemed', 'released', 'expired', 'rejected'))
);
--> statement-breakpoint
-- One live-or-redeemed claim per (promotion, business identity), forever.
CREATE UNIQUE INDEX "billing_promotion_claim_live_uniq"
  ON "billing_promotion_claim" ("promotion_key", "business_identity_id")
  WHERE "status" IN ('reserved', 'redeemed');
--> statement-breakpoint
CREATE INDEX "billing_promotion_claim_salon_idx" ON "billing_promotion_claim" ("salon_id");
--> statement-breakpoint
CREATE INDEX "billing_promotion_claim_status_idx"
  ON "billing_promotion_claim" ("promotion_key", "status");
--> statement-breakpoint
CREATE TRIGGER "billing_promotion_claim_touch" BEFORE UPDATE ON "billing_promotion_claim"
  FOR EACH ROW EXECUTE FUNCTION "billing_set_updated_at"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- billing_checkout_attempt — durable serialization for future checkout
-- flows (contract §8.5): at most one ACTIVE subscription attempt per salon;
-- the Stripe idempotency key derives from the persisted attempt id and is
-- never browser-supplied. B1 persists and serializes only — no Stripe call.
-- ---------------------------------------------------------------------------
CREATE TABLE "billing_checkout_attempt" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "purpose" text NOT NULL,
  "billing_offer_key" text,
  "topup_offer_key" text,
  "promotion_key" text,
  "status" text NOT NULL,
  "stripe_idempotency_key" text NOT NULL,
  "stripe_checkout_session_id" text,
  "stripe_subscription_id" text,
  "stripe_payment_intent_id" text,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_checkout_attempt_purpose_valid"
    CHECK ("purpose" IN ('plan_subscription', 'sms_topup')),
  CONSTRAINT "billing_checkout_attempt_status_valid"
    CHECK ("status" IN ('creating', 'checkout_created', 'completed', 'expired',
                        'failed', 'superseded')),
  -- Exactly one offer reference, matching the purpose.
  CONSTRAINT "billing_checkout_attempt_offer_pairing"
    CHECK (("purpose" = 'plan_subscription' AND "billing_offer_key" IS NOT NULL AND "topup_offer_key" IS NULL)
        OR ("purpose" = 'sms_topup' AND "topup_offer_key" IS NOT NULL AND "billing_offer_key" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_attempt_active_subscription_uniq"
  ON "billing_checkout_attempt" ("salon_id")
  WHERE "purpose" = 'plan_subscription' AND "status" IN ('creating', 'checkout_created');
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_attempt_idem_uniq"
  ON "billing_checkout_attempt" ("stripe_idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_attempt_session_uniq"
  ON "billing_checkout_attempt" ("stripe_checkout_session_id")
  WHERE "stripe_checkout_session_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "billing_checkout_attempt_salon_idx"
  ON "billing_checkout_attempt" ("salon_id", "status");
--> statement-breakpoint
CREATE TRIGGER "billing_checkout_attempt_touch" BEFORE UPDATE ON "billing_checkout_attempt"
  FOR EACH ROW EXECUTE FUNCTION "billing_set_updated_at"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- sms_credit_ledger — the append-only financial source of truth. Positive
-- rows are credit LOTS carrying their own expiry; negative rows consume a
-- named lot. The single idempotency_key unique index enforces every
-- grant/debit/refund/reversal key in the system. UPDATE is forbidden by
-- trigger; DELETE remains possible solely via the salon-purge cascade
-- (whole-tenant removal is a sanctioned operation; row mutation is not).
-- ---------------------------------------------------------------------------
CREATE TABLE "sms_credit_ledger" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "entry_type" text NOT NULL,
  "bucket" text NOT NULL,
  "amount" integer NOT NULL,
  "expires_at" timestamptz,
  "consumed_from_ledger_id" text REFERENCES "sms_credit_ledger"("id") ON DELETE CASCADE,
  "reservation_id" text,
  "idempotency_key" text NOT NULL,
  "reason" text NOT NULL,
  "stripe_ref" text,
  "actor" text,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sms_credit_ledger_entry_type_valid"
    CHECK ("entry_type" IN ('grant', 'debit', 'sms_refund', 'purchase_reversal',
                            'adjustment', 'expiry')),
  CONSTRAINT "sms_credit_ledger_bucket_valid"
    CHECK ("bucket" IN ('starter', 'monthly', 'purchased', 'promotional',
                        'delivery_recovery', 'administrative')),
  CONSTRAINT "sms_credit_ledger_amount_nonzero" CHECK ("amount" <> 0),
  CONSTRAINT "sms_credit_ledger_sign_matches_type"
    CHECK (("entry_type" IN ('grant', 'sms_refund') AND "amount" > 0)
        OR ("entry_type" IN ('debit', 'expiry', 'purchase_reversal') AND "amount" < 0)
        OR ("entry_type" = 'adjustment')),
  -- Every negative row must name the lot it consumes; positive rows are lots.
  CONSTRAINT "sms_credit_ledger_negative_references_lot"
    CHECK ("amount" > 0 OR "consumed_from_ledger_id" IS NOT NULL),
  CONSTRAINT "sms_credit_ledger_positive_is_lot"
    CHECK ("amount" < 0 OR "consumed_from_ledger_id" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sms_credit_ledger_idem_uniq" ON "sms_credit_ledger" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "sms_credit_ledger_salon_created_idx"
  ON "sms_credit_ledger" ("salon_id", "created_at");
--> statement-breakpoint
CREATE INDEX "sms_credit_ledger_lot_consumption_idx"
  ON "sms_credit_ledger" ("consumed_from_ledger_id");
--> statement-breakpoint
-- Hot path: reserve-time open-lot selection.
CREATE INDEX "sms_credit_ledger_open_lots_idx"
  ON "sms_credit_ledger" ("salon_id", "expires_at")
  WHERE "amount" > 0;
--> statement-breakpoint
CREATE FUNCTION "sms_credit_ledger_forbid_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sms_credit_ledger is append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "sms_credit_ledger_immutable" BEFORE UPDATE ON "sms_credit_ledger"
  FOR EACH ROW EXECUTE FUNCTION "sms_credit_ledger_forbid_update"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- sms_credit_account — one row per salon: the SELECT ... FOR UPDATE
-- serialization anchor for every credit mutation, the non-authoritative
-- cached balance, and the durable low-balance-warning state (warning_epoch
-- increments on grant/top-up/recovery, deterministically resetting warning
-- eligibility; last_warning_tier only moves downward within an epoch).
-- ---------------------------------------------------------------------------
CREATE TABLE "sms_credit_account" (
  "salon_id" text PRIMARY KEY NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "cached_available" integer NOT NULL DEFAULT 0,
  "cached_reserved" integer NOT NULL DEFAULT 0,
  "cache_computed_at" timestamptz NOT NULL DEFAULT now(),
  "warning_epoch" integer NOT NULL DEFAULT 0,
  "last_warning_tier" text,
  "last_warning_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sms_credit_account_warning_tier_valid"
    CHECK ("last_warning_tier" IS NULL OR "last_warning_tier" IN ('20pct', '10', '0')),
  CONSTRAINT "sms_credit_account_warning_epoch_nonnegative"
    CHECK ("warning_epoch" >= 0)
);
--> statement-breakpoint
CREATE TRIGGER "sms_credit_account_touch" BEFORE UPDATE ON "sms_credit_account"
  FOR EACH ROW EXECUTE FUNCTION "billing_set_updated_at"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- sms_credit_reservation + sms_credit_reservation_lot — transactional holds
-- with per-lot allocation. Lot allocation is a child TABLE (not jsonb)
-- because reserve-time availability must subtract active holds per lot with
-- a plain GROUP BY join. Settlement is settle-on-provider-acceptance
-- (contract §7.4); the reaper releases only clearly pre-send abandoned
-- holds and must skip settled/settling/unknown-outcome reservations.
-- ---------------------------------------------------------------------------
CREATE TABLE "sms_credit_reservation" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "delivery_id" text REFERENCES "notification_delivery"("id") ON DELETE SET NULL,
  "dedupe_key" text NOT NULL,
  "segments" integer NOT NULL,
  "status" text NOT NULL,
  "provider_sid" text,
  "provider_segments" integer,
  "expires_at" timestamptz NOT NULL,
  "settled_at" timestamptz,
  "released_at" timestamptz,
  "release_reason" text,
  "refunded_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sms_credit_reservation_segments_positive" CHECK ("segments" > 0),
  CONSTRAINT "sms_credit_reservation_status_valid"
    CHECK ("status" IN ('held', 'settled', 'released', 'expired'))
);
--> statement-breakpoint
-- A retried send may re-reserve under a fresh attempt discriminator; only
-- live claims (held/settled) are unique per dedupe key.
CREATE UNIQUE INDEX "sms_credit_reservation_active_dedupe_uniq"
  ON "sms_credit_reservation" ("dedupe_key")
  WHERE "status" IN ('held', 'settled');
--> statement-breakpoint
CREATE INDEX "sms_credit_reservation_reaper_idx"
  ON "sms_credit_reservation" ("expires_at")
  WHERE "status" = 'held';
--> statement-breakpoint
CREATE INDEX "sms_credit_reservation_salon_idx"
  ON "sms_credit_reservation" ("salon_id", "status");
--> statement-breakpoint
CREATE TRIGGER "sms_credit_reservation_touch" BEFORE UPDATE ON "sms_credit_reservation"
  FOR EACH ROW EXECUTE FUNCTION "billing_set_updated_at"();
--> statement-breakpoint
CREATE TABLE "sms_credit_reservation_lot" (
  "reservation_id" text NOT NULL
    REFERENCES "sms_credit_reservation"("id") ON DELETE CASCADE,
  "lot_ledger_id" text NOT NULL
    REFERENCES "sms_credit_ledger"("id") ON DELETE CASCADE,
  -- Explicit tenant column so purge and tenant assertions never need a join.
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "segments" integer NOT NULL,
  -- Per-lot financial fences: settlement writes debit_ledger_id exactly once;
  -- refund paths guard on refunded_at IS NULL per lot (partial multi-lot
  -- refunds and segment-overprediction refunds are lot-granular).
  "debit_ledger_id" text REFERENCES "sms_credit_ledger"("id") ON DELETE SET NULL,
  "refund_ledger_id" text REFERENCES "sms_credit_ledger"("id") ON DELETE SET NULL,
  "refunded_at" timestamptz,
  -- Segments already returned by the overprediction path. The terminal-failure
  -- refund pays out segments - refunded_segments, so the two refund arms can
  -- NEVER stack past the original debit regardless of arrival order.
  "refunded_segments" integer NOT NULL DEFAULT 0,
  CONSTRAINT "sms_credit_reservation_lot_pk" PRIMARY KEY ("reservation_id", "lot_ledger_id"),
  CONSTRAINT "sms_credit_reservation_lot_segments_positive" CHECK ("segments" > 0),
  CONSTRAINT "sms_credit_reservation_lot_refunded_segments_bounded"
    CHECK ("refunded_segments" >= 0 AND "refunded_segments" <= "segments")
);
--> statement-breakpoint
CREATE INDEX "sms_credit_reservation_lot_lot_idx"
  ON "sms_credit_reservation_lot" ("lot_ledger_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- billing_stripe_event — inert event-idempotency persistence for the future
-- Gate C billing webhook. The deposits track owns stripe_webhook_event with
-- a closed deposit-scoped status vocabulary; the billing track deliberately
-- has its own table. NOTHING writes this table in Gate B outside tests.
-- salon_id is SET NULL so billing audit evidence survives salon purge.
-- ---------------------------------------------------------------------------
CREATE TABLE "billing_stripe_event" (
  "id" text PRIMARY KEY NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "livemode" boolean NOT NULL,
  "api_created_at" timestamptz NOT NULL,
  "salon_id" text REFERENCES "salon"("id") ON DELETE SET NULL,
  "status" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "available_at" timestamptz,
  "last_error" text,
  "subscription_id" text,
  "invoice_id" text,
  "checkout_session_id" text,
  "payment_intent_id" text,
  "price_id" text,
  "raw_payload" jsonb,
  "payload_purge_after" timestamptz,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_stripe_event_status_valid"
    CHECK ("status" IN ('processing', 'processed', 'failed_retryable', 'poisoned',
                        'ignored_unhandled', 'ignored_livemode_mismatch',
                        'ignored_foreign', 'superseded_stale', 'held_anomaly'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_stripe_event_event_id_uniq"
  ON "billing_stripe_event" ("event_id");
--> statement-breakpoint
CREATE INDEX "billing_stripe_event_status_available_idx"
  ON "billing_stripe_event" ("status", "available_at");
--> statement-breakpoint
CREATE TRIGGER "billing_stripe_event_touch" BEFORE UPDATE ON "billing_stripe_event"
  FOR EACH ROW EXECUTE FUNCTION "billing_set_updated_at"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- sms_topup_purchase — top-up purchase persistence (checkout wiring is Gate
-- C; fulfillment/refund/dispute domain operations land with the engine).
-- grant_ledger_id names the purchased lot created at fulfillment.
-- ---------------------------------------------------------------------------
CREATE TABLE "sms_topup_purchase" (
  "id" text PRIMARY KEY NOT NULL,
  -- SET NULL: paid-money evidence must survive salon purge (audit/refunds).
  "salon_id" text REFERENCES "salon"("id") ON DELETE SET NULL,
  "topup_offer_key" text NOT NULL,
  "credits" integer NOT NULL,
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'cad',
  "status" text NOT NULL,
  "stripe_checkout_session_id" text,
  "stripe_payment_intent_id" text,
  "stripe_refund_id" text,
  "stripe_dispute_id" text,
  "grant_ledger_id" text,
  "refunded_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sms_topup_purchase_credits_positive" CHECK ("credits" > 0),
  CONSTRAINT "sms_topup_purchase_amount_positive" CHECK ("amount_cents" > 0),
  CONSTRAINT "sms_topup_purchase_currency_cad" CHECK ("currency" = 'cad'),
  CONSTRAINT "sms_topup_purchase_status_valid"
    CHECK ("status" IN ('checkout_created', 'paid', 'fulfilled', 'expired',
                        'canceled', 'refunded', 'partially_reversed', 'disputed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sms_topup_purchase_session_uniq"
  ON "sms_topup_purchase" ("stripe_checkout_session_id")
  WHERE "stripe_checkout_session_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "sms_topup_purchase_pi_uniq"
  ON "sms_topup_purchase" ("stripe_payment_intent_id")
  WHERE "stripe_payment_intent_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "sms_topup_purchase_salon_idx"
  ON "sms_topup_purchase" ("salon_id", "status");
--> statement-breakpoint
CREATE TRIGGER "sms_topup_purchase_touch" BEFORE UPDATE ON "sms_topup_purchase"
  FOR EACH ROW EXECUTE FUNCTION "billing_set_updated_at"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Cross-table provenance foreign keys added after all referents exist.
-- SET NULL throughout: evidence rows must never block or be destroyed by the
-- deletion of the operational row they point at.
-- ---------------------------------------------------------------------------
ALTER TABLE "billing_credit_window"
  ADD CONSTRAINT "billing_credit_window_grant_ledger_fk"
  FOREIGN KEY ("grant_ledger_id") REFERENCES "sms_credit_ledger"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "billing_starter_grant"
  ADD CONSTRAINT "billing_starter_grant_ledger_fk"
  FOREIGN KEY ("ledger_id") REFERENCES "sms_credit_ledger"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "sms_topup_purchase"
  ADD CONSTRAINT "sms_topup_purchase_grant_ledger_fk"
  FOREIGN KEY ("grant_ledger_id") REFERENCES "sms_credit_ledger"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "billing_promotion_claim"
  ADD CONSTRAINT "billing_promotion_claim_attempt_fk"
  FOREIGN KEY ("billing_checkout_attempt_id") REFERENCES "billing_checkout_attempt"("id") ON DELETE SET NULL;
