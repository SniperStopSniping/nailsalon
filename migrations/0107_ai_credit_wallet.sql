-- A separate prepaid AI domain. No SMS lots, subscriptions or customer bookings change.
CREATE TABLE ai_credit_account (
  salon_id text NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
  plan_env text NOT NULL CHECK (plan_env IN ('dev','test','prod')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (salon_id, plan_env)
);
--> statement-breakpoint
CREATE TABLE ai_credit_purchase (
  id text PRIMARY KEY,
  salon_id text NOT NULL,
  plan_env text NOT NULL,
  actor_id text NOT NULL,
  operation_id text NOT NULL,
  pack_key text NOT NULL CHECK (pack_key IN ('ai_10_cad_v1','ai_20_cad_v1','ai_50_cad_v1')),
  amount_cents integer NOT NULL CHECK (amount_cents IN (1000,2000,5000)),
  credit_micro_cad bigint NOT NULL CHECK (credit_micro_cad = amount_cents::bigint * 10000),
  currency text NOT NULL DEFAULT 'cad' CHECK (currency = 'cad'),
  stripe_price_id text NOT NULL,
  stripe_customer_id text NOT NULL,
  stripe_session_id text UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  paid_amount_cents integer,
  tax_cents integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  status text NOT NULL CHECK (status IN ('creating','checkout_created','paid','expired','failed')),
  refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0 AND refunded_cents <= COALESCE(paid_amount_cents, amount_cents)),
  reversed_micro_cad bigint NOT NULL DEFAULT 0 CHECK (reversed_micro_cad >= 0 AND reversed_micro_cad <= credit_micro_cad),
  disputed boolean NOT NULL DEFAULT false,
  dispute_id text,
  dispute_resolution text CHECK (dispute_resolution IN ('won','lost')),
  adjustment_version integer NOT NULL DEFAULT 0 CHECK (adjustment_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  CHECK (paid_amount_cents IS NULL OR paid_amount_cents = amount_cents + tax_cents),
  CHECK (dispute_resolution IS NULL OR dispute_id IS NOT NULL),
  CHECK (amount_cents = CASE pack_key WHEN 'ai_10_cad_v1' THEN 1000 WHEN 'ai_20_cad_v1' THEN 2000 WHEN 'ai_50_cad_v1' THEN 5000 END),
  UNIQUE (salon_id, plan_env, operation_id),
  UNIQUE (salon_id, plan_env, id),
  FOREIGN KEY (salon_id, plan_env) REFERENCES ai_credit_account(salon_id, plan_env) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX ai_credit_purchase_active ON ai_credit_purchase(salon_id,plan_env)
  WHERE status IN ('creating','checkout_created');
--> statement-breakpoint
CREATE TABLE ai_credit_ledger (
  id text PRIMARY KEY,
  salon_id text NOT NULL,
  plan_env text NOT NULL,
  entry_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('purchase','usage','reversal','recovery')),
  amount_micro_cad bigint NOT NULL CHECK (amount_micro_cad <> 0 AND abs(amount_micro_cad) <= 9000000000000),
  purchase_id text,
  operation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (salon_id, plan_env, entry_key),
  FOREIGN KEY (salon_id, plan_env) REFERENCES ai_credit_account(salon_id, plan_env) ON DELETE CASCADE,
  FOREIGN KEY (salon_id, plan_env, purchase_id) REFERENCES ai_credit_purchase(salon_id, plan_env, id)
);
--> statement-breakpoint
CREATE TABLE ai_credit_reservation (
  id text PRIMARY KEY,
  salon_id text NOT NULL,
  plan_env text NOT NULL,
  operation_id text NOT NULL,
  request_hash text NOT NULL,
  actor_id text NOT NULL,
  reserved_micro_cad bigint NOT NULL CHECK (reserved_micro_cad > 0 AND reserved_micro_cad <= 100000000),
  settled_micro_cad bigint NOT NULL DEFAULT 0 CHECK (settled_micro_cad >= 0 AND settled_micro_cad <= reserved_micro_cad),
  status text NOT NULL CHECK (status IN ('held','settled','released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (salon_id, plan_env, operation_id),
  FOREIGN KEY (salon_id, plan_env) REFERENCES ai_credit_account(salon_id, plan_env) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE FUNCTION immutable_ai_credit_entry() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'AI credit entries are immutable'; END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ai_credit_ledger_immutable BEFORE UPDATE ON ai_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION immutable_ai_credit_entry();
