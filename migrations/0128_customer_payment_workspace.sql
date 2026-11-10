-- Durable adjustment commands and signed ingress, independent of synthetic data.
-- No operation here can post a canonical tender or authorize a Stripe call by itself.
CREATE TABLE customer_payment_workspace (
 appointment_id text PRIMARY KEY,
 salon_id text NOT NULL,
 revision integer NOT NULL CHECK (revision BETWEEN 0 AND 2147483646),
 state jsonb NOT NULL CHECK (jsonb_typeof(state)='object' AND octet_length(state::text)<=524288),
 request_id text NOT NULL,
 request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 actor_id text NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
 action text NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE customer_payment_workspace_audit (
 appointment_id text NOT NULL REFERENCES customer_payment_workspace(appointment_id) ON DELETE RESTRICT,
 salon_id text NOT NULL,
 revision integer NOT NULL,
 state jsonb NOT NULL,
 request_id text NOT NULL,
 request_hash text NOT NULL,
 actor_id text NOT NULL,
 action text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(appointment_id,revision)
);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_workspace_request_once ON customer_payment_workspace_audit(salon_id,request_id);
--> statement-breakpoint
CREATE FUNCTION customer_payment_workspace_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_salon text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_HISTORY_IMMUTABLE'; END IF;
 SELECT salon_id INTO parent_salon FROM appointment WHERE id=NEW.appointment_id FOR UPDATE;
 IF parent_salon IS DISTINCT FROM NEW.salon_id THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_SCOPE_MISMATCH'; END IF;
 IF EXISTS(SELECT 1 FROM customer_payment_closed_checkout_operation WHERE appointment_id=NEW.appointment_id AND execution_kind='sdk_closed_http_v1')
 THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_OWNERSHIP_CONFLICT'; END IF;
 IF (TG_OP='INSERT' AND NEW.revision<>0) OR (TG_OP='UPDATE' AND
  (NEW.appointment_id<>OLD.appointment_id OR NEW.salon_id<>OLD.salon_id OR NEW.revision<>OLD.revision+1))
 THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_REVISION_MISMATCH'; END IF;
 IF (NEW.state->>'revision')::integer IS DISTINCT FROM NEW.revision
  OR NEW.state->'bill'->>'salonId' IS DISTINCT FROM NEW.salon_id
  OR NEW.state->'bill'->>'appointmentId' IS DISTINCT FROM NEW.appointment_id
 THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_SNAPSHOT_MISMATCH'; END IF;
 NEW.updated_at=clock_timestamp();
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_workspace_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_workspace FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_workspace_audit_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO customer_payment_workspace_audit(appointment_id,salon_id,revision,state,request_id,request_hash,actor_id,action,created_at)
 VALUES(NEW.appointment_id,NEW.salon_id,NEW.revision,NEW.state,NEW.request_id,NEW.request_hash,NEW.actor_id,NEW.action,NEW.updated_at);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_workspace_audit_write AFTER INSERT OR UPDATE ON customer_payment_workspace FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_audit_write();
--> statement-breakpoint
CREATE FUNCTION customer_payment_workspace_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'PAYMENT_WORKSPACE_HISTORY_IMMUTABLE';
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_workspace_audit_immutable BEFORE UPDATE OR DELETE ON customer_payment_workspace_audit FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_history_guard();
--> statement-breakpoint
CREATE TABLE customer_payment_live_receipt (
 id text PRIMARY KEY,
 platform_account_id text NOT NULL CHECK (platform_account_id ~ '^acct_[A-Za-z0-9]+$'),
 account_id text NOT NULL CHECK (account_id ~ '^acct_[A-Za-z0-9]+$' AND account_id<>platform_account_id),
 livemode boolean NOT NULL,
 event_id text NOT NULL CHECK (event_id ~ '^evt_[A-Za-z0-9]+$'),
 payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
 receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=16384),
 received_at timestamptz NOT NULL
);
--> statement-breakpoint
-- Different signed payloads for one event remain visible instead of overwriting
-- the first. Consumers must reject the event if more than one digest exists.
CREATE UNIQUE INDEX customer_payment_live_receipt_once ON customer_payment_live_receipt(platform_account_id,account_id,livemode,event_id,payload_digest);
--> statement-breakpoint
CREATE TRIGGER payment_live_receipt_immutable BEFORE UPDATE OR DELETE ON customer_payment_live_receipt FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_history_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_workspace_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF pg_trigger_depth()<2 OR NOT EXISTS(
  SELECT 1 FROM customer_payment_workspace w WHERE w.appointment_id=NEW.appointment_id AND w.salon_id=NEW.salon_id
  AND w.revision=NEW.revision AND w.state=NEW.state AND w.request_id=NEW.request_id
  AND w.request_hash=NEW.request_hash AND w.actor_id=NEW.actor_id AND w.action=NEW.action
 ) THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_AUDIT_SOURCE_REQUIRED'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_workspace_audit_guard BEFORE INSERT ON customer_payment_workspace_audit FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_audit_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_workspace_has_hold(target text) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM customer_payment_workspace w,
  LATERAL jsonb_array_elements(w.state->'operations') op
  WHERE w.appointment_id=target AND op->>'state' IN ('awaiting_approval','prepared','dispatching','open','pending','uncertain','review'))
$$;
--> statement-breakpoint
CREATE FUNCTION customer_payment_workspace_appointment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed text[]:=ARRAY['updated_at','notes','tech_notes','client_name','client_email',
 'day_before_reminder_sent_at','day_before_reminder_channel','same_day_reminder_sent_at','same_day_reminder_channel',
 'review_followup_action','review_followup_sent_at','review_followup_sent_by','google_calendar_event_id','google_calendar_sync_status',
 'google_calendar_synced_at','google_calendar_sync_error','arrived_at','was_late'];
BEGIN
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM customer_payment_workspace WHERE appointment_id=OLD.id)
 THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_HISTORY_IMMUTABLE'; END IF;
 IF NOT customer_payment_workspace_has_hold(OLD.id) THEN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
 END IF;
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-allowed) IS DISTINCT FROM (to_jsonb(OLD)-allowed)
 THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_BALANCE_HELD'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aac_payment_workspace_appointment_guard BEFORE UPDATE OR DELETE ON appointment FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_appointment_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_workspace_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;
BEGIN
 FOR target IN SELECT DISTINCT x FROM unnest(ARRAY[CASE WHEN TG_OP<>'INSERT' THEN OLD.appointment_id END,CASE WHEN TG_OP<>'DELETE' THEN NEW.appointment_id END]) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM id FROM appointment WHERE id=target FOR KEY SHARE NOWAIT;
  IF customer_payment_workspace_has_hold(target) THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_BALANCE_HELD'; END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aac_payment_workspace_child_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_services FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_child_guard();
--> statement-breakpoint
CREATE TRIGGER aac_payment_workspace_child_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_add_on FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_child_guard();
--> statement-breakpoint
CREATE TRIGGER aac_payment_workspace_child_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_final_item FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_child_guard();
--> statement-breakpoint
CREATE TRIGGER aac_payment_workspace_child_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_payment FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_child_guard();
--> statement-breakpoint
CREATE TRIGGER aac_payment_workspace_child_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_deposit FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_child_guard();
--> statement-breakpoint
CREATE TABLE customer_payment_live_observation (
 id text PRIMARY KEY,
 appointment_id text NOT NULL REFERENCES customer_payment_workspace(appointment_id) ON DELETE RESTRICT,
 salon_id text NOT NULL,
 operation_id text NOT NULL,
 fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 facts jsonb NOT NULL CHECK (jsonb_typeof(facts)='object' AND octet_length(facts::text)<=16384),
 observed_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_live_observation_once ON customer_payment_live_observation(operation_id,fingerprint);
--> statement-breakpoint
CREATE TRIGGER payment_live_observation_immutable BEFORE UPDATE OR DELETE ON customer_payment_live_observation FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_history_guard();
--> statement-breakpoint
CREATE TABLE customer_payment_live_settlement (
 operation_id text PRIMARY KEY,
 appointment_id text NOT NULL REFERENCES customer_payment_workspace(appointment_id) ON DELETE RESTRICT,
 salon_id text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('payment','refund')),
 platform_account_id text NOT NULL,
 account_id text NOT NULL,
 livemode boolean NOT NULL,
 object_id text NOT NULL,
 payment_intent_id text NOT NULL CHECK (payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
 charge_id text NOT NULL CHECK (charge_id ~ '^ch_[A-Za-z0-9]+$'),
 parent_operation_id text REFERENCES customer_payment_live_settlement(operation_id) ON DELETE RESTRICT,
 principal_cents integer NOT NULL CHECK (principal_cents>=0),
 tip_cents integer NOT NULL CHECK (tip_cents>=0 AND principal_cents+tip_cents BETWEEN 1 AND 50000000),
 evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
 evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=16384),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='payment' AND parent_operation_id IS NULL AND object_id ~ '^cs_(test_|live_)?[A-Za-z0-9]+$')
  OR (kind='refund' AND parent_operation_id IS NOT NULL AND object_id ~ '^re_[A-Za-z0-9]+$'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_live_settlement_object_once ON customer_payment_live_settlement(platform_account_id,account_id,livemode,object_id);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_live_settlement_charge_once ON customer_payment_live_settlement(platform_account_id,account_id,livemode,charge_id) WHERE kind='payment';
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_live_settlement_intent_once ON customer_payment_live_settlement(platform_account_id,account_id,livemode,payment_intent_id) WHERE kind='payment';
--> statement-breakpoint
CREATE TRIGGER payment_live_settlement_immutable BEFORE UPDATE OR DELETE ON customer_payment_live_settlement FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_history_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_live_settlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE op jsonb; parent customer_payment_live_settlement; used_principal bigint; used_tip bigint;
BEGIN
 SELECT item INTO op FROM customer_payment_workspace w,LATERAL jsonb_array_elements(w.state->'operations') item
 WHERE w.appointment_id=NEW.appointment_id AND w.salon_id=NEW.salon_id AND item->>'id'=NEW.operation_id;
 IF op IS NULL OR op->>'state'<>'succeeded' OR op->>'kind'<>NEW.kind OR op->>'providerObjectId'<>NEW.object_id
  OR (op->>'principalCents')::integer<>NEW.principal_cents OR (op->>'tipCents')::integer<>NEW.tip_cents
  OR op#>>'{binding,platformAccountId}'<>NEW.platform_account_id OR op#>>'{binding,connectedAccountId}'<>NEW.account_id
  OR (op#>>'{binding,livemode}')::boolean<>NEW.livemode OR op#>>'{binding,currency}'<>'cad'
  OR NEW.evidence->>'status' IS DISTINCT FROM 'succeeded' OR NEW.evidence->>'operationId' IS DISTINCT FROM NEW.operation_id
  OR NEW.evidence->>'objectId' IS DISTINCT FROM NEW.object_id OR NEW.evidence->>'chargeId' IS DISTINCT FROM NEW.charge_id
  OR NEW.evidence->>'paymentIntentId' IS DISTINCT FROM NEW.payment_intent_id
  OR (NEW.evidence->>'amountCents')::integer IS DISTINCT FROM NEW.principal_cents+NEW.tip_cents
 THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_SETTLEMENT_SOURCE_REQUIRED'; END IF;
 IF NEW.kind='refund' THEN
  SELECT * INTO parent FROM customer_payment_live_settlement WHERE operation_id=NEW.parent_operation_id FOR UPDATE;
  SELECT coalesce(sum(principal_cents),0),coalesce(sum(tip_cents),0) INTO used_principal,used_tip
   FROM customer_payment_live_settlement WHERE parent_operation_id=NEW.parent_operation_id;
  IF parent.operation_id IS NULL OR parent.kind<>'payment' OR parent.appointment_id<>NEW.appointment_id OR parent.salon_id<>NEW.salon_id
   OR parent.platform_account_id<>NEW.platform_account_id OR parent.account_id<>NEW.account_id OR parent.livemode<>NEW.livemode
   OR parent.charge_id<>NEW.charge_id OR parent.payment_intent_id<>NEW.payment_intent_id
   OR op->>'approvedBy' IS NULL OR op->>'parentPaymentId'<>'lpay_'||parent.operation_id OR op->>'parentChargeId'<>parent.charge_id
   OR used_principal+NEW.principal_cents>parent.principal_cents OR used_tip+NEW.tip_cents>parent.tip_cents
  THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_REFUND_ALLOCATION_INVALID'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_live_settlement_guard BEFORE INSERT ON customer_payment_live_settlement FOR EACH ROW EXECUTE FUNCTION customer_payment_live_settlement_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_live_tender_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settlement customer_payment_live_settlement;
BEGIN
 IF TG_OP<>'INSERT' AND (left(OLD.id,5)='lpay_' OR left(coalesce(OLD.reference,''),22)='customer_payment_live:')
 THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_HISTORY_IMMUTABLE'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF left(NEW.id,5)='lpay_' OR left(coalesce(NEW.reference,''),22)='customer_payment_live:' THEN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_HISTORY_IMMUTABLE'; END IF;
  SELECT * INTO settlement FROM customer_payment_live_settlement WHERE operation_id=substring(NEW.id FROM 6) AND kind='payment';
  IF settlement.operation_id IS NULL OR settlement.salon_id<>NEW.salon_id OR settlement.appointment_id<>NEW.appointment_id
   OR NEW.amount_cents<>settlement.principal_cents+settlement.tip_cents OR NEW.method IS DISTINCT FROM 'online'
   OR NEW.reference IS DISTINCT FROM 'customer_payment_live:'||settlement.operation_id OR NEW.recorded_by_type<>'system'
   OR NEW.idempotency_key IS DISTINCT FROM 'luster_cp_v1_'||settlement.operation_id OR NEW.voided_at IS NOT NULL
  THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_CANONICAL_SOURCE_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_live_tender_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_payment FOR EACH ROW EXECUTE FUNCTION customer_payment_live_tender_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_workspace_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_op jsonb; new_op jsonb;
BEGIN
 FOR old_op IN SELECT value FROM jsonb_array_elements(OLD.state->'operations') LOOP
  SELECT value INTO new_op FROM jsonb_array_elements(NEW.state->'operations') WHERE value->>'id'=old_op->>'id';
  IF new_op IS NULL OR (old_op-ARRAY['state','approvedBy','reason','firstDispatchAt','dispatchToken','dispatchUntil','providerObjectId','providerConflict'])
    IS DISTINCT FROM (new_op-ARRAY['state','approvedBy','reason','firstDispatchAt','dispatchToken','dispatchUntil','providerObjectId','providerConflict'])
   OR (old_op->>'providerConflict'='true' AND new_op->>'providerConflict' IS DISTINCT FROM 'true')
   OR (old_op->>'firstDispatchAt' IS NOT NULL AND old_op->'firstDispatchAt' IS DISTINCT FROM new_op->'firstDispatchAt')
   OR (old_op->>'providerObjectId' IS NOT NULL AND old_op->'providerObjectId' IS DISTINCT FROM new_op->'providerObjectId')
   OR (old_op->>'approvedBy' IS NOT NULL AND old_op->'approvedBy' IS DISTINCT FROM new_op->'approvedBy')
   OR (old_op->>'state' IN ('succeeded','failed','canceled') AND new_op->>'state' NOT IN (old_op->>'state','review'))
  THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_OPERATION_IMMUTABLE'; END IF;
 END LOOP;
 -- A bill revision never erases or rewrites prior payments/refund allocations.
 IF jsonb_array_length(NEW.state->'payments')<jsonb_array_length(OLD.state->'payments')
  OR NOT ((NEW.state->'payments') @> (OLD.state->'payments'))
  OR NOT (coalesce(NEW.state->'billChanges','[]') @> coalesce(OLD.state->'billChanges','[]'))
 THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_HISTORY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_workspace_operation_guard BEFORE UPDATE ON customer_payment_workspace FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_operation_guard();
--> statement-breakpoint
-- Reciprocal admission uses the same appointment lock as both repositories.
CREATE FUNCTION customer_payment_workspace_sdk_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.execution_kind='sdk_closed_http_v1' THEN
  PERFORM id FROM appointment WHERE id=NEW.appointment_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM customer_payment_workspace WHERE appointment_id=NEW.appointment_id)
  THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_OWNERSHIP_CONFLICT'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_payment_workspace_sdk_owner_guard BEFORE INSERT ON customer_payment_closed_checkout_operation FOR EACH ROW EXECUTE FUNCTION customer_payment_workspace_sdk_owner_guard();
--> statement-breakpoint
-- Object identity is shared across payment families. Sorted transaction locks
-- serialize both insertion orders, including different appointments/tenants.
CREATE FUNCTION customer_payment_live_object_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE object_key text;
BEGIN
 FOR object_key IN SELECT DISTINCT x FROM unnest(ARRAY[NEW.object_id,NEW.payment_intent_id,NEW.charge_id]) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.account_id||':'||object_key,0));
 END LOOP;
 IF (NOT NEW.livemode AND EXISTS(SELECT 1 FROM customer_payment_closed_checkout_object WHERE platform_account_id=NEW.platform_account_id AND connected_account_id=NEW.account_id AND mode='test' AND object_id=ANY(ARRAY[NEW.object_id,NEW.payment_intent_id,NEW.charge_id])))
  OR EXISTS(SELECT 1 FROM appointment_deposit WHERE stripe_account_id=NEW.account_id AND (stripe_checkout_session_id=ANY(ARRAY[NEW.object_id,NEW.payment_intent_id,NEW.charge_id]) OR stripe_payment_intent_id=ANY(ARRAY[NEW.object_id,NEW.payment_intent_id,NEW.charge_id]) OR stripe_refund_id=ANY(ARRAY[NEW.object_id,NEW.payment_intent_id,NEW.charge_id])))
 THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_PROVIDER_OWNERSHIP_CONFLICT'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_payment_live_object_owner_guard BEFORE INSERT ON customer_payment_live_settlement FOR EACH ROW EXECUTE FUNCTION customer_payment_live_object_owner_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_closed_object_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.connected_account_id||':'||NEW.object_id,0));
 IF EXISTS(SELECT 1 FROM customer_payment_live_settlement WHERE platform_account_id=NEW.platform_account_id AND account_id=NEW.connected_account_id AND NOT livemode AND NEW.object_id=ANY(ARRAY[object_id,payment_intent_id,charge_id]))
 THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_PROVIDER_OWNERSHIP_CONFLICT'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_payment_closed_object_owner_guard BEFORE INSERT ON customer_payment_closed_checkout_object FOR EACH ROW EXECUTE FUNCTION customer_payment_closed_object_owner_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_deposit_object_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE object_key text;
BEGIN
 FOR object_key IN SELECT DISTINCT x FROM unnest(ARRAY[NEW.stripe_checkout_session_id,NEW.stripe_payment_intent_id,NEW.stripe_refund_id]) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.stripe_account_id||':'||object_key,0));
 END LOOP;
 IF EXISTS(SELECT 1 FROM customer_payment_live_settlement WHERE account_id=NEW.stripe_account_id AND (object_id=ANY(ARRAY[NEW.stripe_checkout_session_id,NEW.stripe_payment_intent_id,NEW.stripe_refund_id]) OR payment_intent_id=ANY(ARRAY[NEW.stripe_checkout_session_id,NEW.stripe_payment_intent_id,NEW.stripe_refund_id]) OR charge_id=ANY(ARRAY[NEW.stripe_checkout_session_id,NEW.stripe_payment_intent_id,NEW.stripe_refund_id])))
 THEN RAISE EXCEPTION 'PAYMENT_WORKSPACE_PROVIDER_OWNERSHIP_CONFLICT'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_payment_deposit_object_owner_guard BEFORE INSERT OR UPDATE ON appointment_deposit FOR EACH ROW EXECUTE FUNCTION customer_payment_deposit_object_owner_guard();
