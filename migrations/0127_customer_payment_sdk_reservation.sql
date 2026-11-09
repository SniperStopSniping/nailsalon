-- Inactive CLOSED SDK diagnostic only. No provider provenance, settlement or release.
-- Legacy static rows retain their old meaning and never acquire a financial hold.
ALTER TABLE customer_payment_closed_checkout_operation
 ADD COLUMN execution_kind text NOT NULL DEFAULT 'static_fixture_v1',
 ADD COLUMN capability_id text,
 ADD COLUMN binding_id text,
 ADD COLUMN source_revisions jsonb,
 ADD COLUMN financial_context_hash text,
 ADD COLUMN reconstruction jsonb,
 ADD CONSTRAINT closed_checkout_execution_kind CHECK(execution_kind IN ('static_fixture_v1','sdk_closed_http_v1')),
 ADD CONSTRAINT closed_checkout_sdk_material CHECK(
  (execution_kind='static_fixture_v1' AND capability_id IS NULL AND binding_id IS NULL AND source_revisions IS NULL AND financial_context_hash IS NULL AND reconstruction IS NULL)
  OR (execution_kind='sdk_closed_http_v1' AND capability_id IS NOT NULL AND binding_id IS NOT NULL
   AND source_revisions IS NOT NULL AND jsonb_typeof(source_revisions)='object'
   AND financial_context_hash IS NOT NULL AND financial_context_hash ~ '^[a-f0-9]{64}$'
   AND reconstruction IS NOT NULL AND reconstruction='{"version":1,"returnTemplate":"closed_invalid_v1"}'::jsonb));
--> statement-breakpoint
-- Source-scoped serialized watermarks, NOT a global sequence/max commit-order guess.
-- Rows/facts survive source pruning; there is deliberately no FK back to secrets.
CREATE TABLE customer_payment_checkout_source_revision (
 source_key text PRIMARY KEY,
 revision integer NOT NULL CHECK(revision>=0 AND revision<2147483647)
);
--> statement-breakpoint
CREATE TABLE customer_payment_checkout_source_fact (
 source_key text NOT NULL REFERENCES customer_payment_checkout_source_revision(source_key) ON DELETE RESTRICT,
 revision integer NOT NULL CHECK(revision>=0),
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(source_key,revision)
);
--> statement-breakpoint
CREATE FUNCTION customer_payment_checkout_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (NEW.source_key IS DISTINCT FROM OLD.source_key OR NEW.revision<>OLD.revision+1)) THEN
  RAISE EXCEPTION 'CLOSED_CHECKOUT_SOURCE_REVISION_REGRESSION';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER closed_checkout_revision_guard BEFORE UPDATE OR DELETE ON customer_payment_checkout_source_revision FOR EACH ROW EXECUTE FUNCTION customer_payment_checkout_revision_guard();
--> statement-breakpoint
CREATE TRIGGER closed_checkout_source_fact_immutable BEFORE UPDATE OR DELETE ON customer_payment_checkout_source_fact FOR EACH ROW EXECUTE FUNCTION customer_payment_closed_checkout_immutable();
--> statement-breakpoint
CREATE FUNCTION customer_payment_checkout_revision_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO customer_payment_checkout_source_fact(source_key,revision) VALUES(NEW.source_key,NEW.revision);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER closed_checkout_revision_fact AFTER INSERT OR UPDATE ON customer_payment_checkout_source_revision FOR EACH ROW EXECUTE FUNCTION customer_payment_checkout_revision_fact();
--> statement-breakpoint
INSERT INTO customer_payment_checkout_source_revision(source_key,revision)
 SELECT 'salon:'||id,0 FROM salon UNION ALL SELECT 'binding_set:'||id,0 FROM salon
 UNION ALL SELECT 'policy:'||salon_id,0 FROM customer_payment_policy
 UNION ALL SELECT 'capability:'||id,0 FROM appointment_access_token
 UNION ALL SELECT 'binding:'||id,0 FROM salon_stripe_account;
--> statement-breakpoint
CREATE FUNCTION customer_payment_checkout_source_snapshot(keys text[]) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE k text; v integer; result jsonb:='{}'::jsonb;
BEGIN
 -- Caller locks source rows in canonical order, takes these sorted shared pins,
 -- THEN rereads source material (especially the binding set). This also fences
 -- an invisible concurrent binding INSERT until after admission commits.
 FOR k IN SELECT DISTINCT x FROM unnest(keys) x ORDER BY x LOOP
  SELECT revision INTO v FROM customer_payment_checkout_source_revision WHERE source_key=k FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_SOURCE_REVISION_MISSING'; END IF;
  result:=result||jsonb_build_object(k,v);
 END LOOP;
 RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION customer_payment_checkout_source_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE keys text[]; k text;
BEGIN
 -- No appointment/journal lock, and no scan of currently visible reservations.
 -- Security revocation/pruning remains possible and invalidates every old pin.
 IF TG_TABLE_NAME='salon' THEN
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.status,NEW.publication_status,NEW.deleted_at) IS NOT DISTINCT FROM ROW(OLD.id,OLD.status,OLD.publication_status,OLD.deleted_at) THEN RETURN NEW; END IF;
  keys:=ARRAY[CASE WHEN TG_OP<>'INSERT' THEN 'salon:'||OLD.id END,CASE WHEN TG_OP<>'DELETE' THEN 'salon:'||NEW.id END,
    CASE WHEN TG_OP<>'INSERT' THEN 'binding_set:'||OLD.id END,CASE WHEN TG_OP<>'DELETE' THEN 'binding_set:'||NEW.id END];
 ELSIF TG_TABLE_NAME='customer_payment_policy' THEN
  IF TG_OP='UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NEW; END IF;
  keys:=ARRAY[CASE WHEN TG_OP<>'INSERT' THEN 'policy:'||OLD.salon_id END,CASE WHEN TG_OP<>'DELETE' THEN 'policy:'||NEW.salon_id END];
 ELSIF TG_TABLE_NAME='appointment_access_token' THEN
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'created_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'created_at') THEN RETURN NEW; END IF;
  keys:=ARRAY[CASE WHEN TG_OP<>'INSERT' THEN 'capability:'||OLD.id END,CASE WHEN TG_OP<>'DELETE' THEN 'capability:'||NEW.id END];
 ELSIF TG_TABLE_NAME='salon_stripe_account' THEN
  -- Unrelated already-revoked history does not alter the active binding set.
  -- Insertion/revocation/replacement of an active row always advances its set.
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'updated_at'-'last_synced_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'updated_at'-'last_synced_at') THEN RETURN NEW; END IF;
  keys:=ARRAY[CASE WHEN TG_OP<>'INSERT' THEN 'binding:'||OLD.id END,CASE WHEN TG_OP<>'DELETE' THEN 'binding:'||NEW.id END,
    CASE WHEN TG_OP<>'INSERT' AND OLD.revoked_at IS NULL THEN 'binding_set:'||OLD.salon_id END,
    CASE WHEN TG_OP<>'DELETE' AND NEW.revoked_at IS NULL THEN 'binding_set:'||NEW.salon_id END];
 ELSE RAISE EXCEPTION 'CLOSED_CHECKOUT_UNKNOWN_SOURCE'; END IF;
 FOR k IN SELECT DISTINCT x FROM unnest(keys) x WHERE x IS NOT NULL ORDER BY x LOOP
  INSERT INTO customer_payment_checkout_source_revision(source_key,revision) VALUES(k,1)
   ON CONFLICT(source_key) DO UPDATE SET revision=customer_payment_checkout_source_revision.revision+1;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER closed_checkout_source_changed AFTER INSERT OR UPDATE OR DELETE ON salon FOR EACH ROW EXECUTE FUNCTION customer_payment_checkout_source_changed();
--> statement-breakpoint
CREATE TRIGGER closed_checkout_source_changed AFTER INSERT OR UPDATE OR DELETE ON customer_payment_policy FOR EACH ROW EXECUTE FUNCTION customer_payment_checkout_source_changed();
--> statement-breakpoint
CREATE TRIGGER closed_checkout_source_changed AFTER INSERT OR UPDATE OR DELETE ON appointment_access_token FOR EACH ROW EXECUTE FUNCTION customer_payment_checkout_source_changed();
--> statement-breakpoint
CREATE TRIGGER closed_checkout_source_changed AFTER INSERT OR UPDATE OR DELETE ON salon_stripe_account FOR EACH ROW EXECUTE FUNCTION customer_payment_checkout_source_changed();
--> statement-breakpoint
CREATE FUNCTION customer_payment_has_sdk_reservation(target_id text) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM customer_payment_closed_checkout_operation WHERE appointment_id=target_id AND execution_kind='sdk_closed_http_v1')
$$;
--> statement-breakpoint
CREATE FUNCTION customer_payment_sdk_appointment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT customer_payment_has_sdk_reservation(OLD.id) THEN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_RESERVATION_RECONCILIATION_REQUIRED'; END IF;
 -- Explicit administrative allowlist: all other financial/lifecycle/identity
 -- columns (including future columns) remain frozen, without flag/prefix bypass.
 IF (to_jsonb(NEW)-ARRAY['updated_at','created_at','notes','tech_notes','client_name','client_email',
  'day_before_reminder_sent_at','day_before_reminder_channel','same_day_reminder_sent_at','same_day_reminder_channel',
  'review_followup_action','review_followup_sent_at','review_followup_sent_by','google_calendar_event_id','google_calendar_sync_status',
  'google_calendar_synced_at','google_calendar_sync_error','arrived_at','was_late'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at','created_at','notes','tech_notes','client_name','client_email',
  'day_before_reminder_sent_at','day_before_reminder_channel','same_day_reminder_sent_at','same_day_reminder_channel',
  'review_followup_action','review_followup_sent_at','review_followup_sent_by','google_calendar_event_id','google_calendar_sync_status',
  'google_calendar_synced_at','google_calendar_sync_error','arrived_at','was_late'])
 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_RESERVATION_RECONCILIATION_REQUIRED'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aab_sdk_reservation_appointment_guard BEFORE UPDATE OR DELETE ON appointment FOR EACH ROW EXECUTE FUNCTION customer_payment_sdk_appointment_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_sdk_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;
BEGIN
 FOR target IN SELECT DISTINCT x FROM unnest(ARRAY[CASE WHEN TG_OP<>'INSERT' THEN OLD.appointment_id END,CASE WHEN TG_OP<>'DELETE' THEN NEW.appointment_id END]) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM id FROM appointment WHERE id=target FOR KEY SHARE NOWAIT;
  IF customer_payment_has_sdk_reservation(target) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_RESERVATION_RECONCILIATION_REQUIRED'; END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aab_sdk_reservation_child_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_services FOR EACH ROW EXECUTE FUNCTION customer_payment_sdk_child_guard();
--> statement-breakpoint
CREATE TRIGGER aab_sdk_reservation_child_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_add_on FOR EACH ROW EXECUTE FUNCTION customer_payment_sdk_child_guard();
--> statement-breakpoint
CREATE TRIGGER aab_sdk_reservation_child_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_final_item FOR EACH ROW EXECUTE FUNCTION customer_payment_sdk_child_guard();
--> statement-breakpoint
CREATE TRIGGER aab_sdk_reservation_child_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_payment FOR EACH ROW EXECUTE FUNCTION customer_payment_sdk_child_guard();
--> statement-breakpoint
CREATE TRIGGER aab_sdk_reservation_child_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_deposit FOR EACH ROW EXECUTE FUNCTION customer_payment_sdk_child_guard();
--> statement-breakpoint
-- Extension only: preserve the old static guard and run extra SDK admission
-- checks after it. The application authenticates the raw bearer before replay.
CREATE FUNCTION customer_payment_closed_sdk_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a appointment; expected_keys text[];
BEGIN
 IF NEW.execution_kind<>'sdk_closed_http_v1' THEN RETURN NEW; END IF;
 SELECT * INTO a FROM appointment WHERE id=NEW.appointment_id AND salon_id=NEW.salon_id FOR UPDATE;
 IF a.id IS NULL OR a.status<>'confirmed' OR a.start_time<=clock_timestamp() OR a.deleted_at IS NOT NULL
  OR a.started_at IS NOT NULL OR a.completed_at IS NOT NULL OR a.locked_at IS NOT NULL
  OR a.actual_start_at IS NOT NULL OR a.actual_end_at IS NOT NULL OR a.deposit_hold_expires_at IS NOT NULL
  OR a.final_price_cents IS NOT NULL OR a.final_subtotal_cents IS NOT NULL OR a.final_tax_snapshot IS NOT NULL
  OR coalesce(a.amount_paid_cents,0)<>0 OR a.payment_status IS DISTINCT FROM 'pending'
  OR a.canvas_state IS DISTINCT FROM 'waiting'
  OR EXISTS(SELECT 1 FROM appointment_payment WHERE appointment_id=a.id)
  OR EXISTS(SELECT 1 FROM appointment_deposit WHERE appointment_id=a.id)
  OR EXISTS(SELECT 1 FROM appointment_final_item WHERE appointment_id=a.id)
 THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_RESERVATION_NOT_FRESH'; END IF;
 expected_keys:=ARRAY['salon:'||NEW.salon_id,'policy:'||NEW.salon_id,'capability:'||NEW.capability_id,'binding:'||NEW.binding_id,'binding_set:'||NEW.salon_id];
 IF NEW.source_revisions IS DISTINCT FROM customer_payment_checkout_source_snapshot(expected_keys)
 THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_SOURCE_CONTEXT_CHANGED'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER closed_checkout_sdk_operation_guard BEFORE INSERT ON customer_payment_closed_checkout_operation FOR EACH ROW EXECUTE FUNCTION customer_payment_closed_sdk_operation_guard();
--> statement-breakpoint
-- Locate the original unnamed review/lease check rather than depending on
-- PostgreSQL's generated check suffix (other constraints remain untouched).
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='customer_payment_closed_checkout_state'::regclass
  AND contype='c' AND pg_get_constraintdef(oid) LIKE '%state%review%lease_token%'
 LOOP EXECUTE format('ALTER TABLE customer_payment_closed_checkout_state DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE customer_payment_closed_checkout_state ADD CONSTRAINT closed_checkout_review_retrieval_only CHECK(state<>'review' OR lease_token IS NULL OR activity='retrieve');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION customer_payment_closed_checkout_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.version<>OLD.version+1 OR (OLD.state='review' AND (o.execution_kind<>'sdk_closed_http_v1' OR NEW.state<>'review'))
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
  ELSIF NEW.session IS DISTINCT FROM OLD.session AND (o.execution_kind<>'sdk_closed_http_v1' OR OLD.create_consumed_at IS NULL OR NEW.lease_token IS NOT NULL) THEN
   RAISE EXCEPTION 'CLOSED_CHECKOUT_REVIEW_EVIDENCE';
  END IF;
  IF NEW.state='review' AND o.execution_kind='static_fixture_v1' AND NEW.lease_token IS NOT NULL THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_REVIEW_LEASE'; END IF;
  IF o.execution_kind='sdk_closed_http_v1' AND ((OLD.dispatch_intent_at IS NULL AND NEW.dispatch_intent_at IS NOT NULL) OR (OLD.create_consumed_at IS NULL AND NEW.create_consumed_at IS NOT NULL)) THEN
   IF o.source_revisions IS DISTINCT FROM customer_payment_checkout_source_snapshot(ARRAY['salon:'||o.salon_id,'policy:'||o.salon_id,'capability:'||o.capability_id,'binding:'||o.binding_id,'binding_set:'||o.salon_id]) THEN RAISE EXCEPTION 'CLOSED_CHECKOUT_SOURCE_CONTEXT_CHANGED'; END IF;
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
