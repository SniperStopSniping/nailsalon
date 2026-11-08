-- Synthetic test-only capture evidence and canonical tender linkage. No activation/backfill.
CREATE UNIQUE INDEX customer_payment_quote_capture_identity ON customer_payment_prepared_quote(salon_id,id,appointment_id,stripe_account_id,mode);
--> statement-breakpoint
CREATE TABLE customer_payment_capture (
 id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'), salon_id text NOT NULL, appointment_id text NOT NULL, quote_id text NOT NULL,
 stripe_account_id text NOT NULL, mode text NOT NULL DEFAULT 'test', source text NOT NULL DEFAULT 'synthetic_test',
 payment_intent_id text NOT NULL, tender_id text NOT NULL REFERENCES appointment_payment(id) ON DELETE RESTRICT,
 currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'), amount_cents integer NOT NULL CHECK (amount_cents > 0),
 application_fee_cents integer NOT NULL CHECK (application_fee_cents >= 0 AND application_fee_cents < amount_cents),
 principal_cents integer NOT NULL CHECK (principal_cents >= 0), tip_cents integer NOT NULL CHECK (tip_cents >= 0),
 quoted_application_fee_cents integer NOT NULL CHECK (quoted_application_fee_cents >= 0),
 state text NOT NULL CHECK (state IN ('posted','held_review')), review_reason text,
 captured_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 CONSTRAINT customer_payment_capture_quote_tenant_fk FOREIGN KEY(salon_id,quote_id,appointment_id,stripe_account_id,mode) REFERENCES customer_payment_prepared_quote(salon_id,id,appointment_id,stripe_account_id,mode) ON DELETE RESTRICT,
 CONSTRAINT customer_payment_capture_appointment_tenant_fk FOREIGN KEY(salon_id,appointment_id) REFERENCES appointment(salon_id,id) ON DELETE RESTRICT,
 CONSTRAINT customer_payment_capture_event_identity UNIQUE(id,stripe_account_id,mode),
 CONSTRAINT customer_payment_capture_intent_once UNIQUE(stripe_account_id,mode,payment_intent_id),
 CONSTRAINT customer_payment_capture_tender_once UNIQUE(tender_id),
 CONSTRAINT customer_payment_capture_tender_marker CHECK (tender_id = 'cpay_' || id),
 CONSTRAINT customer_payment_capture_synthetic_only CHECK (mode = 'test' AND source = 'synthetic_test'),
 CHECK (captured_at <= recorded_at),
 CHECK ((state = 'posted' AND currency = 'cad' AND review_reason IS NULL AND amount_cents::bigint = principal_cents::bigint + tip_cents::bigint AND application_fee_cents = quoted_application_fee_cents)
     OR (state = 'held_review' AND review_reason IS NOT NULL AND length(review_reason) > 0))
);
--> statement-breakpoint
CREATE TABLE customer_payment_capture_event (
 id text PRIMARY KEY, capture_id text NOT NULL,
 stripe_account_id text NOT NULL, mode text NOT NULL DEFAULT 'test' CHECK(mode = 'test'), event_id text NOT NULL,
 fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'), recorded_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT customer_payment_capture_event_account_fk FOREIGN KEY(capture_id,stripe_account_id,mode) REFERENCES customer_payment_capture(id,stripe_account_id,mode) ON DELETE RESTRICT,
 CONSTRAINT customer_payment_capture_event_once UNIQUE(stripe_account_id,mode,event_id)
);
--> statement-breakpoint
CREATE TRIGGER customer_payment_capture_immutable BEFORE UPDATE OR DELETE ON customer_payment_capture FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
--> statement-breakpoint
CREATE TRIGGER customer_payment_capture_event_immutable BEFORE UPDATE OR DELETE ON customer_payment_capture_event FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
