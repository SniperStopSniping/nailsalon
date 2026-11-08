-- Offline graph evidence only; never financial posting or old inbox promotion.
CREATE TABLE customer_payment_correlation_mutex(id integer PRIMARY KEY CHECK(id=1), revision integer NOT NULL DEFAULT 0 CHECK(revision>=0));
--> statement-breakpoint
INSERT INTO customer_payment_correlation_mutex(id) VALUES(1);
--> statement-breakpoint
CREATE TABLE customer_payment_session_projection(
 id text PRIMARY KEY,inbox_id text NOT NULL REFERENCES customer_payment_provider_inbox(id) ON DELETE RESTRICT,
 projection_version integer NOT NULL CHECK(projection_version=1),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 receipt_fingerprint text NOT NULL,projection jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_session_projection_once ON customer_payment_session_projection(inbox_id,projection_version,fingerprint);
--> statement-breakpoint
CREATE TABLE customer_payment_correlation_link(
 id text PRIMARY KEY,operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,
 inbox_id text NOT NULL REFERENCES customer_payment_provider_inbox(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_correlation_link_once ON customer_payment_correlation_link(operation_id,inbox_id);
--> statement-breakpoint
CREATE TABLE customer_payment_correlation(
 id text PRIMARY KEY,operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0),source_revision text NOT NULL CHECK(source_revision ~ '^[a-f0-9]{64}$'),
 ownership_revision text NOT NULL CHECK(ownership_revision ~ '^[a-f0-9]{64}$'),source jsonb NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_correlation_version_once ON customer_payment_correlation(operation_id,version);
--> statement-breakpoint
CREATE TABLE customer_payment_charge_candidate(
 id text PRIMARY KEY,platform_id text NOT NULL CHECK(platform_id ~ '^acct_[A-Za-z0-9]+$'),account_id text NOT NULL CHECK(account_id ~ '^acct_[A-Za-z0-9]+$'),
 mode text NOT NULL CHECK(mode='test'),charge_id text NOT NULL CHECK(charge_id ~ '^ch_[A-Za-z0-9]+$'),
 first_operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_charge_candidate_once ON customer_payment_charge_candidate(platform_id,account_id,mode,charge_id);
--> statement-breakpoint
CREATE TABLE customer_payment_charge_claim(
 id text PRIMARY KEY,candidate_id text NOT NULL REFERENCES customer_payment_charge_candidate(id) ON DELETE RESTRICT,
 operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,
 correlation_id text NOT NULL REFERENCES customer_payment_correlation(id) ON DELETE RESTRICT,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),facts jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_charge_claim_once ON customer_payment_charge_claim(candidate_id,operation_id,fingerprint);
--> statement-breakpoint
CREATE FUNCTION customer_payment_session_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r customer_payment_provider_inbox; p jsonb:=NEW.projection;
BEGIN
 PERFORM id FROM customer_payment_correlation_mutex WHERE id=1 FOR UPDATE;
 SELECT * INTO r FROM customer_payment_provider_inbox WHERE id=NEW.inbox_id;
 IF r.id IS NULL OR NEW.receipt_fingerprint IS DISTINCT FROM r.fingerprint OR jsonb_typeof(p) IS DISTINCT FROM 'object'
 OR NOT(p ?& ARRAY['version','projectionVersion','source','payloadDigest','eventId','eventType','receiptIdentity','endpointId','platformId','accountScope','expectedAccountId','accountId','mode','apiVersion','receivedAt','sessionId','paymentIntentId','sessionMode','status','paymentStatus','amountTotalCents','currency','clientReferenceId','eventCreated','sessionCreated','expiresAt','classification','reviewReasons'])
 OR p->'version' IS DISTINCT FROM '1'::jsonb OR p->'projectionVersion' IS DISTINCT FROM '1'::jsonb
 OR p->>'source' IS DISTINCT FROM 'offline_signed_fixture_session' OR p->>'classification' IS NULL OR p->>'classification' NOT IN ('correlatable','review')
 OR jsonb_typeof(p->'reviewReasons') IS DISTINCT FROM 'array'
 OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.key IN ('eventId','eventType','expectedAccountId','accountId','apiVersion','sessionId','paymentIntentId','sessionMode','status','paymentStatus','currency','clientReferenceId') AND jsonb_typeof(e.value) NOT IN ('null','string'))
 OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.key IN ('amountTotalCents','eventCreated','sessionCreated','expiresAt') AND jsonb_typeof(e.value) NOT IN ('null','number'))
 OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.key IN ('payloadDigest','eventId','eventType','receiptIdentity','endpointId','platformId','accountScope','expectedAccountId','accountId','mode','apiVersion') AND e.value IS DISTINCT FROM r.receipt->e.key)
 OR NEW.fingerprint IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(p-'receivedAt'),'UTF8')),'hex') THEN
 RAISE EXCEPTION 'CUSTOMER_PAYMENT_SESSION_PROJECTION_INVALID'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_session_projection_guard BEFORE INSERT ON customer_payment_session_projection FOR EACH ROW EXECUTE FUNCTION customer_payment_session_projection_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_correlation_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o customer_payment_provider_operation; r customer_payment_provider_inbox;
BEGIN
 PERFORM id FROM customer_payment_correlation_mutex WHERE id=1 FOR UPDATE;
 SELECT * INTO o FROM customer_payment_provider_operation WHERE id=NEW.operation_id;
 SELECT * INTO r FROM customer_payment_provider_inbox WHERE id=NEW.inbox_id;
 IF o.id IS NULL OR r.id IS NULL OR o.identity->>'platformId' IS DISTINCT FROM r.platform_id THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_CORRELATION_SCOPE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_correlation_link_guard BEFORE INSERT ON customer_payment_correlation_link FOR EACH ROW EXECUTE FUNCTION customer_payment_correlation_link_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_correlation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous integer;
BEGIN
 PERFORM id FROM customer_payment_correlation_mutex WHERE id=1 FOR UPDATE;
 PERFORM id FROM customer_payment_provider_operation WHERE id=NEW.operation_id FOR UPDATE;
 SELECT coalesce(max(version),0) INTO previous FROM customer_payment_correlation WHERE operation_id=NEW.operation_id;
 IF NEW.version<>previous+1 OR jsonb_typeof(NEW.source) IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.result) IS DISTINCT FROM 'object'
 OR NOT(NEW.result ?& ARRAY['source','state','reasons','financialPostingAllowed','captureCandidate','fee'])
 OR NEW.result->>'source' IS DISTINCT FROM 'offline_fixture_correlation' OR NEW.result->'financialPostingAllowed' IS DISTINCT FROM 'false'::jsonb
 OR NEW.result->>'state' IS NULL OR NEW.result->>'state' NOT IN ('pending','correlated','review') OR jsonb_typeof(NEW.result->'reasons') IS DISTINCT FROM 'array'
 OR jsonb_typeof(NEW.result->'fee') IS DISTINCT FROM 'object'
 OR NEW.source#>>'{operation,identity,id}' IS DISTINCT FROM NEW.operation_id
 OR NEW.source_revision IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(NEW.source),'UTF8')),'hex') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_CORRELATION_INVALID'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_correlation_guard BEFORE INSERT ON customer_payment_correlation FOR EACH ROW EXECUTE FUNCTION customer_payment_correlation_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_charge_candidate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o customer_payment_provider_operation;
BEGIN
 PERFORM id FROM customer_payment_correlation_mutex WHERE id=1 FOR UPDATE;
 SELECT * INTO o FROM customer_payment_provider_operation WHERE id=NEW.first_operation_id;
 IF o.id IS NULL OR o.identity->>'kind' IS DISTINCT FROM 'checkout_create'
 OR o.identity->>'platformId' IS DISTINCT FROM NEW.platform_id
 OR o.identity->>'accountId' IS DISTINCT FROM NEW.account_id
 OR o.identity->>'mode' IS DISTINCT FROM NEW.mode THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_CHARGE_CANDIDATE_SCOPE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_charge_candidate_guard BEFORE INSERT ON customer_payment_charge_candidate FOR EACH ROW EXECUTE FUNCTION customer_payment_charge_candidate_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_charge_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c customer_payment_charge_candidate; a customer_payment_correlation; o customer_payment_provider_operation;
BEGIN
 PERFORM id FROM customer_payment_correlation_mutex WHERE id=1 FOR UPDATE;
 SELECT * INTO c FROM customer_payment_charge_candidate WHERE id=NEW.candidate_id;
 SELECT * INTO a FROM customer_payment_correlation WHERE id=NEW.correlation_id;
 SELECT * INTO o FROM customer_payment_provider_operation WHERE id=NEW.operation_id;
 IF c.id IS NULL OR a.id IS NULL OR o.id IS NULL OR a.operation_id<>NEW.operation_id
 OR NEW.facts IS DISTINCT FROM a.result->'captureCandidate' OR jsonb_typeof(NEW.facts) IS DISTINCT FROM 'object'
 OR NEW.facts->>'fingerprint' IS DISTINCT FROM NEW.fingerprint
 OR ROW(NEW.facts#>>'{chargeKey,platformId}',NEW.facts#>>'{chargeKey,accountId}',NEW.facts#>>'{chargeKey,mode}',NEW.facts#>>'{chargeKey,chargeId}')
 IS DISTINCT FROM ROW(c.platform_id,c.account_id,c.mode,c.charge_id)
 OR o.identity->>'platformId' IS DISTINCT FROM c.platform_id OR o.identity->>'accountId' IS DISTINCT FROM c.account_id OR o.identity->>'mode' IS DISTINCT FROM c.mode THEN
 RAISE EXCEPTION 'CUSTOMER_PAYMENT_CHARGE_CLAIM_INVALID'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_charge_claim_guard BEFORE INSERT ON customer_payment_charge_claim FOR EACH ROW EXECUTE FUNCTION customer_payment_charge_claim_guard();

--> statement-breakpoint
CREATE TRIGGER customer_payment_session_projection_immutable BEFORE UPDATE OR DELETE ON customer_payment_session_projection FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();

--> statement-breakpoint
CREATE TRIGGER customer_payment_correlation_link_immutable BEFORE UPDATE OR DELETE ON customer_payment_correlation_link FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();

--> statement-breakpoint
CREATE TRIGGER customer_payment_correlation_immutable BEFORE UPDATE OR DELETE ON customer_payment_correlation FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();

--> statement-breakpoint
CREATE TRIGGER customer_payment_charge_candidate_immutable BEFORE UPDATE OR DELETE ON customer_payment_charge_candidate FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();

--> statement-breakpoint
CREATE TRIGGER customer_payment_charge_claim_immutable BEFORE UPDATE OR DELETE ON customer_payment_charge_claim FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();

--> statement-breakpoint
CREATE FUNCTION customer_payment_correlation_mutex_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_CORRELATION_MUTEX_IMMUTABLE'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.revision IS DISTINCT FROM OLD.revision+1 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_CORRELATION_MUTEX_INVALID'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_correlation_mutex_guard BEFORE UPDATE OR DELETE ON customer_payment_correlation_mutex FOR EACH ROW EXECUTE FUNCTION customer_payment_correlation_mutex_guard();
