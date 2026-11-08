-- Inert offline fixture journal. No webhook registration, financial write or provider access.
CREATE TABLE customer_payment_provider_inbox (
 id text PRIMARY KEY, endpoint_id text NOT NULL, platform_id text NOT NULL, account_scope text NOT NULL CHECK(account_scope IN ('platform','connected')),
 account_key text NOT NULL, mode text NOT NULL CHECK(mode IN ('test','live','unknown')), receipt_identity text NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'), receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(receipt->>'source'='offline_signed_fixture' AND receipt->>'version'='1'),
 CHECK(receipt->>'endpointId'=endpoint_id AND receipt->>'platformId'=platform_id AND receipt->>'accountScope'=account_scope
 AND coalesce(receipt->>'accountId','')=account_key AND receipt->>'mode'=mode AND receipt->>'receiptIdentity'=receipt_identity),
 CHECK(receipt->>'classification' IN ('accepted','review'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_provider_inbox_once ON customer_payment_provider_inbox(endpoint_id,platform_id,account_scope,account_key,mode,receipt_identity);
--> statement-breakpoint
CREATE TABLE customer_payment_provider_conflict (
 id text PRIMARY KEY, inbox_id text NOT NULL REFERENCES customer_payment_provider_inbox(id) ON DELETE RESTRICT,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'), receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(receipt->>'source'='offline_signed_fixture')
);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_provider_conflict_once ON customer_payment_provider_conflict(inbox_id,fingerprint);
--> statement-breakpoint
CREATE TABLE customer_payment_provider_delivery (
 id text PRIMARY KEY, inbox_id text NOT NULL REFERENCES customer_payment_provider_inbox(id) ON DELETE RESTRICT,
 consumer text NOT NULL CHECK(consumer ~ '^[a-z][a-z0-9_]{0,63}$'), consumer_version integer NOT NULL CHECK(consumer_version BETWEEN 1 AND 1000000),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','completed','review','retry')),
 version integer NOT NULL DEFAULT 0 CHECK(version>=0), worker_id text, lease_token text, lease_until timestamptz, detail text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((state='processing' AND worker_id IS NOT NULL AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
 OR (state<>'processing' AND lease_token IS NULL AND lease_until IS NULL)), CHECK(length(detail)<=1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_provider_delivery_once ON customer_payment_provider_delivery(inbox_id,consumer,consumer_version);
--> statement-breakpoint
CREATE TABLE customer_payment_provider_operation (
 id text PRIMARY KEY, salon_id text NOT NULL, appointment_id text NOT NULL, quote_id text NOT NULL REFERENCES customer_payment_prepared_quote(id) ON DELETE RESTRICT,
 request_id text NOT NULL, fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'), identity jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(salon_id,appointment_id) REFERENCES appointment(salon_id,id) ON DELETE RESTRICT,
 CHECK(identity->>'id'=id AND identity->>'salonId'=salon_id AND identity->>'appointmentId'=appointment_id AND identity->>'quoteId'=quote_id AND identity->>'requestId'=request_id),
 CHECK(identity->>'mode'='test' AND identity->>'provenance'='offline_fixture' AND identity->>'apiVersion'='2024-06-20'),
 CHECK(identity->>'kind' IN ('checkout_create','customer_refund','application_fee_refund')),
 CHECK(identity->>'parameterHash' ~ '^[a-f0-9]{64}$' AND identity->>'contextHash' ~ '^[a-f0-9]{64}$' AND identity->>'idempotencyKey' ~ '^cpay_fixture_[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_provider_operation_request_once ON customer_payment_provider_operation(salon_id,request_id);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_provider_operation_key_once ON customer_payment_provider_operation((identity->>'platformId'),(identity->>'accountScope'),(coalesce(identity->>'accountId','')),(identity->>'idempotencyKey'));
--> statement-breakpoint
CREATE TABLE customer_payment_provider_operation_state (
 operation_id text PRIMARY KEY REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>=0), state jsonb NOT NULL, command jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
CREATE TABLE customer_payment_provider_audit (
 id text PRIMARY KEY, entity_type text NOT NULL CHECK(entity_type IN ('delivery','operation')), entity_id text NOT NULL,
 version integer NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_provider_audit_once ON customer_payment_provider_audit(entity_type,entity_id,version);
--> statement-breakpoint
CREATE FUNCTION customer_payment_provider_operation_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q customer_payment_prepared_quote;
BEGIN
 SELECT * INTO q FROM customer_payment_prepared_quote WHERE id=NEW.quote_id;
 IF q.id IS NULL OR q.salon_id<>NEW.salon_id OR q.appointment_id<>NEW.appointment_id OR q.mode<>'test'
 OR NEW.identity->>'contextHash' IS DISTINCT FROM q.fingerprint
 OR (NEW.identity->>'accountScope'='connected' AND NEW.identity->>'accountId' IS DISTINCT FROM q.stripe_account_id)
 OR (NEW.identity->>'kind'='application_fee_refund' AND (NEW.identity->>'accountScope' IS DISTINCT FROM 'platform' OR NEW.identity->'accountId' IS DISTINCT FROM 'null'::jsonb))
 OR (NEW.identity->>'kind'<>'application_fee_refund' AND NEW.identity->>'accountScope' IS DISTINCT FROM 'connected') THEN
 RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_OPERATION_SCOPE'; END IF;
 IF NEW.identity->>'kind'='checkout_create' AND (NEW.identity#>>'{parameters,client_reference_id}' IS DISTINCT FROM q.id
 OR NEW.identity#>>'{parameters,line_items,0,price_data,currency}' IS DISTINCT FROM 'cad'
 OR (NEW.identity#>>'{parameters,line_items,0,price_data,unit_amount}')::integer IS DISTINCT FROM (q.snapshot->>'chargeCents')::integer
 OR (NEW.identity#>>'{parameters,payment_intent_data,application_fee_amount}')::integer IS DISTINCT FROM (q.snapshot->>'applicationFeeCents')::integer) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_CHECKOUT_QUOTE_MISMATCH'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_provider_operation_scope BEFORE INSERT ON customer_payment_provider_operation FOR EACH ROW EXECUTE FUNCTION customer_payment_provider_operation_scope();
--> statement-breakpoint
CREATE FUNCTION customer_payment_provider_delivery_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inbox customer_payment_provider_inbox; blocked boolean; now_time timestamptz:=clock_timestamp();
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_IMMUTABLE'; END IF;
 SELECT * INTO inbox FROM customer_payment_provider_inbox WHERE id=NEW.inbox_id FOR UPDATE;
 blocked:=inbox.receipt->>'classification'<>'accepted' OR EXISTS(SELECT 1 FROM customer_payment_provider_conflict WHERE inbox_id=NEW.inbox_id);
 IF TG_OP='INSERT' THEN
  IF NEW.version<>0 OR NEW.state IS DISTINCT FROM (CASE WHEN blocked THEN 'review' ELSE 'pending' END) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_DELIVERY_TRANSITION'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.inbox_id,NEW.consumer,NEW.consumer_version,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.inbox_id,OLD.consumer,OLD.consumer_version,OLD.created_at)
  OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_DELIVERY_FENCE'; END IF;
  IF blocked THEN
   IF NEW.state<>'review' THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_INBOX_REVIEW'; END IF;
  ELSIF NEW.state='processing' THEN
   IF OLD.state NOT IN ('pending','retry','processing') OR (OLD.state='processing' AND OLD.lease_until>now_time)
   OR NEW.lease_until<=now_time OR NEW.lease_until>now_time+interval '5 minutes'
   OR NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_DELIVERY_LEASE'; END IF;
  ELSIF OLD.state<>'processing' OR OLD.lease_until<=now_time OR NEW.state NOT IN ('completed','review','retry') THEN
   RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_DELIVERY_TRANSITION';
  END IF;
 END IF;
 IF blocked AND NEW.state<>'review' THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_INBOX_REVIEW'; END IF;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_provider_delivery_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_provider_delivery FOR EACH ROW EXECUTE FUNCTION customer_payment_provider_delivery_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_provider_conflict_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original customer_payment_provider_inbox;
BEGIN
 SELECT * INTO original FROM customer_payment_provider_inbox WHERE id=NEW.inbox_id FOR UPDATE;
 IF NEW.fingerprint=original.fingerprint OR ROW(NEW.receipt->>'endpointId',NEW.receipt->>'platformId',NEW.receipt->>'accountScope',coalesce(NEW.receipt->>'accountId',''),NEW.receipt->>'mode',NEW.receipt->>'receiptIdentity')
 IS DISTINCT FROM ROW(original.endpoint_id,original.platform_id,original.account_scope,original.account_key,original.mode,original.receipt_identity) THEN
 RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_CONFLICT_SCOPE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_provider_conflict_guard BEFORE INSERT ON customer_payment_provider_conflict FOR EACH ROW EXECUTE FUNCTION customer_payment_provider_conflict_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_provider_conflict_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE customer_payment_provider_delivery SET state='review',version=version+1,lease_token=NULL,lease_until=NULL,detail='Conflicting authenticated fixture receipt' WHERE inbox_id=NEW.inbox_id;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_provider_conflict_hold AFTER INSERT ON customer_payment_provider_conflict FOR EACH ROW EXECUTE FUNCTION customer_payment_provider_conflict_hold();
--> statement-breakpoint
CREATE FUNCTION customer_payment_provider_canonical(value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result text;
BEGIN
 IF jsonb_typeof(value)='object' THEN
  SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||customer_payment_provider_canonical(v),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(value) AS e(key,v);
 ELSIF jsonb_typeof(value)='array' THEN
  SELECT '['||coalesce(string_agg(customer_payment_provider_canonical(v),',' ORDER BY ordinal),'')||']' INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS e(v,ordinal);
 ELSE result:=value::text; END IF;
 RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION customer_payment_provider_operation_hash_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF jsonb_typeof(NEW.identity) IS DISTINCT FROM 'object' OR NOT (NEW.identity ?& ARRAY['id','salonId','appointmentId','quoteId','requestId','contextHash','platformId','mode','apiVersion','provenance','kind','accountScope','accountId','targetId','parameters','parameterHash','idempotencyKey'])
 OR EXISTS(SELECT 1 FROM jsonb_each(NEW.identity) e WHERE e.key NOT IN ('accountId','targetId','parameters') AND jsonb_typeof(e.value)<>'string')
 OR jsonb_typeof(NEW.identity->'parameters') IS DISTINCT FROM 'object'
 OR jsonb_typeof(NEW.identity->'accountId') NOT IN ('string','null') OR jsonb_typeof(NEW.identity->'targetId') NOT IN ('string','null') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_OPERATION_SHAPE'; END IF;
 IF NEW.identity->>'parameterHash' IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(NEW.identity->'parameters'),'UTF8')),'hex')
 OR NEW.identity->>'idempotencyKey' IS DISTINCT FROM 'cpay_fixture_'||encode(sha256(convert_to(customer_payment_provider_canonical(NEW.identity-'idempotencyKey'),'UTF8')),'hex') THEN
 RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_OPERATION_HASH'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_provider_operation_hash BEFORE INSERT ON customer_payment_provider_operation FOR EACH ROW EXECUTE FUNCTION customer_payment_provider_operation_hash_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_provider_operation_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity jsonb; n jsonb:=NEW.state; o jsonb; s text; previous text; ms bigint:=floor(extract(epoch FROM clock_timestamp())*1000); lease bigint; oldlease bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_IMMUTABLE'; END IF;
 SELECT op.identity INTO identity FROM customer_payment_provider_operation op WHERE id=NEW.operation_id;
 s:=n->>'state'; lease:=(n->>'leaseUntil')::bigint;
 IF jsonb_typeof(n) IS DISTINCT FROM 'object' OR jsonb_typeof(n->'identity') IS DISTINCT FROM 'object'
 OR jsonb_typeof(n->'state') IS DISTINCT FROM 'string' OR jsonb_typeof(n->'version') IS DISTINCT FROM 'number'
 OR jsonb_typeof(n->'createdAt') IS DISTINCT FROM 'number' OR jsonb_typeof(n->'updatedAt') IS DISTINCT FROM 'number'
 OR jsonb_typeof(n->'leaseUntil') NOT IN ('null','number') OR jsonb_typeof(n->'firstDispatchedAt') NOT IN ('null','number')
 OR jsonb_typeof(n->'idempotencyExpiresAt') NOT IN ('null','number') OR jsonb_typeof(n->'leaseToken') NOT IN ('null','string')
 OR jsonb_typeof(n->'leasePurpose') NOT IN ('null','string') OR jsonb_typeof(n->'result') NOT IN ('null','object')
 OR NOT (n ?& ARRAY['identity','state','version','createdAt','updatedAt','leaseToken','leaseUntil','leasePurpose','firstDispatchedAt','idempotencyExpiresAt','result'])
 OR n->'identity' IS DISTINCT FROM identity OR (n->>'version')::integer IS DISTINCT FROM NEW.version
 OR s NOT IN ('queued','claimed','dispatching','uncertain','succeeded','failed','review')
 OR (n->>'updatedAt')::bigint>ms+1000 OR (n->>'updatedAt')::bigint<ms-10000 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_OPERATION_STATE'; END IF;
 IF jsonb_typeof(NEW.command) IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.command->'type') IS DISTINCT FROM 'string'
 OR (NEW.command->>'acceptedAt')::bigint IS DISTINCT FROM (n->>'updatedAt')::bigint THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_COMMAND_INVALID'; END IF;
 IF (n->>'firstDispatchedAt' IS NULL) IS DISTINCT FROM (n->>'idempotencyExpiresAt' IS NULL)
 OR (n->>'createdAt')::bigint>(n->>'updatedAt')::bigint THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_OPERATION_STATE'; END IF;
 IF (n->>'leaseToken' IS NULL) IS DISTINCT FROM (lease IS NULL)
 OR (n->>'leaseToken' IS NULL) IS DISTINCT FROM (n->>'leasePurpose' IS NULL)
 OR (lease IS NOT NULL AND (lease<=ms OR lease>ms+300000 OR n->>'leasePurpose' NOT IN ('dispatch','reconcile')))
 OR (s IN ('claimed','dispatching') AND (lease IS NULL OR n->>'leasePurpose'<>'dispatch'))
 OR (s IN ('queued','succeeded','failed','review') AND lease IS NOT NULL)
 OR (s='uncertain' AND lease IS NOT NULL AND n->>'leasePurpose'<>'reconcile') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_OPERATION_LEASE'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.command->>'type'<>'prepare' OR NEW.version<>0 OR s<>'queued' OR n->'result'<>'null'::jsonb OR n->'firstDispatchedAt'<>'null'::jsonb OR n->'idempotencyExpiresAt'<>'null'::jsonb
  OR n->'createdAt' IS DISTINCT FROM n->'updatedAt' THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_OPERATION_TRANSITION'; END IF;
 ELSE
  o:=OLD.state; previous:=o->>'state'; oldlease:=(o->>'leaseUntil')::bigint;
  IF NEW.operation_id<>OLD.operation_id OR NEW.version<>OLD.version+1 OR n->'createdAt' IS DISTINCT FROM o->'createdAt'
  OR (n->>'updatedAt')::bigint<(o->>'updatedAt')::bigint OR previous IN ('succeeded','failed','review') THEN
   RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_OPERATION_FENCE'; END IF;
  IF (NEW.command->>'previousVersion')::integer IS DISTINCT FROM OLD.version
  OR NEW.command->>'type' NOT IN ('claim','begin_dispatch','expire','observe_dispatch','reconcile')
  OR (NEW.command->>'type'<>'claim' AND NEW.command->>'leaseToken' IS DISTINCT FROM o->>'leaseToken') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_COMMAND_FENCE'; END IF;
  CASE NEW.command->>'type'
  WHEN 'claim' THEN
   IF NEW.command->>'workerId' IS NULL OR length(btrim(NEW.command->>'workerId'))=0
   OR (NEW.command->>'purpose'='dispatch' AND (previous NOT IN ('queued','claimed') OR s NOT IN ('claimed','review')))
   OR (NEW.command->>'purpose'='reconcile' AND (previous<>'uncertain' OR s<>'uncertain' OR lease IS NULL))
   OR NEW.command->>'purpose' IS NULL OR NEW.command->>'purpose' NOT IN ('dispatch','reconcile')
   OR (lease IS NOT NULL AND NEW.command->>'purpose' IS DISTINCT FROM n->>'leasePurpose') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_COMMAND_INVALID'; END IF;
  WHEN 'begin_dispatch' THEN
   IF previous<>'claimed' OR s<>'dispatching' OR oldlease IS NULL OR oldlease<=ms THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_COMMAND_INVALID'; END IF;
  WHEN 'expire' THEN
   IF previous NOT IN ('claimed','dispatching','uncertain') OR oldlease IS NULL OR oldlease>ms OR lease IS NOT NULL
    OR s IS DISTINCT FROM (CASE WHEN previous='claimed' THEN 'queued' ELSE 'uncertain' END) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_COMMAND_INVALID'; END IF;
  WHEN 'observe_dispatch' THEN
   IF previous<>'dispatching' OR oldlease IS NULL OR oldlease<=ms OR lease IS NOT NULL
    OR jsonb_typeof(NEW.command->'observation') IS DISTINCT FROM 'object'
    OR NEW.command#>>'{observation,type}' IS NULL OR NEW.command#>>'{observation,type}' NOT IN ('accepted','rejected_without_execution','uncertain')
    OR s IS DISTINCT FROM (CASE NEW.command#>>'{observation,type}' WHEN 'accepted' THEN 'succeeded' WHEN 'rejected_without_execution' THEN 'failed' ELSE 'uncertain' END) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_COMMAND_INVALID'; END IF;
  WHEN 'reconcile' THEN
   IF previous<>'uncertain' OR oldlease IS NULL OR oldlease<=ms OR o->>'leasePurpose' IS DISTINCT FROM 'reconcile' OR lease IS NOT NULL
    OR jsonb_typeof(NEW.command->'observation') IS DISTINCT FROM 'object'
    OR NEW.command#>>'{observation,type}' IS NULL OR NEW.command#>>'{observation,type}' NOT IN ('exists','authoritatively_absent','unresolved')
    OR s IS DISTINCT FROM (CASE WHEN NEW.command#>>'{observation,type}'='exists' THEN 'succeeded'
      WHEN NEW.command#>>'{observation,type}'='authoritatively_absent' AND ms<(o->>'idempotencyExpiresAt')::bigint THEN 'queued' ELSE 'review' END) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_COMMAND_INVALID'; END IF;
  ELSE RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_COMMAND_INVALID';
  END CASE;
  IF o->>'firstDispatchedAt' IS NULL AND n->>'firstDispatchedAt' IS NOT NULL AND (NOT(previous='claimed' AND s='dispatching') OR n->'firstDispatchedAt' IS DISTINCT FROM n->'updatedAt') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_DISPATCH_REQUIRED'; END IF;
  IF NEW.command->>'type'='begin_dispatch' AND NOT(previous='claimed' AND s='dispatching') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_COMMAND_INVALID'; END IF;
  IF s='claimed' AND NEW.command->>'type'<>'claim' THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_COMMAND_INVALID'; END IF;
  IF previous='dispatching' AND s='uncertain' AND lease IS NOT NULL THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_COMMAND_INVALID'; END IF;
  IF previous='uncertain' AND s='queued' AND (NEW.command->>'type'<>'reconcile' OR NEW.command#>>'{observation,type}' IS DISTINCT FROM 'authoritatively_absent') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_RECONCILIATION_REQUIRED'; END IF;
  IF s IN ('succeeded','failed') THEN
   IF NEW.command->>'type' NOT IN ('observe_dispatch','reconcile')
   OR (s='succeeded' AND (NEW.command#>>'{observation,type}' NOT IN ('accepted','exists') OR NEW.command#>>'{observation,objectId}' IS DISTINCT FROM n#>>'{result,objectId}'))
   OR (s='failed' AND (NEW.command#>>'{observation,type}' IS DISTINCT FROM 'rejected_without_execution' OR NEW.command#>>'{observation,code}' IS DISTINCT FROM n#>>'{result,rejectionCode}')) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_RESULT_INVALID'; END IF;
  END IF;
  IF o->>'firstDispatchedAt' IS NOT NULL AND (n->'firstDispatchedAt' IS DISTINCT FROM o->'firstDispatchedAt' OR n->'idempotencyExpiresAt' IS DISTINCT FROM o->'idempotencyExpiresAt') THEN
   RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_RETENTION_IMMUTABLE'; END IF;
  IF previous='queued' OR (previous='claimed' AND oldlease<=ms) THEN
   IF s NOT IN ('queued','claimed','review') OR (s='claimed' AND n->>'leaseToken' IS NOT DISTINCT FROM o->>'leaseToken')
    OR (s='review' AND (o->>'idempotencyExpiresAt' IS NULL OR ms<(o->>'idempotencyExpiresAt')::bigint)) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_OPERATION_TRANSITION'; END IF;
  ELSIF previous='claimed' THEN
   IF s<>'dispatching' OR n->'leaseToken' IS DISTINCT FROM o->'leaseToken' OR n->'leaseUntil' IS DISTINCT FROM o->'leaseUntil'
    OR ms>=(n->>'idempotencyExpiresAt')::bigint THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_OPERATION_TRANSITION'; END IF;
  ELSIF previous='dispatching' THEN
   IF s NOT IN ('uncertain','succeeded','failed') OR (s<>'uncertain' AND oldlease<=ms) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_OPERATION_TRANSITION'; END IF;
  ELSIF previous='uncertain' THEN
   IF lease IS NOT NULL THEN
    IF s<>'uncertain' OR (oldlease IS NOT NULL AND oldlease>ms) OR n->>'leaseToken' IS NOT DISTINCT FROM o->>'leaseToken' THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_OPERATION_TRANSITION'; END IF;
   ELSIF s='uncertain' THEN
    IF oldlease IS NULL OR oldlease>ms THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_OPERATION_TRANSITION'; END IF;
   ELSIF s IN ('queued','succeeded','review') THEN
    IF oldlease IS NULL OR oldlease<=ms OR o->>'leasePurpose'<>'reconcile'
    OR (s='queued' AND (o->>'idempotencyExpiresAt' IS NULL OR ms>=(o->>'idempotencyExpiresAt')::bigint)) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_RECONCILIATION_REQUIRED'; END IF;
   ELSE RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_OPERATION_TRANSITION'; END IF;
  ELSE RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_OPERATION_TRANSITION'; END IF;
 END IF;
 IF n->>'firstDispatchedAt' IS NOT NULL AND ((n->>'idempotencyExpiresAt')::bigint IS DISTINCT FROM (n->>'firstDispatchedAt')::bigint+82800000
 OR (n->>'firstDispatchedAt')::bigint>ms OR (n->>'firstDispatchedAt')::bigint<(n->>'createdAt')::bigint) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_RETENTION_INVALID'; END IF;
 IF s IN ('dispatching','uncertain','succeeded','failed') AND n->>'firstDispatchedAt' IS NULL THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_DISPATCH_REQUIRED'; END IF;
 IF s IN ('succeeded','failed') THEN
  IF n#>>'{result,provenance}' IS DISTINCT FROM 'offline_fixture' THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_RESULT_INVALID'; END IF;
  IF s='succeeded' AND (n#>>'{result,objectId}' IS NULL OR left(n#>>'{result,objectId}',3) IS DISTINCT FROM (CASE identity->>'kind' WHEN 'checkout_create' THEN 'cs_' WHEN 'customer_refund' THEN 're_' ELSE 'fr_' END)) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_RESULT_INVALID'; END IF;
  IF s='failed' AND (n#>>'{result,rejectionCode}' IS NULL OR n#>>'{result,rejectionCode}' NOT IN ('invalid_request','not_permitted')) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_RESULT_INVALID'; END IF;
 ELSIF n->'result'<>'null'::jsonb THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_RESULT_INVALID'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_provider_operation_state_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_provider_operation_state FOR EACH ROW EXECUTE FUNCTION customer_payment_provider_operation_state_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_provider_audit_append() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text; identity text; snap jsonb; inserted integer;
BEGIN
 kind:=CASE TG_TABLE_NAME WHEN 'customer_payment_provider_delivery' THEN 'delivery' ELSE 'operation' END;
 IF kind='delivery' THEN identity:=NEW.id; ELSE identity:=NEW.operation_id; END IF;
 snap:=to_jsonb(NEW);
 INSERT INTO customer_payment_provider_audit(id,entity_type,entity_id,version,snapshot) VALUES(kind||':'||identity||':'||NEW.version,kind,identity,NEW.version,snap);
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted<>1 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_AUDIT_WRITE_FAILED'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_provider_delivery_audit AFTER INSERT OR UPDATE ON customer_payment_provider_delivery FOR EACH ROW EXECUTE FUNCTION customer_payment_provider_audit_append();
--> statement-breakpoint
CREATE TRIGGER customer_payment_provider_operation_audit AFTER INSERT OR UPDATE ON customer_payment_provider_operation_state FOR EACH ROW EXECUTE FUNCTION customer_payment_provider_audit_append();
--> statement-breakpoint
CREATE FUNCTION customer_payment_provider_audit_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_snapshot jsonb;
BEGIN
 IF NEW.entity_type='delivery' THEN SELECT to_jsonb(d) INTO current_snapshot FROM customer_payment_provider_delivery d WHERE id=NEW.entity_id;
 ELSE SELECT to_jsonb(s) INTO current_snapshot FROM customer_payment_provider_operation_state s WHERE operation_id=NEW.entity_id; END IF;
 IF current_snapshot IS NULL OR NEW.snapshot IS DISTINCT FROM current_snapshot OR (current_snapshot->>'version')::integer IS DISTINCT FROM NEW.version THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_AUDIT_INVALID'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_provider_audit_validate BEFORE INSERT ON customer_payment_provider_audit FOR EACH ROW EXECUTE FUNCTION customer_payment_provider_audit_validate();

--> statement-breakpoint
CREATE TRIGGER customer_payment_provider_inbox_immutable BEFORE UPDATE OR DELETE ON customer_payment_provider_inbox FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();

--> statement-breakpoint
CREATE TRIGGER customer_payment_provider_conflict_immutable BEFORE UPDATE OR DELETE ON customer_payment_provider_conflict FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();

--> statement-breakpoint
CREATE TRIGGER customer_payment_provider_operation_immutable BEFORE UPDATE OR DELETE ON customer_payment_provider_operation FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();

--> statement-breakpoint
CREATE TRIGGER customer_payment_provider_audit_immutable BEFORE UPDATE OR DELETE ON customer_payment_provider_audit FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();

--> statement-breakpoint
CREATE FUNCTION customer_payment_provider_receipt_shape() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb:=NEW.receipt;
BEGIN
 IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT (r ?& ARRAY['version','source','endpointId','platformId','accountScope','expectedAccountId','accountId','mode','eventId','receiptIdentity','eventType','apiVersion','objectId','payloadDigest','normalizedFacts','classification','reviewReasons','receivedAt'])
 OR r->'version' IS DISTINCT FROM '1'::jsonb OR r->>'source' IS DISTINCT FROM 'offline_signed_fixture'
 OR EXISTS(SELECT 1 FROM jsonb_each(r) e WHERE e.key IN ('source','endpointId','platformId','accountScope','mode','receiptIdentity','payloadDigest','classification','receivedAt') AND (jsonb_typeof(e.value)<>'string' OR length(e.value#>>'{}')=0))
 OR EXISTS(SELECT 1 FROM jsonb_each(r) e WHERE e.key IN ('expectedAccountId','accountId','eventId','eventType','apiVersion','objectId') AND jsonb_typeof(e.value) NOT IN ('string','null'))
 OR r->>'classification' NOT IN ('accepted','review') OR r->>'mode' NOT IN ('test','live','unknown') OR r->>'accountScope' NOT IN ('platform','connected')
 OR jsonb_typeof(r->'normalizedFacts') IS DISTINCT FROM 'object' OR jsonb_typeof(r->'reviewReasons') IS DISTINCT FROM 'array'
 OR r->>'payloadDigest' !~ '^[a-f0-9]{64}$'
 OR r->>'receiptIdentity' IS DISTINCT FROM coalesce(r->>'eventId','digest:'||(r->>'payloadDigest'))
 OR NEW.fingerprint IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(r-'receivedAt'),'UTF8')),'hex') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_RECEIPT_SHAPE'; END IF;
 IF r->>'classification'='accepted' AND (r->>'mode'<>'test' OR r->>'eventId' IS NULL OR r->>'objectId' IS NULL
 OR jsonb_array_length(r->'reviewReasons')<>0
 OR (r->>'accountScope'='connected' AND (r->>'accountId' IS NULL OR r->'accountId' IS DISTINCT FROM r->'expectedAccountId'))
 OR (r->>'accountScope'='platform' AND (r->'accountId'<>'null'::jsonb OR r->'expectedAccountId'<>'null'::jsonb))) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVIDER_RECEIPT_SCOPE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_provider_inbox_shape BEFORE INSERT ON customer_payment_provider_inbox FOR EACH ROW EXECUTE FUNCTION customer_payment_provider_receipt_shape();
--> statement-breakpoint
CREATE TRIGGER customer_payment_provider_conflict_shape BEFORE INSERT ON customer_payment_provider_conflict FOR EACH ROW EXECUTE FUNCTION customer_payment_provider_receipt_shape();
