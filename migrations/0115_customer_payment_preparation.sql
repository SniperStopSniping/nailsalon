-- Non-executable test-only preparation. Does not activate collections or alter existing money.
CREATE TABLE customer_payment_policy (
 salon_id text PRIMARY KEY REFERENCES salon(id) ON DELETE CASCADE,
 revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
 settings jsonb NOT NULL,
 mode text NOT NULL DEFAULT 'test',
 collection_enabled boolean NOT NULL DEFAULT false,
 CONSTRAINT customer_payment_policy_test_only CHECK (mode = 'test' AND collection_enabled = false),
 CONSTRAINT customer_payment_policy_settings_valid CHECK ((
   jsonb_typeof(settings) = 'object' AND
   settings ?& ARRAY['enabled','mode','feePayer','platformFeeCents','cancellationPolicy'] AND
   jsonb_typeof(settings->'enabled') = 'boolean' AND settings->>'mode' = 'optional_full' AND
   settings->>'feePayer' = 'salon' AND jsonb_typeof(settings->'platformFeeCents') = 'number' AND
   (settings->>'platformFeeCents')::numeric BETWEEN 0 AND 10000 AND
   (settings->>'platformFeeCents')::numeric = trunc((settings->>'platformFeeCents')::numeric) AND
   jsonb_typeof(settings->'cancellationPolicy') = 'string' AND length(settings->>'cancellationPolicy') <= 5000
 ) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE customer_payment_policy_receipt (
 id text PRIMARY KEY, salon_id text NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
 actor_id text NOT NULL, request_id text NOT NULL, fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'), result jsonb NOT NULL,
 CONSTRAINT customer_payment_policy_request_once UNIQUE(salon_id, actor_id, request_id)
);
--> statement-breakpoint
CREATE TABLE customer_payment_prepared_quote (
 id text PRIMARY KEY, salon_id text NOT NULL, appointment_id text NOT NULL, request_id text NOT NULL,
 request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
 fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 policy_revision integer NOT NULL CHECK (policy_revision > 0), stripe_account_id text NOT NULL CHECK (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
 mode text NOT NULL DEFAULT 'test', executable boolean NOT NULL DEFAULT false,
 snapshot jsonb NOT NULL CHECK ((jsonb_typeof(snapshot) = 'object' AND snapshot ?& ARRAY['collection','currency','chargeCents','tipCents','applicationFeeCents'] AND snapshot->>'collection' = 'full' AND snapshot->>'currency' = 'cad') IS TRUE),
 context jsonb NOT NULL CHECK (jsonb_typeof(context) = 'object'), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT customer_payment_quote_test_only CHECK (mode = 'test' AND executable = false),
 CONSTRAINT customer_payment_quote_appointment_tenant_fk FOREIGN KEY(salon_id,appointment_id) REFERENCES appointment(salon_id,id) ON DELETE CASCADE,
 CONSTRAINT customer_payment_quote_request_once UNIQUE(salon_id,appointment_id,request_id),
 CONSTRAINT customer_payment_quote_tenant_identity UNIQUE(salon_id,id,stripe_account_id,mode),
 CHECK (expires_at > created_at)
);
--> statement-breakpoint
CREATE FUNCTION customer_payment_preparation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'customer payment preparation records are immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_quote_immutable BEFORE UPDATE ON customer_payment_prepared_quote FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
--> statement-breakpoint
CREATE TRIGGER customer_payment_policy_receipt_immutable BEFORE UPDATE ON customer_payment_policy_receipt FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
