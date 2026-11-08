-- Unregistered CLOSED TEST fixture fence for the inactive checkout contract.
-- Existing prepared quotes remain NON-EXECUTABLE previews, never booking holds.
-- No provider credentials, URLs, raw payloads, real ingress, or financial posting.
CREATE TABLE customer_payment_closed_checkout_operation (
 id text PRIMARY KEY CHECK(id ~ '^[0-9a-f-]{36}$'),
 request_id text NOT NULL UNIQUE CHECK(request_id ~ '^[0-9a-f-]{36}$'),
 salon_id text NOT NULL, appointment_id text NOT NULL, quote_id text NOT NULL,
 context_hash text NOT NULL CHECK(context_hash ~ '^[a-f0-9]{64}$'),
 identity_hash text NOT NULL CHECK(identity_hash ~ '^[a-f0-9]{64}$'),
 parameter_hash text NOT NULL CHECK(parameter_hash ~ '^[a-f0-9]{64}$'),
 platform_account_id text NOT NULL CHECK(platform_account_id ~ '^acct_[A-Za-z0-9]{1,195}$'),
 connected_account_id text NOT NULL CHECK(connected_account_id ~ '^acct_[A-Za-z0-9]{1,195}$'),
 mode text NOT NULL DEFAULT 'test' CHECK(mode='test'),
 source text NOT NULL DEFAULT 'closed_test_fixture' CHECK(source='closed_test_fixture'),
 provider_origin_verified boolean NOT NULL DEFAULT false CHECK(provider_origin_verified=false),
 financial_posting_allowed boolean NOT NULL DEFAULT false CHECK(financial_posting_allowed=false),
 operation_created_at timestamptz NOT NULL, quote_expires_at timestamptz NOT NULL,
 session_expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(salon_id,appointment_id),
 FOREIGN KEY(salon_id,quote_id,appointment_id,connected_account_id,mode)
 REFERENCES customer_payment_prepared_quote(salon_id,id,appointment_id,stripe_account_id,mode) ON DELETE RESTRICT,
 CHECK(platform_account_id<>connected_account_id),
 CHECK(quote_expires_at>operation_created_at AND quote_expires_at<=operation_created_at+interval '5 minutes'),
 CHECK(session_expires_at>=quote_expires_at+interval '30 minutes' AND session_expires_at<=operation_created_at+interval '24 hours')
);
--> statement-breakpoint
CREATE TABLE customer_payment_closed_checkout_state (
 operation_id text PRIMARY KEY REFERENCES customer_payment_closed_checkout_operation(id) ON DELETE RESTRICT,
 version integer NOT NULL DEFAULT 0 CHECK(version>=0 AND version<2147483647),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','leased','dispatch_intent','uncertain','session_observed','review')),
 reason text NOT NULL DEFAULT 'not_dispatched' CHECK(reason IN ('not_dispatched','create_leased','dispatch_intent','create_consumed','create_outcome_unknown','session_response','retrieval_pending','retrieval_unresolved','no_bound_session','source_context_changed','session_evidence_mismatch','object_ownership_conflict','identity_conflict')),
 dispatch_intent_at timestamptz, create_consumed_at timestamptz,
 worker_id text, lease_token text, lease_until timestamptz, activity text CHECK(activity IN ('create','retrieve')),
 session jsonb, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((worker_id IS NULL AND lease_token IS NULL AND lease_until IS NULL AND activity IS NULL)
 OR (worker_id ~ '^[0-9a-f-]{36}$' AND lease_token ~ '^[0-9a-f-]{36}$' AND worker_id IS NOT NULL AND lease_token IS NOT NULL AND lease_until IS NOT NULL AND activity IS NOT NULL)),
 CHECK(create_consumed_at IS NULL OR (dispatch_intent_at IS NOT NULL AND create_consumed_at>=dispatch_intent_at)),
 CHECK(state NOT IN ('prepared','leased') OR dispatch_intent_at IS NULL),
 CHECK(state NOT IN ('dispatch_intent','uncertain','session_observed') OR dispatch_intent_at IS NOT NULL),
 CHECK(state<>'session_observed' OR session IS NOT NULL),
 CHECK(state<>'review' OR lease_token IS NULL)
);
--> statement-breakpoint
CREATE TABLE customer_payment_closed_checkout_object (
 platform_account_id text NOT NULL, connected_account_id text NOT NULL,
 mode text NOT NULL DEFAULT 'test' CHECK(mode='test'),
 object_id text NOT NULL CHECK(object_id ~ '^(cs_test|pi|ch)_[A-Za-z0-9]{1,240}$'),
 operation_id text NOT NULL REFERENCES customer_payment_closed_checkout_operation(id) ON DELETE RESTRICT,
 PRIMARY KEY(platform_account_id,connected_account_id,mode,object_id)
);
--> statement-breakpoint
CREATE TABLE customer_payment_closed_checkout_audit (
 operation_id text NOT NULL REFERENCES customer_payment_closed_checkout_operation(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>=0), snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(operation_id,version)
);
--> statement-breakpoint
CREATE FUNCTION customer_payment_closed_checkout_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'CLOSED_CHECKOUT_IMMUTABLE'; END $$;
--> statement-breakpoint
CREATE TRIGGER closed_checkout_operation_immutable BEFORE UPDATE OR DELETE ON customer_payment_closed_checkout_operation FOR EACH ROW EXECUTE FUNCTION customer_payment_closed_checkout_immutable();
--> statement-breakpoint
CREATE TRIGGER closed_checkout_object_immutable BEFORE UPDATE OR DELETE ON customer_payment_closed_checkout_object FOR EACH ROW EXECUTE FUNCTION customer_payment_closed_checkout_immutable();
--> statement-breakpoint
CREATE TRIGGER closed_checkout_audit_immutable BEFORE UPDATE OR DELETE ON customer_payment_closed_checkout_audit FOR EACH ROW EXECUTE FUNCTION customer_payment_closed_checkout_immutable();
--> statement-breakpoint
CREATE TRIGGER closed_checkout_state_no_delete BEFORE DELETE ON customer_payment_closed_checkout_state FOR EACH ROW EXECUTE FUNCTION customer_payment_closed_checkout_immutable();
--> statement-breakpoint
CREATE FUNCTION customer_payment_closed_checkout_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q customer_payment_prepared_quote;
BEGIN
 LOCK TABLE customer_payment_closed_checkout_operation IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 SELECT * INTO q FROM customer_payment_prepared_quote WHERE id=NEW.quote_id;
 IF q.id IS NULL OR q.executable IS DISTINCT FROM false OR q.mode IS DISTINCT FROM 'test'
 OR q.snapshot->>'collection' IS DISTINCT FROM 'full' OR q.fingerprint IS DISTINCT FROM NEW.context_hash
 OR q.expires_at IS DISTINCT FROM NEW.quote_expires_at OR date_trunc('milliseconds',q.created_at) IS DISTINCT FROM NEW.operation_created_at THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_QUOTE_BINDING'; END IF;
 NEW.created_at:=clock_timestamp();
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER closed_checkout_operation_guard BEFORE INSERT ON customer_payment_closed_checkout_operation FOR EACH ROW EXECUTE FUNCTION customer_payment_closed_checkout_operation_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_closed_checkout_object_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o customer_payment_closed_checkout_operation; s customer_payment_closed_checkout_state;
BEGIN
 LOCK TABLE customer_payment_closed_checkout_operation IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 SELECT * INTO o FROM customer_payment_closed_checkout_operation WHERE id=NEW.operation_id;
 SELECT * INTO s FROM customer_payment_closed_checkout_state WHERE operation_id=NEW.operation_id;
 IF o.id IS NULL OR s.dispatch_intent_at IS NULL
 OR ROW(NEW.platform_account_id,NEW.connected_account_id,NEW.mode) IS DISTINCT FROM ROW(o.platform_account_id,o.connected_account_id,o.mode)
 THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_OBJECT_SCOPE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER closed_checkout_object_guard BEFORE INSERT ON customer_payment_closed_checkout_object FOR EACH ROW EXECUTE FUNCTION customer_payment_closed_checkout_object_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_closed_checkout_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; k text; o customer_payment_closed_checkout_operation; t timestamptz;
BEGIN
 LOCK TABLE customer_payment_closed_checkout_operation IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 t:=clock_timestamp();
 SELECT * INTO o FROM customer_payment_closed_checkout_operation WHERE id=NEW.operation_id;
 IF o.id IS NULL THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_MISSING_OPERATION'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>0 OR NEW.state<>'prepared' OR NEW.reason<>'not_dispatched' OR NEW.dispatch_intent_at IS NOT NULL
  OR NEW.create_consumed_at IS NOT NULL OR NEW.lease_token IS NOT NULL OR NEW.session IS NOT NULL
  THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_INITIAL_STATE'; END IF;
 ELSE
  IF NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.version<>OLD.version+1 OR OLD.state='review'
  OR (OLD.dispatch_intent_at IS NOT NULL AND NEW.dispatch_intent_at IS DISTINCT FROM OLD.dispatch_intent_at)
  OR (OLD.create_consumed_at IS NOT NULL AND NEW.create_consumed_at IS DISTINCT FROM OLD.create_consumed_at)
  OR (OLD.state<>'prepared' AND NEW.state='prepared')
  OR (OLD.dispatch_intent_at IS NOT NULL AND NEW.state='leased')
  THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_FENCE_REGRESSION'; END IF;
  IF NEW.lease_token IS NOT NULL AND NEW.lease_token IS DISTINCT FROM OLD.lease_token THEN
   IF (OLD.lease_until IS NOT NULL AND OLD.lease_until>t) OR NEW.lease_until<=t OR NEW.lease_until>t+interval '5 minutes'
   OR (NEW.activity='create' AND (OLD.dispatch_intent_at IS NOT NULL OR NEW.state<>'leased' OR NEW.reason<>'create_leased'))
   OR (NEW.activity='retrieve' AND (OLD.dispatch_intent_at IS NULL OR OLD.session IS NULL OR NEW.state IS DISTINCT FROM OLD.state OR NEW.reason<>'retrieval_pending'))
   OR NEW.session IS DISTINCT FROM OLD.session
   THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_LEASE_ISSUANCE'; END IF;
  ELSIF NEW.lease_token IS NOT NULL THEN
   IF OLD.lease_until<=t OR ROW(NEW.worker_id,NEW.lease_until,NEW.activity) IS DISTINCT FROM ROW(OLD.worker_id,OLD.lease_until,OLD.activity)
   THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_LEASE_FENCED'; END IF;
  END IF;
  IF NEW.state<>'review' THEN
   IF NEW.reason='session_response' AND (OLD.lease_token IS NULL OR OLD.lease_until<=t OR NEW.lease_token IS NOT NULL OR NEW.state<>'session_observed' OR (OLD.activity='create' AND OLD.create_consumed_at IS NULL))
   THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_RESPONSE_FENCED'; END IF;
   IF NEW.session IS DISTINCT FROM OLD.session AND NEW.reason<>'session_response'
   THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_SESSION_TRANSITION'; END IF;
   IF NEW.reason IN ('create_outcome_unknown','retrieval_unresolved') AND (OLD.lease_token IS NULL OR OLD.lease_until<=t OR NEW.state<>'uncertain' OR NEW.lease_token IS NOT NULL)
   THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_FAILURE_FENCED'; END IF;
   IF NEW.reason='no_bound_session' AND (NEW.session IS NOT NULL OR NEW.dispatch_intent_at IS NULL OR NEW.state<>'uncertain' OR NEW.lease_token IS NOT NULL OR (OLD.lease_until IS NOT NULL AND OLD.lease_until>t))
   THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_NO_SESSION_FENCED'; END IF;
   IF NEW.state='leased' AND (NEW.activity IS DISTINCT FROM 'create' OR NEW.lease_token IS NULL)
   THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_LEASE_STATE'; END IF;
   IF NEW.state='dispatch_intent' AND (NEW.activity IS DISTINCT FROM 'create' OR NEW.lease_token IS NULL)
   THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_INTENT_STATE'; END IF;
  ELSIF NEW.session IS DISTINCT FROM OLD.session THEN
   RAISE EXCEPTION 'CLOSED_CHECKOUT_REVIEW_EVIDENCE';
  END IF;
  IF OLD.dispatch_intent_at IS NULL AND NEW.dispatch_intent_at IS NOT NULL THEN
   IF OLD.state<>'leased' OR OLD.activity IS DISTINCT FROM 'create' OR OLD.lease_until<=t
   OR NEW.lease_token IS DISTINCT FROM OLD.lease_token OR NEW.state<>'dispatch_intent'
   OR t<o.operation_created_at OR t>=o.quote_expires_at
   THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_INTENT_FENCE'; END IF;
   NEW.dispatch_intent_at:=t;
  END IF;
  IF OLD.create_consumed_at IS NULL AND NEW.create_consumed_at IS NOT NULL THEN
   IF OLD.dispatch_intent_at IS NULL OR OLD.activity IS DISTINCT FROM 'create' OR OLD.lease_until<=t
   OR NEW.lease_token IS DISTINCT FROM OLD.lease_token OR t>=o.quote_expires_at
   THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_CONSUME_FENCE'; END IF;
   NEW.create_consumed_at:=t;
  END IF;
  IF OLD.session IS NOT NULL THEN
   IF NEW.session IS NULL OR NEW.session->>'sessionId' IS DISTINCT FROM OLD.session->>'sessionId'
   OR (OLD.session->>'paymentIntentId' IS NOT NULL AND NEW.session->>'paymentIntentId' IS DISTINCT FROM OLD.session->>'paymentIntentId')
   OR (OLD.session->>'status'<>'open' AND NEW.session->>'status' IS DISTINCT FROM OLD.session->>'status')
   OR (OLD.session->>'paymentStatus'='paid' AND NEW.session->>'paymentStatus' IS DISTINCT FROM 'paid')
   OR (OLD.session->>'feeCheck'='captured_charge_amount_matches' AND (NEW.session->>'feeCheck' IS DISTINCT FROM 'captured_charge_amount_matches' OR NEW.session->>'chargeId' IS DISTINCT FROM OLD.session->>'chargeId'))
   THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_EVIDENCE_REGRESSION'; END IF;
  END IF;
 END IF;
 p:=NEW.session;
 IF p IS NOT NULL THEN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
  OR NOT (p ?& ARRAY['sessionId','status','paymentStatus','paymentIntentId','chargeId','feeCheck','financialPostingAllowed'])
  OR p-ARRAY['sessionId','status','paymentStatus','paymentIntentId','chargeId','feeCheck','financialPostingAllowed']<>'{}'::jsonb
  OR jsonb_typeof(p->'sessionId') IS DISTINCT FROM 'string' OR (p->>'sessionId') !~ '^cs_test_[A-Za-z0-9]{1,240}$'
  OR (p->>'status') IS NULL OR (p->>'status') NOT IN ('open','complete','expired')
  OR (p->>'paymentStatus') IS NULL OR (p->>'paymentStatus') NOT IN ('unpaid','paid')
  OR (p->>'feeCheck') IS NULL OR (p->>'feeCheck') NOT IN ('awaiting_intent','intent_amount_matches','captured_charge_amount_matches')
  OR p->'financialPostingAllowed' IS DISTINCT FROM 'false'::jsonb
  OR (p->'paymentIntentId'<>'null'::jsonb AND (jsonb_typeof(p->'paymentIntentId')<>'string' OR (p->>'paymentIntentId') !~ '^pi_[A-Za-z0-9]{1,240}$'))
  OR (p->'chargeId'<>'null'::jsonb AND (jsonb_typeof(p->'chargeId')<>'string' OR (p->>'chargeId') !~ '^ch_[A-Za-z0-9]{1,240}$'))
  OR (p->>'paymentStatus'='paid' AND (p->>'status'<>'complete' OR p->>'paymentIntentId' IS NULL))
  OR (p->>'feeCheck'='captured_charge_amount_matches' AND (p->>'chargeId' IS NULL OR p->>'paymentIntentId' IS NULL OR p->>'paymentStatus'<>'paid'))
  OR NEW.dispatch_intent_at IS NULL
  THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_PROJECTION_INVALID'; END IF;
  FOREACH k IN ARRAY ARRAY[p->>'sessionId',p->>'paymentIntentId',p->>'chargeId'] LOOP
   IF k IS NOT NULL AND NOT EXISTS(SELECT 1 FROM customer_payment_closed_checkout_object x WHERE x.platform_account_id=o.platform_account_id AND x.connected_account_id=o.connected_account_id AND x.mode=o.mode AND x.object_id=k AND x.operation_id=o.id)
   THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_UNOWNED_OBJECT'; END IF;
  END LOOP;
 END IF;
 NEW.updated_at:=t;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER closed_checkout_state_guard BEFORE INSERT OR UPDATE ON customer_payment_closed_checkout_state FOR EACH ROW EXECUTE FUNCTION customer_payment_closed_checkout_state_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_closed_checkout_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s customer_payment_closed_checkout_state;
BEGIN
 SELECT * INTO s FROM customer_payment_closed_checkout_state WHERE operation_id=NEW.operation_id;
 IF s.operation_id IS NULL OR s.version IS DISTINCT FROM NEW.version OR NEW.snapshot IS DISTINCT FROM to_jsonb(s)
 THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_AUDIT_INVALID'; END IF;
 NEW.created_at:=clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER closed_checkout_audit_guard BEFORE INSERT ON customer_payment_closed_checkout_audit FOR EACH ROW EXECUTE FUNCTION customer_payment_closed_checkout_audit_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_closed_checkout_audit_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 INSERT INTO customer_payment_closed_checkout_audit(operation_id,version,snapshot) VALUES(NEW.operation_id,NEW.version,to_jsonb(NEW));
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_AUDIT_WRITE_FAILED'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER closed_checkout_audit_write AFTER INSERT OR UPDATE ON customer_payment_closed_checkout_state FOR EACH ROW EXECUTE FUNCTION customer_payment_closed_checkout_audit_write();
--> statement-breakpoint
CREATE TABLE customer_payment_closed_checkout_conflict (
 id text PRIMARY KEY CHECK(id ~ '^[0-9a-f-]{36}$'),
 operation_id text NOT NULL REFERENCES customer_payment_closed_checkout_operation(id) ON DELETE RESTRICT,
 contender_identity_hash text NOT NULL CHECK(contender_identity_hash ~ '^[a-f0-9]{64}$'),
 reason text NOT NULL CHECK(reason IN ('identity_conflict','object_ownership_conflict')),
 object_id text CHECK(object_id ~ '^(cs_test|pi|ch)_[A-Za-z0-9]{1,240}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((reason='identity_conflict' AND object_id IS NULL) OR (reason='object_ownership_conflict' AND object_id IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX closed_checkout_conflict_once ON customer_payment_closed_checkout_conflict(operation_id,contender_identity_hash,reason,coalesce(object_id,''));
--> statement-breakpoint
CREATE TRIGGER closed_checkout_conflict_immutable BEFORE UPDATE OR DELETE ON customer_payment_closed_checkout_conflict FOR EACH ROW EXECUTE FUNCTION customer_payment_closed_checkout_immutable();
--> statement-breakpoint
-- Only allowlisted redacted observations, including late fenced results, survive.
CREATE TABLE customer_payment_closed_checkout_observation (
 operation_id text NOT NULL REFERENCES customer_payment_closed_checkout_operation(id) ON DELETE RESTRICT,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 claim_version integer NOT NULL CHECK(claim_version>=0),
 outcome text NOT NULL CHECK(outcome IN ('accepted','rejected')), late boolean NOT NULL,
 session_id text CHECK(session_id ~ '^cs_test_[A-Za-z0-9]{1,240}$'),
 payment_intent_id text CHECK(payment_intent_id ~ '^pi_[A-Za-z0-9]{1,240}$'),
 charge_id text CHECK(charge_id ~ '^ch_[A-Za-z0-9]{1,240}$'),
 status text CHECK(status IN ('open','complete','expired')),
 payment_status text CHECK(payment_status IN ('unpaid','paid')),
 fee_check text CHECK(fee_check IN ('awaiting_intent','intent_amount_matches','captured_charge_amount_matches')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(operation_id,fingerprint),
 FOREIGN KEY(operation_id,claim_version) REFERENCES customer_payment_closed_checkout_audit(operation_id,version) ON DELETE RESTRICT,
 CHECK((outcome='rejected' AND session_id IS NULL AND payment_intent_id IS NULL AND charge_id IS NULL AND status IS NULL AND payment_status IS NULL AND fee_check IS NULL)
 OR (outcome='accepted' AND session_id IS NOT NULL AND status IS NOT NULL AND payment_status IS NOT NULL AND fee_check IS NOT NULL)),
 CHECK(payment_status IS DISTINCT FROM 'paid' OR (status='complete' AND payment_intent_id IS NOT NULL)),
 CHECK(fee_check IS DISTINCT FROM 'captured_charge_amount_matches' OR (payment_intent_id IS NOT NULL AND charge_id IS NOT NULL AND payment_status='paid'))
);
--> statement-breakpoint
CREATE TRIGGER closed_checkout_observation_immutable BEFORE UPDATE OR DELETE ON customer_payment_closed_checkout_observation FOR EACH ROW EXECUTE FUNCTION customer_payment_closed_checkout_immutable();
