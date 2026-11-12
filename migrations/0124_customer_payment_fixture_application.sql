-- Offline canonical fixture application. No production/provider authority or backfill.
CREATE TABLE customer_payment_fixture_admission(id integer PRIMARY KEY CHECK(id=1),revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0 AND revision<9007199254740991));
--> statement-breakpoint
INSERT INTO customer_payment_fixture_admission(id) VALUES(1);
--> statement-breakpoint
CREATE TABLE customer_payment_fixture_platform(platform_id text PRIMARY KEY CHECK(platform_id ~ '^acct_[A-Za-z0-9]+$'),revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0 AND revision<9007199254740991));
--> statement-breakpoint
CREATE TABLE customer_payment_fixture_application(
 id text PRIMARY KEY,operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,
 quote_id text NOT NULL REFERENCES customer_payment_prepared_quote(id) ON DELETE RESTRICT,
 capture_id text NOT NULL REFERENCES customer_payment_capture(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 tender_id text NOT NULL REFERENCES appointment_payment(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 salon_id text NOT NULL,appointment_id text NOT NULL,
 platform_id text NOT NULL REFERENCES customer_payment_fixture_platform(platform_id) ON DELETE RESTRICT,
 account_id text NOT NULL CHECK(account_id ~ '^acct_[A-Za-z0-9]+$'),mode text NOT NULL CHECK(mode='test'),source text NOT NULL CHECK(source='offline_fixture_test'),
 charge_id text NOT NULL CHECK(charge_id ~ '^ch_[A-Za-z0-9]+$'),payment_intent_id text NOT NULL CHECK(payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
 candidate_id text NOT NULL REFERENCES customer_payment_charge_candidate(id) ON DELETE RESTRICT,
 correlation_id text NOT NULL REFERENCES customer_payment_correlation(id) ON DELETE RESTRICT,
 source_revision text NOT NULL CHECK(source_revision ~ '^[a-f0-9]{64}$'),source_evidence jsonb NOT NULL,
 ownership_revision text NOT NULL CHECK(ownership_revision ~ '^[a-f0-9]{64}$'),ownership_evidence jsonb NOT NULL,
 platform_revision bigint NOT NULL CHECK(platform_revision>=0 AND platform_revision<9007199254740991),
 capture_fingerprint text NOT NULL CHECK(capture_fingerprint ~ '^[a-f0-9]{64}$'),quote_fingerprint text NOT NULL CHECK(quote_fingerprint ~ '^[a-f0-9]{64}$'),
 success_inbox_id text NOT NULL REFERENCES customer_payment_provider_inbox(id) ON DELETE RESTRICT,
 success_receipt_fingerprint text NOT NULL CHECK(success_receipt_fingerprint ~ '^[a-f0-9]{64}$'),success_event_at timestamptz NOT NULL,
 currency text NOT NULL CHECK(currency='cad'),amount_cents integer NOT NULL CHECK(amount_cents>0),principal_cents integer NOT NULL CHECK(principal_cents>=0),tip_cents integer NOT NULL CHECK(tip_cents>=0),application_fee_cents integer NOT NULL CHECK(application_fee_cents>=0 AND application_fee_cents<amount_cents),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(salon_id,appointment_id) REFERENCES appointment(salon_id,id) ON DELETE RESTRICT,
 CHECK(amount_cents::bigint=principal_cents::bigint+tip_cents::bigint),CHECK(tender_id='cpay_'||capture_id),CHECK(success_event_at<=created_at));
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_fixture_application_operation_once ON customer_payment_fixture_application(operation_id);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_fixture_application_capture_once ON customer_payment_fixture_application(capture_id);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_fixture_application_tender_once ON customer_payment_fixture_application(tender_id);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_fixture_application_charge_once ON customer_payment_fixture_application(platform_id,account_id,mode,charge_id);
--> statement-breakpoint
CREATE TABLE customer_payment_fixture_hold(
 id text PRIMARY KEY,application_id text NOT NULL REFERENCES customer_payment_fixture_application(id) ON DELETE RESTRICT,
 platform_id text NOT NULL REFERENCES customer_payment_fixture_platform(platform_id) ON DELETE RESTRICT,
 platform_revision bigint NOT NULL CHECK(platform_revision>0),source_table text NOT NULL CHECK(length(source_table)>0),source_id text NOT NULL CHECK(length(source_id)>0),reason text NOT NULL CHECK(reason='source_changed'),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_fixture_hold_once ON customer_payment_fixture_hold(application_id,platform_revision);
--> statement-breakpoint
CREATE FUNCTION customer_payment_fixture_admission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_ADMISSION_IMMUTABLE'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.revision IS DISTINCT FROM OLD.revision+1 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_ADMISSION_INVALID'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_fixture_admission_guard BEFORE UPDATE OR DELETE ON customer_payment_fixture_admission FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_admission_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_fixture_admit() RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE found_id integer;
BEGIN
 SELECT id INTO found_id FROM customer_payment_fixture_admission WHERE id=1 FOR UPDATE NOWAIT;
 IF found_id IS NULL THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_ADMISSION_MISSING'; END IF;
 UPDATE customer_payment_fixture_admission SET revision=revision+1 WHERE id=1;
 -- Never wait on the old correlation mutex after owning admission.
 PERFORM id FROM customer_payment_correlation_mutex WHERE id=1 FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_CORRELATION_MUTEX_MISSING'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION customer_payment_fixture_platform_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM customer_payment_fixture_admit();
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_PLATFORM_IMMUTABLE'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_PLATFORM_INVALID'; END IF;
 ELSE
  IF NEW.platform_id IS DISTINCT FROM OLD.platform_id OR NEW.revision IS DISTINCT FROM OLD.revision+1 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_PLATFORM_INVALID'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_fixture_platform_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_fixture_platform FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_platform_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_fixture_hold_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a customer_payment_fixture_application; current_revision bigint;
BEGIN
 PERFORM customer_payment_fixture_admit();
 SELECT * INTO a FROM customer_payment_fixture_application WHERE id=NEW.application_id;
 SELECT revision INTO current_revision FROM customer_payment_fixture_platform WHERE platform_id=NEW.platform_id FOR SHARE NOWAIT;
 IF a.id IS NULL OR a.platform_id IS DISTINCT FROM NEW.platform_id OR NEW.platform_revision<=a.platform_revision OR NEW.platform_revision IS DISTINCT FROM current_revision THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_HOLD_INVALID'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_fixture_hold_guard BEFORE INSERT ON customer_payment_fixture_hold FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_hold_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_fixture_platform_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Raw revision changes are also conservative holds. Source details are appended
 -- by the source trigger when available; the revision itself is authoritative.
 INSERT INTO customer_payment_fixture_hold(id,application_id,platform_id,platform_revision,source_table,source_id,reason)
 SELECT gen_random_uuid()::text,a.id,NEW.platform_id,NEW.revision,'customer_payment_fixture_platform',NEW.platform_id,'source_changed'
 FROM customer_payment_fixture_application a WHERE a.platform_id=NEW.platform_id AND a.platform_revision<NEW.revision ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_fixture_platform_hold AFTER UPDATE ON customer_payment_fixture_platform FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_platform_hold();
--> statement-breakpoint
CREATE FUNCTION customer_payment_fixture_source_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM customer_payment_fixture_admit();
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION customer_payment_fixture_source_material() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p text; rowdata jsonb:=to_jsonb(NEW); source_id text; next_revision bigint;
BEGIN
 IF TG_TABLE_NAME='customer_payment_provider_operation_state' AND TG_OP='UPDATE'
  AND ((to_jsonb(NEW)->'state')-ARRAY['version','leaseToken','leaseUntil','leasePurpose','createdAt','updatedAt']) IS NOT DISTINCT FROM ((to_jsonb(OLD)->'state')-ARRAY['version','leaseToken','leaseUntil','leasePurpose','createdAt','updatedAt']) THEN RETURN NEW; END IF;
 source_id:=coalesce(rowdata->>'id',rowdata->>'operation_id');
 CASE TG_TABLE_NAME
 WHEN 'customer_payment_provider_inbox' THEN p:=rowdata->>'platform_id';
 WHEN 'customer_payment_provider_conflict' THEN SELECT platform_id INTO p FROM customer_payment_provider_inbox WHERE id=rowdata->>'inbox_id';
 WHEN 'customer_payment_provider_operation' THEN p:=rowdata#>>'{identity,platformId}';
 WHEN 'customer_payment_provider_operation_state' THEN SELECT identity->>'platformId' INTO p FROM customer_payment_provider_operation WHERE id=rowdata->>'operation_id';
 WHEN 'customer_payment_charge_candidate' THEN p:=rowdata->>'platform_id';
 WHEN 'customer_payment_movement_candidate' THEN p:=rowdata#>>'{movement_key,platformId}';
 WHEN 'customer_payment_dispute_candidate' THEN p:=rowdata#>>'{key,platformId}';
 WHEN 'customer_payment_dispute_balance_candidate' THEN p:=rowdata#>>'{key,platformId}';
 ELSE
  IF rowdata ? 'inbox_id' AND NOT(rowdata ? 'operation_id') THEN SELECT platform_id INTO p FROM customer_payment_provider_inbox WHERE id=rowdata->>'inbox_id';
  ELSE SELECT identity->>'platformId' INTO p FROM customer_payment_provider_operation WHERE id=rowdata->>'operation_id'; END IF;
 END CASE;
 IF p IS NULL OR source_id IS NULL THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_SOURCE_SCOPE'; END IF;
 INSERT INTO customer_payment_fixture_platform(platform_id,revision) VALUES(p,0) ON CONFLICT DO NOTHING;
 UPDATE customer_payment_fixture_platform SET revision=revision+1 WHERE platform_id=p RETURNING revision INTO next_revision;
 IF next_revision IS NULL THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_PLATFORM_WRITE_FAILED'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_provider_inbox FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER zzz_fixture_source_material AFTER INSERT ON customer_payment_provider_inbox FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_material();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_provider_conflict FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER zzz_fixture_source_material AFTER INSERT ON customer_payment_provider_conflict FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_material();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_provider_operation FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER zzz_fixture_source_material AFTER INSERT ON customer_payment_provider_operation FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_material();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_provider_operation_state FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER zzz_fixture_source_material AFTER INSERT OR UPDATE ON customer_payment_provider_operation_state FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_material();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_session_projection FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER zzz_fixture_source_material AFTER INSERT ON customer_payment_session_projection FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_material();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_refund_projection FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER zzz_fixture_source_material AFTER INSERT ON customer_payment_refund_projection FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_material();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_dispute_projection FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER zzz_fixture_source_material AFTER INSERT ON customer_payment_dispute_projection FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_material();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_correlation_link FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_refund_correlation_link FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_dispute_correlation_link FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_charge_candidate FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER zzz_fixture_source_material AFTER INSERT ON customer_payment_charge_candidate FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_material();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_charge_claim FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER zzz_fixture_source_material AFTER INSERT ON customer_payment_charge_claim FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_material();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_movement_candidate FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER zzz_fixture_source_material AFTER INSERT ON customer_payment_movement_candidate FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_material();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_movement_claim FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER zzz_fixture_source_material AFTER INSERT ON customer_payment_movement_claim FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_material();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_dispute_candidate FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER zzz_fixture_source_material AFTER INSERT ON customer_payment_dispute_candidate FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_material();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_dispute_claim FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER zzz_fixture_source_material AFTER INSERT ON customer_payment_dispute_claim FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_material();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_dispute_balance_candidate FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER zzz_fixture_source_material AFTER INSERT ON customer_payment_dispute_balance_candidate FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_material();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_source_admission BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_dispute_balance_claim FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER zzz_fixture_source_material AFTER INSERT ON customer_payment_dispute_balance_claim FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_material();
--> statement-breakpoint
ALTER TABLE customer_payment_capture DROP CONSTRAINT customer_payment_capture_synthetic_only;
--> statement-breakpoint
ALTER TABLE customer_payment_capture ADD CONSTRAINT customer_payment_capture_test_source_only CHECK(mode='test' AND source IN ('synthetic_test','offline_fixture_test'));
--> statement-breakpoint
CREATE FUNCTION customer_payment_fixture_binding_validate(target_id text) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE a customer_payment_fixture_application; c customer_payment_capture; t appointment_payment; q customer_payment_prepared_quote; o customer_payment_provider_operation; os customer_payment_provider_operation_state; cand customer_payment_charge_candidate; cl customer_payment_charge_claim; r customer_payment_provider_inbox; ap appointment; current_revision bigint; expected_platform jsonb; expected_conflicts jsonb;
BEGIN
 SELECT * INTO a FROM customer_payment_fixture_application WHERE id=target_id;
 IF a.id IS NULL THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_BINDING_MISSING'; END IF;
 PERFORM customer_payment_fixture_admit();
 SELECT revision INTO current_revision FROM customer_payment_fixture_platform WHERE platform_id=a.platform_id FOR SHARE NOWAIT;
 SELECT * INTO c FROM customer_payment_capture WHERE id=a.capture_id;
 SELECT * INTO t FROM appointment_payment WHERE id=a.tender_id;
 SELECT * INTO q FROM customer_payment_prepared_quote WHERE id=a.quote_id;
 SELECT * INTO o FROM customer_payment_provider_operation WHERE id=a.operation_id;
 SELECT * INTO os FROM customer_payment_provider_operation_state WHERE operation_id=a.operation_id;
 SELECT * INTO cand FROM customer_payment_charge_candidate WHERE id=a.candidate_id;
 SELECT * INTO cl FROM customer_payment_charge_claim WHERE candidate_id=a.candidate_id AND operation_id=a.operation_id AND correlation_id=a.correlation_id;
 SELECT * INTO r FROM customer_payment_provider_inbox WHERE id=a.success_inbox_id;
 SELECT * INTO ap FROM appointment WHERE id=a.appointment_id;
 IF c.id IS NULL OR t.id IS NULL OR q.id IS NULL OR o.id IS NULL OR cand.id IS NULL OR cl.id IS NULL OR r.id IS NULL OR ap.id IS NULL
 OR c.source IS DISTINCT FROM 'offline_fixture_test' OR c.state IS DISTINCT FROM 'posted' OR c.review_reason IS NOT NULL
 OR ROW(c.salon_id,c.appointment_id,c.quote_id,c.stripe_account_id,c.mode,c.payment_intent_id,c.tender_id,c.currency,c.amount_cents,c.principal_cents,c.tip_cents,c.application_fee_cents,c.fingerprint,c.captured_at)
 IS DISTINCT FROM ROW(a.salon_id,a.appointment_id,a.quote_id,a.account_id,a.mode,a.payment_intent_id,a.tender_id,a.currency,a.amount_cents,a.principal_cents,a.tip_cents,a.application_fee_cents,a.capture_fingerprint,a.success_event_at)
 OR ROW(t.salon_id,t.appointment_id,t.amount_cents,t.method,t.recorded_by_type,t.reference,t.recorded_at)
 IS DISTINCT FROM ROW(a.salon_id,a.appointment_id,a.amount_cents,'online'::text,'system'::text,'customer_payment_capture:'||a.capture_id,a.success_event_at)
 OR t.voided_at IS NOT NULL OR q.fingerprint IS DISTINCT FROM a.quote_fingerprint
 OR ROW(q.salon_id,q.appointment_id,q.stripe_account_id,q.mode) IS DISTINCT FROM ROW(a.salon_id,a.appointment_id,a.account_id,a.mode)
 OR q.snapshot->>'collection' IS DISTINCT FROM 'full' OR q.snapshot->>'currency' IS DISTINCT FROM a.currency
 OR (q.snapshot->>'chargeCents')::bigint IS DISTINCT FROM a.amount_cents::bigint OR (q.snapshot->>'tipCents')::bigint IS DISTINCT FROM a.tip_cents::bigint
 OR (q.snapshot->>'serviceTotalCents')::bigint IS DISTINCT FROM a.principal_cents::bigint OR (q.snapshot->>'applicationFeeCents')::bigint IS DISTINCT FROM a.application_fee_cents::bigint
 OR c.quoted_application_fee_cents IS DISTINCT FROM a.application_fee_cents OR c.recorded_at IS DISTINCT FROM a.created_at OR a.created_at>clock_timestamp()
 OR a.success_event_at<q.created_at OR a.success_event_at>=q.expires_at OR a.created_at>=q.expires_at OR clock_timestamp()>=q.expires_at
 OR o.identity->>'kind' IS DISTINCT FROM 'checkout_create' OR os.state->>'state' IS DISTINCT FROM 'succeeded'
 OR ROW(o.salon_id,o.appointment_id,o.quote_id,o.identity->>'platformId',o.identity->>'accountId',o.identity->>'mode',o.identity->>'contextHash') IS DISTINCT FROM ROW(a.salon_id,a.appointment_id,a.quote_id,a.platform_id,a.account_id,a.mode,a.quote_fingerprint)
 OR ROW(cand.platform_id,cand.account_id,cand.mode,cand.charge_id,cand.first_operation_id) IS DISTINCT FROM ROW(a.platform_id,a.account_id,a.mode,a.charge_id,a.operation_id)
 OR EXISTS(SELECT 1 FROM customer_payment_charge_claim x WHERE x.candidate_id=cand.id AND (x.operation_id<>a.operation_id OR x.fingerprint<>cl.fingerprint))
 OR cl.facts->>'paymentIntentId' IS DISTINCT FROM a.payment_intent_id OR (cl.facts->>'amountCents')::bigint IS DISTINCT FROM a.amount_cents::bigint
 OR cl.facts->>'currency' IS DISTINCT FROM a.currency OR (cl.facts->>'applicationFeeCents')::bigint IS DISTINCT FROM a.application_fee_cents::bigint
 OR r.fingerprint IS DISTINCT FROM a.success_receipt_fingerprint OR r.platform_id IS DISTINCT FROM a.platform_id
 OR r.account_scope IS DISTINCT FROM 'connected' OR r.account_key IS DISTINCT FROM a.account_id OR r.mode IS DISTINCT FROM 'test'
 OR r.receipt->>'eventType' IS DISTINCT FROM 'charge.succeeded' OR r.receipt->>'objectId' IS DISTINCT FROM a.charge_id
 OR r.receipt->>'source' IS DISTINCT FROM 'offline_signed_fixture' OR r.receipt->>'classification' IS DISTINCT FROM 'accepted'
 OR r.receipt#>>'{normalizedFacts,paymentIntentId}' IS DISTINCT FROM a.payment_intent_id
 OR (r.receipt#>>'{normalizedFacts,amountCents}')::bigint IS DISTINCT FROM a.amount_cents::bigint
 OR (r.receipt#>>'{normalizedFacts,amountCapturedCents}')::bigint IS DISTINCT FROM a.amount_cents::bigint
 OR (r.receipt#>>'{normalizedFacts,amountRefundedCents}')::bigint IS DISTINCT FROM 0::bigint
 OR r.receipt#>'{normalizedFacts,paid}' IS DISTINCT FROM 'true'::jsonb OR r.receipt#>'{normalizedFacts,captured}' IS DISTINCT FROM 'true'::jsonb
 OR to_timestamp((r.receipt#>>'{normalizedFacts,created}')::double precision) IS DISTINCT FROM a.success_event_at
 OR current_revision IS DISTINCT FROM a.platform_revision OR EXISTS(SELECT 1 FROM customer_payment_fixture_hold h WHERE h.application_id=a.id)
 OR ap.salon_id IS DISTINCT FROM a.salon_id OR ap.tip_cents IS DISTINCT FROM a.tip_cents OR ap.amount_paid_cents IS DISTINCT FROM a.amount_cents
 OR ap.deleted_at IS NOT NULL OR ap.status NOT IN ('confirmed','pending','in_progress')
 OR EXISTS(SELECT 1 FROM appointment_deposit d WHERE d.appointment_id=a.appointment_id)
 OR EXISTS(SELECT 1 FROM appointment_payment p WHERE p.appointment_id=a.appointment_id AND p.id<>a.tender_id)
 OR EXISTS(SELECT 1 FROM customer_payment_capture x WHERE x.appointment_id=a.appointment_id AND x.id<>a.capture_id)
 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_BINDING_INVALID'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'fingerprint',fingerprint) ORDER BY id),'[]'::jsonb) INTO expected_platform FROM customer_payment_provider_inbox WHERE platform_id=a.platform_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'inboxId',x.inbox_id,'fingerprint',x.fingerprint) ORDER BY x.id),'[]'::jsonb) INTO expected_conflicts FROM customer_payment_provider_conflict x JOIN customer_payment_provider_inbox i ON i.id=x.inbox_id WHERE i.platform_id=a.platform_id;
 IF jsonb_typeof(a.source_evidence) IS DISTINCT FROM 'object' OR jsonb_typeof(a.ownership_evidence) IS DISTINCT FROM 'array'
 OR a.source_evidence->'operation' IS DISTINCT FROM os.state OR a.source_evidence->'platformEvidence' IS DISTINCT FROM expected_platform
 OR a.source_evidence->'platformConflicts' IS DISTINCT FROM expected_conflicts OR expected_conflicts IS DISTINCT FROM '[]'::jsonb
 OR a.source_evidence->'blocked' IS DISTINCT FROM 'false'::jsonb OR a.source_evidence->'overflow' IS DISTINCT FROM 'false'::jsonb
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.source_evidence->'receipts') x WHERE x->>'inboxId'=r.id AND x->'receipt'=r.receipt AND x->'hasConflict'='false'::jsonb)
 OR a.ownership_evidence IS DISTINCT FROM jsonb_build_array(jsonb_build_object('operationId',a.operation_id,'fingerprint',cl.fingerprint))
 OR a.source_revision IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(a.source_evidence),'UTF8')),'hex')
 OR a.ownership_revision IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(a.ownership_evidence),'UTF8')),'hex')
 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_EVIDENCE_INVALID'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION customer_payment_fixture_binding_deferred() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE application_id text; capture_source text;
BEGIN
 IF TG_TABLE_NAME='customer_payment_fixture_application' THEN application_id:=NEW.id;
 ELSIF TG_TABLE_NAME='customer_payment_capture' THEN
  IF NEW.source='synthetic_test' THEN
   IF EXISTS(SELECT 1 FROM customer_payment_fixture_application WHERE capture_id=NEW.id) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_SOURCE_MISMATCH'; END IF;
   RETURN NEW;
  END IF;
  SELECT id INTO application_id FROM customer_payment_fixture_application WHERE capture_id=NEW.id;
 ELSE
  SELECT id INTO application_id FROM customer_payment_fixture_application WHERE tender_id=NEW.id;
  IF application_id IS NULL THEN
   SELECT source INTO capture_source FROM customer_payment_capture WHERE tender_id=NEW.id;
   IF capture_source IS DISTINCT FROM 'offline_fixture_test' THEN RETURN NEW; END IF;
  END IF;
 END IF;
 IF application_id IS NULL THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_BINDING_MISSING'; END IF;
 PERFORM customer_payment_fixture_binding_validate(application_id);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_payment_fixture_application_deferred AFTER INSERT ON customer_payment_fixture_application DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_binding_deferred();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_payment_fixture_capture_deferred AFTER INSERT ON customer_payment_capture DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_binding_deferred();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_payment_fixture_tender_deferred AFTER INSERT ON appointment_payment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_binding_deferred();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_application_admission BEFORE INSERT ON customer_payment_fixture_application FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER customer_payment_fixture_application_immutable BEFORE UPDATE OR DELETE ON customer_payment_fixture_application FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
--> statement-breakpoint
CREATE TRIGGER customer_payment_fixture_hold_immutable BEFORE UPDATE OR DELETE ON customer_payment_fixture_hold FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
--> statement-breakpoint
CREATE FUNCTION customer_payment_fixture_has_hold(target_id text) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE a customer_payment_fixture_application; current_revision bigint;
BEGIN
 -- Appointment-first path: do not wait on fence-first source/application work.
 PERFORM id FROM customer_payment_fixture_admission WHERE id=1 FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_ADMISSION_MISSING'; END IF;
 FOR a IN SELECT * FROM customer_payment_fixture_application WHERE appointment_id=target_id LOOP
  SELECT revision INTO current_revision FROM customer_payment_fixture_platform WHERE platform_id=a.platform_id FOR SHARE NOWAIT;
  IF current_revision IS DISTINCT FROM a.platform_revision OR EXISTS(SELECT 1 FROM customer_payment_fixture_hold WHERE application_id=a.id) THEN RETURN true; END IF;
 END LOOP;
 RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION customer_payment_fixture_appointment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT customer_payment_has_marker(OLD.id) THEN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'updated_at'-'notes'-'tech_notes'-'client_phone'-'client_name'-'client_email') IS NOT DISTINCT FROM (to_jsonb(OLD)-'updated_at'-'notes'-'tech_notes'-'client_phone'-'client_name'-'client_email') THEN RETURN NEW; END IF;
 IF customer_payment_fixture_has_hold(OLD.id) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_SOURCE_HOLD'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_appointment_guard BEFORE UPDATE OR DELETE ON appointment FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_appointment_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_fixture_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;
BEGIN
 FOR target IN SELECT DISTINCT x FROM unnest(ARRAY[CASE WHEN TG_OP<>'INSERT' THEN OLD.appointment_id ELSE NULL END,CASE WHEN TG_OP<>'DELETE' THEN NEW.appointment_id ELSE NULL END]) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM id FROM appointment WHERE id=target FOR KEY SHARE NOWAIT;
  IF customer_payment_has_marker(target) AND customer_payment_fixture_has_hold(target) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_SOURCE_HOLD'; END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_child_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_payment FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_child_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_child_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_deposit FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_child_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_child_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_services FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_child_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_child_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_add_on FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_child_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_child_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_refund FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_child_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_child_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_fee_binding FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_child_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_child_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_fee_refund FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_child_guard();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_child_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_payment_credit_decision FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_child_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_fixture_synthetic_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM customer_payment_capture WHERE id=NEW.capture_id AND source<>'synthetic_test') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_SYNTHETIC_SOURCE_REQUIRED'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_synthetic_event_guard BEFORE INSERT ON customer_payment_capture_event FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_synthetic_event_guard();
