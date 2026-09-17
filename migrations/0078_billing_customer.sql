-- 0078_billing_customer.sql
--
-- New-track Stripe customer identity: one durable Stripe Customer per
-- (salon, billing plan environment). Additive and inert — no backfill, no
-- provider call, no read of "salon"."stripe_customer_id", and nothing here
-- turns billing on.
--
-- THE TWO UNIQUE INDEXES ARE THE DESIGN.
--
--   * "billing_customer_salon_env_uniq" ("salon_id", "plan_env") is what makes
--     the mapping PER ENVIRONMENT. This deployment family shares ONE database
--     between development and production (Preview uses a separate project), so
--     without "plan_env" in the key a Stripe Customer minted in test mode would
--     be reachable by a live-mode deployment. Every read filters on the
--     runtime's BILLING_PLAN_ENV, so a dev row and a prod row may co-exist for
--     one salon and still never cross.
--
--   * "billing_customer_stripe_uniq" ("stripe_customer_id") is the TENANT
--     fence: one Stripe Customer belongs to exactly one salon. A mis-supplied
--     id therefore fails loudly at the database instead of quietly re-tenanting
--     money onto somebody else's customer.
--
-- ON DELETE CASCADE from "salon": the mapping is meaningless without the salon
-- and is not money evidence (purchases keep their own provider ids), so it
-- needs no SALON_PURGE_PLAN step — that coverage guard requires plan entries
-- only for non-cascade children of "salon". The Stripe Customer object itself
-- is never deleted by code; it keeps metadata.salonId so ops can find it.
CREATE TABLE "billing_customer" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "plan_env" text NOT NULL,
  "stripe_customer_id" text NOT NULL,
  "source" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_customer_plan_env_check" CHECK ("plan_env" IN ('dev','test','prod')),
  CONSTRAINT "billing_customer_source_check" CHECK ("source" IN ('created','adopted_subscription'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customer_salon_env_uniq" ON "billing_customer" ("salon_id","plan_env");
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customer_stripe_uniq" ON "billing_customer" ("stripe_customer_id");
--> statement-breakpoint
-- The billing domain's shared updated_at trigger, created in 0069 and already
-- carried by billing_subscription, billing_checkout_attempt and friends.
CREATE TRIGGER "billing_customer_touch" BEFORE UPDATE ON "billing_customer"
  FOR EACH ROW EXECUTE FUNCTION "billing_set_updated_at"();
