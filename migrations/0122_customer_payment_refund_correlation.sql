-- Offline movement correlations only; no financial authority or original inbox updates.
CREATE TABLE customer_payment_refund_projection(
 id text PRIMARY KEY,inbox_id text NOT NULL REFERENCES customer_payment_provider_inbox(id) ON DELETE RESTRICT,
 projection_version integer NOT NULL CHECK(projection_version=1),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 receipt_fingerprint text NOT NULL,projection jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_refund_projection_once ON customer_payment_refund_projection(inbox_id,projection_version,fingerprint);
--> statement-breakpoint
CREATE TABLE customer_payment_refund_correlation_link(
 id text PRIMARY KEY,operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,
 inbox_id text NOT NULL REFERENCES customer_payment_provider_inbox(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_refund_correlation_link_once ON customer_payment_refund_correlation_link(operation_id,inbox_id);
--> statement-breakpoint
CREATE TABLE customer_payment_refund_correlation(
 id text PRIMARY KEY,operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,
 parent_operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0),source_revision text NOT NULL CHECK(source_revision ~ '^[a-f0-9]{64}$'),
 ownership_revision text NOT NULL CHECK(ownership_revision ~ '^[a-f0-9]{64}$'),source jsonb NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_refund_correlation_version_once ON customer_payment_refund_correlation(operation_id,version);
--> statement-breakpoint
CREATE TABLE customer_payment_movement_candidate(
 id text PRIMARY KEY, movement_key_hash text NOT NULL CHECK(movement_key_hash ~ '^[a-f0-9]{64}$'), movement_key jsonb NOT NULL,
 first_operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_movement_candidate_once ON customer_payment_movement_candidate(movement_key_hash);
--> statement-breakpoint
CREATE TABLE customer_payment_movement_claim(
 id text PRIMARY KEY,candidate_id text NOT NULL REFERENCES customer_payment_movement_candidate(id) ON DELETE RESTRICT,
 operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,
 correlation_id text NOT NULL REFERENCES customer_payment_refund_correlation(id) ON DELETE RESTRICT,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),facts jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_movement_claim_once ON customer_payment_movement_claim(candidate_id,operation_id,fingerprint);
--> statement-breakpoint
CREATE FUNCTION customer_payment_refund_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r customer_payment_provider_inbox; p jsonb:=NEW.projection;
BEGIN
 PERFORM id FROM customer_payment_correlation_mutex WHERE id=1 FOR UPDATE;
 SELECT * INTO r FROM customer_payment_provider_inbox WHERE id=NEW.inbox_id;
 IF r.id IS NULL OR NEW.receipt_fingerprint IS DISTINCT FROM r.fingerprint OR jsonb_typeof(p) IS DISTINCT FROM 'object'
 OR NOT(p ?& ARRAY['version','projectionVersion','source','payloadDigest','eventId','eventType','receiptIdentity','endpointId','platformId','accountScope','expectedAccountId','accountId','mode','apiVersion','receivedAt','kind','movementId','chargeId','paymentIntentId','applicationFeeId','amountCents','currency','status','outcome','eventCreated','objectCreated','classification','reviewReasons'])
 OR p->'version' IS DISTINCT FROM '1'::jsonb OR p->'projectionVersion' IS DISTINCT FROM '1'::jsonb
 OR p->>'source' IS DISTINCT FROM 'offline_signed_fixture_refund'
 OR p->>'classification' IS NULL OR p->>'classification' NOT IN ('correlatable','review')
 OR jsonb_typeof(p->'reviewReasons') IS DISTINCT FROM 'array'
 OR jsonb_typeof(p->'receivedAt') IS DISTINCT FROM 'string'
 OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.key IN ('kind','movementId','chargeId','paymentIntentId','applicationFeeId','currency','status','outcome') AND jsonb_typeof(e.value) NOT IN ('null','string'))
 OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.key IN ('amountCents','eventCreated','objectCreated') AND jsonb_typeof(e.value) NOT IN ('null','number'))
 OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.key IN ('payloadDigest','eventId','eventType','receiptIdentity','endpointId','platformId','accountScope','expectedAccountId','accountId','mode','apiVersion') AND e.value IS DISTINCT FROM r.receipt->e.key)
 OR NEW.fingerprint IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(p-'receivedAt'),'UTF8')),'hex') THEN
 RAISE EXCEPTION 'CUSTOMER_PAYMENT_REFUND_PROJECTION_INVALID'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_refund_projection_guard BEFORE INSERT ON customer_payment_refund_projection FOR EACH ROW EXECUTE FUNCTION customer_payment_refund_projection_guard();
--> statement-breakpoint
CREATE TRIGGER customer_payment_refund_correlation_link_guard BEFORE INSERT ON customer_payment_refund_correlation_link FOR EACH ROW EXECUTE FUNCTION customer_payment_correlation_link_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_refund_correlation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous integer; o customer_payment_provider_operation; p customer_payment_provider_operation;
BEGIN
 PERFORM id FROM customer_payment_correlation_mutex WHERE id=1 FOR UPDATE;
 SELECT * INTO o FROM customer_payment_provider_operation WHERE id=NEW.operation_id FOR UPDATE;
 SELECT * INTO p FROM customer_payment_provider_operation WHERE id=NEW.parent_operation_id;
 SELECT coalesce(max(version),0) INTO previous FROM customer_payment_refund_correlation WHERE operation_id=NEW.operation_id;
 IF o.id IS NULL OR p.id IS NULL OR p.identity->>'kind' IS DISTINCT FROM 'checkout_create'
 OR o.identity->>'kind' IS NULL OR o.identity->>'kind' NOT IN ('customer_refund','application_fee_refund')
 OR ROW(o.identity->>'salonId',o.identity->>'appointmentId',o.identity->>'quoteId',o.identity->>'platformId',o.identity->>'contextHash') IS DISTINCT FROM ROW(p.identity->>'salonId',p.identity->>'appointmentId',p.identity->>'quoteId',p.identity->>'platformId',p.identity->>'contextHash')
 OR EXISTS(SELECT 1 FROM customer_payment_refund_correlation WHERE operation_id=NEW.operation_id AND parent_operation_id<>NEW.parent_operation_id)
 OR NEW.version<>previous+1 OR jsonb_typeof(NEW.source) IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.result) IS DISTINCT FROM 'object'
 OR NOT(NEW.result ?& ARRAY['source','state','reasons','financialPostingAllowed','candidate','totals'])
 OR NEW.result->>'source' IS DISTINCT FROM 'offline_fixture_refund_correlation' OR NEW.result->'financialPostingAllowed' IS DISTINCT FROM 'false'::jsonb
 OR NEW.result->>'state' IS NULL OR NEW.result->>'state' NOT IN ('pending','correlated','review') OR jsonb_typeof(NEW.result->'reasons') IS DISTINCT FROM 'array'
 OR (NEW.result->'totals' IS DISTINCT FROM 'null'::jsonb AND jsonb_typeof(NEW.result->'totals') IS DISTINCT FROM 'object')
 OR NEW.source#>>'{operation,identity,id}' IS DISTINCT FROM NEW.operation_id
 OR NEW.source#>>'{parent,operation,identity,id}' IS DISTINCT FROM NEW.parent_operation_id
 OR NEW.source_revision IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(NEW.source),'UTF8')),'hex') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_REFUND_CORRELATION_INVALID'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_refund_correlation_guard BEFORE INSERT ON customer_payment_refund_correlation FOR EACH ROW EXECUTE FUNCTION customer_payment_refund_correlation_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_movement_candidate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o customer_payment_provider_operation; k jsonb:=NEW.movement_key;
BEGIN
 PERFORM id FROM customer_payment_correlation_mutex WHERE id=1 FOR UPDATE;
 SELECT * INTO o FROM customer_payment_provider_operation WHERE id=NEW.first_operation_id;
 IF o.id IS NULL OR jsonb_typeof(k) IS DISTINCT FROM 'object'
 OR NOT(k ?& ARRAY['platformId','accountScope','accountId','mode','kind','movementId'])
 OR (SELECT count(*) FROM jsonb_object_keys(k))<>6
 OR k->>'kind' IS NULL OR k->>'kind' NOT IN ('customer_refund','application_fee_refund')
 OR ROW(k->>'platformId',k->>'accountScope',k->>'accountId',k->>'mode',k->>'kind') IS DISTINCT FROM ROW(o.identity->>'platformId',o.identity->>'accountScope',o.identity->>'accountId',o.identity->>'mode',o.identity->>'kind')
 OR k->>'movementId' IS NULL OR NOT (CASE WHEN k->>'kind'='customer_refund' THEN k->>'movementId' ~ '^re_[A-Za-z0-9]+$' ELSE k->>'movementId' ~ '^fr_[A-Za-z0-9]+$' END)
 OR NEW.movement_key_hash IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(k),'UTF8')),'hex') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_MOVEMENT_CANDIDATE_SCOPE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_movement_candidate_guard BEFORE INSERT ON customer_payment_movement_candidate FOR EACH ROW EXECUTE FUNCTION customer_payment_movement_candidate_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_movement_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c customer_payment_movement_candidate; a customer_payment_refund_correlation; o customer_payment_provider_operation;
BEGIN
 PERFORM id FROM customer_payment_correlation_mutex WHERE id=1 FOR UPDATE;
 SELECT * INTO c FROM customer_payment_movement_candidate WHERE id=NEW.candidate_id;
 SELECT * INTO a FROM customer_payment_refund_correlation WHERE id=NEW.correlation_id;
 SELECT * INTO o FROM customer_payment_provider_operation WHERE id=NEW.operation_id;
 IF c.id IS NULL OR a.id IS NULL OR o.id IS NULL OR a.operation_id<>NEW.operation_id
 OR NEW.facts IS DISTINCT FROM a.result->'candidate' OR jsonb_typeof(NEW.facts) IS DISTINCT FROM 'object'
 OR NEW.facts->>'fingerprint' IS DISTINCT FROM NEW.fingerprint OR NEW.facts->>'operationId' IS DISTINCT FROM NEW.operation_id
 OR NEW.facts->'movementKey' IS DISTINCT FROM c.movement_key
 OR ROW(o.identity->>'platformId',o.identity->>'accountScope',o.identity->>'accountId',o.identity->>'mode',o.identity->>'kind') IS DISTINCT FROM ROW(c.movement_key->>'platformId',c.movement_key->>'accountScope',c.movement_key->>'accountId',c.movement_key->>'mode',c.movement_key->>'kind') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_MOVEMENT_CLAIM_INVALID'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_movement_claim_guard BEFORE INSERT ON customer_payment_movement_claim FOR EACH ROW EXECUTE FUNCTION customer_payment_movement_claim_guard();

--> statement-breakpoint
CREATE TRIGGER customer_payment_refund_projection_immutable BEFORE UPDATE OR DELETE ON customer_payment_refund_projection FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();

--> statement-breakpoint
CREATE TRIGGER customer_payment_refund_correlation_link_immutable BEFORE UPDATE OR DELETE ON customer_payment_refund_correlation_link FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();

--> statement-breakpoint
CREATE TRIGGER customer_payment_refund_correlation_immutable BEFORE UPDATE OR DELETE ON customer_payment_refund_correlation FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();

--> statement-breakpoint
CREATE TRIGGER customer_payment_movement_candidate_immutable BEFORE UPDATE OR DELETE ON customer_payment_movement_candidate FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();

--> statement-breakpoint
CREATE TRIGGER customer_payment_movement_claim_immutable BEFORE UPDATE OR DELETE ON customer_payment_movement_claim FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
