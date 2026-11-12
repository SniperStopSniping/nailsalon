-- Offline dispute lifecycle and signed balance movements only. No financial posting.
CREATE TABLE customer_payment_dispute_projection(
 id text PRIMARY KEY,inbox_id text NOT NULL REFERENCES customer_payment_provider_inbox(id) ON DELETE RESTRICT,
 conflict_id text REFERENCES customer_payment_provider_conflict(id) ON DELETE RESTRICT,
 projection_version integer NOT NULL CHECK(projection_version=1),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 receipt_fingerprint text NOT NULL,projection jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_dispute_projection_once ON customer_payment_dispute_projection(inbox_id,projection_version,receipt_fingerprint,fingerprint);
--> statement-breakpoint
CREATE TABLE customer_payment_dispute_correlation_link(
 id text PRIMARY KEY,operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,
 inbox_id text NOT NULL REFERENCES customer_payment_provider_inbox(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_dispute_correlation_link_once ON customer_payment_dispute_correlation_link(operation_id,inbox_id);
--> statement-breakpoint
CREATE TABLE customer_payment_dispute_correlation(
 id text PRIMARY KEY,operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0),source_revision text NOT NULL CHECK(source_revision ~ '^[a-f0-9]{64}$'),
 ownership_revision text NOT NULL CHECK(ownership_revision ~ '^[a-f0-9]{64}$'),source jsonb NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_dispute_correlation_version_once ON customer_payment_dispute_correlation(operation_id,version);
--> statement-breakpoint
CREATE TABLE customer_payment_dispute_candidate(
 id text PRIMARY KEY,key_hash text NOT NULL CHECK(key_hash ~ '^[a-f0-9]{64}$'),key jsonb NOT NULL,
 first_operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_dispute_candidate_once ON customer_payment_dispute_candidate(key_hash);
--> statement-breakpoint
CREATE TABLE customer_payment_dispute_claim(
 id text PRIMARY KEY,candidate_id text NOT NULL REFERENCES customer_payment_dispute_candidate(id) ON DELETE RESTRICT,
 operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,
 correlation_id text NOT NULL REFERENCES customer_payment_dispute_correlation(id) ON DELETE RESTRICT,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),facts jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_dispute_claim_once ON customer_payment_dispute_claim(candidate_id,operation_id,fingerprint);
--> statement-breakpoint
CREATE TABLE customer_payment_dispute_balance_candidate(
 id text PRIMARY KEY,key_hash text NOT NULL CHECK(key_hash ~ '^[a-f0-9]{64}$'),key jsonb NOT NULL,
 first_operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_dispute_balance_candidate_once ON customer_payment_dispute_balance_candidate(key_hash);
--> statement-breakpoint
CREATE TABLE customer_payment_dispute_balance_claim(
 id text PRIMARY KEY,candidate_id text NOT NULL REFERENCES customer_payment_dispute_balance_candidate(id) ON DELETE RESTRICT,
 operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,
 correlation_id text NOT NULL REFERENCES customer_payment_dispute_correlation(id) ON DELETE RESTRICT,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),facts jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_dispute_balance_claim_once ON customer_payment_dispute_balance_claim(candidate_id,operation_id,fingerprint);
--> statement-breakpoint
CREATE FUNCTION customer_payment_dispute_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r customer_payment_provider_inbox; c customer_payment_provider_conflict; expected jsonb; expected_fingerprint text; p jsonb:=NEW.projection;
BEGIN
 PERFORM id FROM customer_payment_correlation_mutex WHERE id=1 FOR UPDATE;
 SELECT * INTO r FROM customer_payment_provider_inbox WHERE id=NEW.inbox_id;
 expected:=r.receipt; expected_fingerprint:=r.fingerprint;
 IF NEW.conflict_id IS NOT NULL THEN
  SELECT * INTO c FROM customer_payment_provider_conflict WHERE id=NEW.conflict_id;
  IF c.id IS NULL OR c.inbox_id IS DISTINCT FROM NEW.inbox_id THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_DISPUTE_CONFLICT_BINDING'; END IF;
  expected:=c.receipt; expected_fingerprint:=c.fingerprint;
 END IF;
 IF r.id IS NULL OR NEW.receipt_fingerprint IS DISTINCT FROM expected_fingerprint OR jsonb_typeof(p) IS DISTINCT FROM 'object'
 OR NOT(p ?& ARRAY['version','projectionVersion','source','payloadDigest','eventId','eventType','receiptIdentity','endpointId','platformId','accountScope','expectedAccountId','accountId','mode','apiVersion','receivedAt','disputeId','chargeId','paymentIntentId','amountCents','currency','status','eventCreated','objectCreated','balanceTransactions','transactionReferences','transactionReferenceCoverage','classification','reviewReasons'])
 OR p->'version' IS DISTINCT FROM '1'::jsonb OR p->'projectionVersion' IS DISTINCT FROM '1'::jsonb
 OR p->>'source' IS DISTINCT FROM 'offline_signed_fixture_dispute'
 OR p->>'classification' IS NULL OR p->>'classification' NOT IN ('correlatable','review')
 OR jsonb_typeof(p->'reviewReasons') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'balanceTransactions') IS DISTINCT FROM 'array'
 OR jsonb_typeof(p->'transactionReferences') IS DISTINCT FROM 'array'
 OR p->>'transactionReferenceCoverage' IS NULL OR p->>'transactionReferenceCoverage' NOT IN ('complete','incomplete','overflow')
 OR jsonb_array_length(p->'transactionReferences')>256
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'transactionReferences') ref WHERE jsonb_typeof(ref) IS DISTINCT FROM 'object'
  OR NOT(ref ?& ARRAY['id','sourceId'])
  OR (p->>'transactionReferenceCoverage'='complete' AND (ref->'id'='null'::jsonb OR ref->'sourceId'='null'::jsonb))
  OR (ref->'id' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(ref->'id') IS DISTINCT FROM 'string' OR ref->>'id' !~ '^txn_[A-Za-z0-9]+$'))
  OR (ref->'sourceId' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(ref->'sourceId') IS DISTINCT FROM 'string' OR ref->>'sourceId' !~ '^dp_[A-Za-z0-9]+$')))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'balanceTransactions') bt WHERE NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(p->'transactionReferences') ref WHERE ref->>'id'=bt->>'id' AND ref->>'sourceId'=bt->>'sourceId'))
 OR jsonb_array_length(p->'balanceTransactions')>2
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'balanceTransactions') bt WHERE jsonb_typeof(bt) IS DISTINCT FROM 'object'
  OR NOT(bt ?& ARRAY['id','sourceId','amountCents','feeCents','netCents','currency','created','availableOn','status','type','reportingCategory'])
  OR (bt->>'id') IS NULL OR (bt->>'id') !~ '^txn_[A-Za-z0-9]+$' OR (bt->>'sourceId') IS NULL OR (bt->>'sourceId') !~ '^dp_[A-Za-z0-9]+$'
  OR bt->>'currency' IS DISTINCT FROM 'cad' OR bt->>'type' IS DISTINCT FROM 'adjustment'
  OR bt->>'status' IS NULL OR bt->>'status' NOT IN ('pending','available')
  OR bt->>'reportingCategory' IS NULL OR bt->>'reportingCategory' NOT IN ('dispute','dispute_reversal')
  OR EXISTS(SELECT 1 FROM jsonb_each(bt) e WHERE e.key IN ('amountCents','feeCents','netCents','created','availableOn') AND (jsonb_typeof(e.value) IS DISTINCT FROM 'number' OR e.value::text !~ '^-?[0-9]+$')))
 OR jsonb_typeof(p->'receivedAt') IS DISTINCT FROM 'string'
 OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.key IN ('disputeId','chargeId','paymentIntentId','currency','status') AND jsonb_typeof(e.value) NOT IN ('null','string'))
 OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.key IN ('amountCents','eventCreated','objectCreated') AND jsonb_typeof(e.value) NOT IN ('null','number'))
 OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.key IN ('payloadDigest','eventId','eventType','receiptIdentity','endpointId','platformId','accountScope','expectedAccountId','accountId','mode','apiVersion') AND e.value IS DISTINCT FROM expected->e.key)
 OR NEW.fingerprint IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(p-'receivedAt'),'UTF8')),'hex') THEN
 RAISE EXCEPTION 'CUSTOMER_PAYMENT_DISPUTE_PROJECTION_INVALID'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_dispute_projection_guard BEFORE INSERT ON customer_payment_dispute_projection FOR EACH ROW EXECUTE FUNCTION customer_payment_dispute_projection_guard();
--> statement-breakpoint
CREATE TRIGGER customer_payment_dispute_correlation_link_guard BEFORE INSERT ON customer_payment_dispute_correlation_link FOR EACH ROW EXECUTE FUNCTION customer_payment_correlation_link_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_dispute_correlation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous integer; o customer_payment_provider_operation;
BEGIN
 PERFORM id FROM customer_payment_correlation_mutex WHERE id=1 FOR UPDATE;
 SELECT * INTO o FROM customer_payment_provider_operation WHERE id=NEW.operation_id FOR UPDATE;
 SELECT coalesce(max(version),0) INTO previous FROM customer_payment_dispute_correlation WHERE operation_id=NEW.operation_id;
 IF o.id IS NULL OR o.identity->>'kind' IS DISTINCT FROM 'checkout_create'
 OR NEW.version<>previous+1 OR jsonb_typeof(NEW.source) IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.result) IS DISTINCT FROM 'object'
 OR NOT(NEW.result ?& ARRAY['source','state','reasons','financialPostingAllowed','disputeCandidate','balanceCandidates','totals'])
 OR NEW.result->>'source' IS DISTINCT FROM 'offline_fixture_dispute_correlation' OR NEW.result->'financialPostingAllowed' IS DISTINCT FROM 'false'::jsonb
 OR NEW.result->>'state' IS NULL OR NEW.result->>'state' NOT IN ('pending','correlated','review') OR jsonb_typeof(NEW.result->'reasons') IS DISTINCT FROM 'array'
 OR jsonb_typeof(NEW.result->'balanceCandidates') IS DISTINCT FROM 'array'
 OR (NEW.result->'totals' IS DISTINCT FROM 'null'::jsonb AND jsonb_typeof(NEW.result->'totals') IS DISTINCT FROM 'object')
 OR NEW.source#>>'{parent,operation,identity,id}' IS DISTINCT FROM NEW.operation_id
 OR NEW.source_revision IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(NEW.source),'UTF8')),'hex') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_DISPUTE_CORRELATION_INVALID'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_dispute_correlation_guard BEFORE INSERT ON customer_payment_dispute_correlation FOR EACH ROW EXECUTE FUNCTION customer_payment_dispute_correlation_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_dispute_candidate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o customer_payment_provider_operation; k jsonb:=NEW.key;
BEGIN
 PERFORM id FROM customer_payment_correlation_mutex WHERE id=1 FOR UPDATE;
 SELECT * INTO o FROM customer_payment_provider_operation WHERE id=NEW.first_operation_id;
 IF o.id IS NULL OR jsonb_typeof(k) IS DISTINCT FROM 'object' OR o.identity->>'kind' IS DISTINCT FROM 'checkout_create'
 OR NOT(k ?& ARRAY['platformId','accountScope','accountId','mode','disputeId']) OR (SELECT count(*) FROM jsonb_object_keys(k))<>5
 OR ROW(k->>'platformId',k->>'accountScope',k->>'accountId',k->>'mode') IS DISTINCT FROM ROW(o.identity->>'platformId',o.identity->>'accountScope',o.identity->>'accountId',o.identity->>'mode')
 OR k->>'disputeId' IS NULL OR k->>'disputeId' !~ '^dp_[A-Za-z0-9]+$'
 OR NEW.key_hash IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(k),'UTF8')),'hex') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_DISPUTE_CANDIDATE_SCOPE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_dispute_candidate_guard BEFORE INSERT ON customer_payment_dispute_candidate FOR EACH ROW EXECUTE FUNCTION customer_payment_dispute_candidate_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_dispute_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c customer_payment_dispute_candidate; a customer_payment_dispute_correlation; o customer_payment_provider_operation;
BEGIN
 PERFORM id FROM customer_payment_correlation_mutex WHERE id=1 FOR UPDATE;
 SELECT * INTO c FROM customer_payment_dispute_candidate WHERE id=NEW.candidate_id;
 SELECT * INTO a FROM customer_payment_dispute_correlation WHERE id=NEW.correlation_id;
 SELECT * INTO o FROM customer_payment_provider_operation WHERE id=NEW.operation_id;
 IF c.id IS NULL OR a.id IS NULL OR o.id IS NULL OR a.operation_id<>NEW.operation_id
 OR jsonb_typeof(NEW.facts) IS DISTINCT FROM 'object' OR NEW.facts->>'fingerprint' IS DISTINCT FROM NEW.fingerprint
 OR NEW.facts->'disputeKey' IS DISTINCT FROM c.key
 OR ROW(o.identity->>'platformId',o.identity->>'accountScope',o.identity->>'accountId',o.identity->>'mode') IS DISTINCT FROM ROW(c.key->>'platformId',c.key->>'accountScope',c.key->>'accountId',c.key->>'mode')
 OR NEW.facts IS DISTINCT FROM a.result->'disputeCandidate' THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_DISPUTE_CLAIM_INVALID'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_dispute_claim_guard BEFORE INSERT ON customer_payment_dispute_claim FOR EACH ROW EXECUTE FUNCTION customer_payment_dispute_claim_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_dispute_balance_candidate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o customer_payment_provider_operation; k jsonb:=NEW.key;
BEGIN
 PERFORM id FROM customer_payment_correlation_mutex WHERE id=1 FOR UPDATE;
 SELECT * INTO o FROM customer_payment_provider_operation WHERE id=NEW.first_operation_id;
 IF o.id IS NULL OR jsonb_typeof(k) IS DISTINCT FROM 'object' OR o.identity->>'kind' IS DISTINCT FROM 'checkout_create'
 OR NOT(k ?& ARRAY['platformId','accountScope','accountId','mode','balanceTransactionId']) OR (SELECT count(*) FROM jsonb_object_keys(k))<>5
 OR ROW(k->>'platformId',k->>'accountScope',k->>'accountId',k->>'mode') IS DISTINCT FROM ROW(o.identity->>'platformId',o.identity->>'accountScope',o.identity->>'accountId',o.identity->>'mode')
 OR k->>'balanceTransactionId' IS NULL OR k->>'balanceTransactionId' !~ '^txn_[A-Za-z0-9]+$'
 OR NEW.key_hash IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(k),'UTF8')),'hex') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_DISPUTE_BALANCE_CANDIDATE_SCOPE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_dispute_balance_candidate_guard BEFORE INSERT ON customer_payment_dispute_balance_candidate FOR EACH ROW EXECUTE FUNCTION customer_payment_dispute_balance_candidate_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_dispute_balance_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c customer_payment_dispute_balance_candidate; a customer_payment_dispute_correlation; o customer_payment_provider_operation;
BEGIN
 PERFORM id FROM customer_payment_correlation_mutex WHERE id=1 FOR UPDATE;
 SELECT * INTO c FROM customer_payment_dispute_balance_candidate WHERE id=NEW.candidate_id;
 SELECT * INTO a FROM customer_payment_dispute_correlation WHERE id=NEW.correlation_id;
 SELECT * INTO o FROM customer_payment_provider_operation WHERE id=NEW.operation_id;
 IF c.id IS NULL OR a.id IS NULL OR o.id IS NULL OR a.operation_id<>NEW.operation_id
 OR jsonb_typeof(NEW.facts) IS DISTINCT FROM 'object' OR NEW.facts->>'fingerprint' IS DISTINCT FROM NEW.fingerprint
 OR NEW.facts->'movementKey' IS DISTINCT FROM c.key
 OR ROW(o.identity->>'platformId',o.identity->>'accountScope',o.identity->>'accountId',o.identity->>'mode') IS DISTINCT FROM ROW(c.key->>'platformId',c.key->>'accountScope',c.key->>'accountId',c.key->>'mode')
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.result->'balanceCandidates') f WHERE f=NEW.facts) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_DISPUTE_BALANCE_CLAIM_INVALID'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_dispute_balance_claim_guard BEFORE INSERT ON customer_payment_dispute_balance_claim FOR EACH ROW EXECUTE FUNCTION customer_payment_dispute_balance_claim_guard();
--> statement-breakpoint
CREATE TRIGGER customer_payment_dispute_projection_immutable BEFORE UPDATE OR DELETE ON customer_payment_dispute_projection FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
--> statement-breakpoint
CREATE TRIGGER customer_payment_dispute_correlation_link_immutable BEFORE UPDATE OR DELETE ON customer_payment_dispute_correlation_link FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
--> statement-breakpoint
CREATE TRIGGER customer_payment_dispute_correlation_immutable BEFORE UPDATE OR DELETE ON customer_payment_dispute_correlation FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
--> statement-breakpoint
CREATE TRIGGER customer_payment_dispute_candidate_immutable BEFORE UPDATE OR DELETE ON customer_payment_dispute_candidate FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
--> statement-breakpoint
CREATE TRIGGER customer_payment_dispute_claim_immutable BEFORE UPDATE OR DELETE ON customer_payment_dispute_claim FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
--> statement-breakpoint
CREATE TRIGGER customer_payment_dispute_balance_candidate_immutable BEFORE UPDATE OR DELETE ON customer_payment_dispute_balance_candidate FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
--> statement-breakpoint
CREATE TRIGGER customer_payment_dispute_balance_claim_immutable BEFORE UPDATE OR DELETE ON customer_payment_dispute_balance_claim FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
