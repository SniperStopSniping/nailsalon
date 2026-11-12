-- Offline immutable movement rehearsal only. No backfill or real provider authority.
CREATE TABLE customer_payment_fixture_reconciliation(
 id text PRIMARY KEY,application_id text NOT NULL REFERENCES customer_payment_fixture_application(id) ON DELETE RESTRICT,
 platform_revision bigint NOT NULL CHECK(platform_revision>=0 AND platform_revision<9007199254740991),
 source_revision text NOT NULL CHECK(source_revision ~ '^[a-f0-9]{64}$'),source_evidence jsonb NOT NULL CHECK(jsonb_typeof(source_evidence)='object'),
 ownership_revision text NOT NULL CHECK(ownership_revision ~ '^[a-f0-9]{64}$'),ownership_evidence jsonb NOT NULL CHECK(jsonb_typeof(ownership_evidence)='object'),
 movement_evidence jsonb NOT NULL CHECK(jsonb_typeof(movement_evidence)='array'),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
--> statement-breakpoint
CREATE TABLE customer_payment_fixture_movement(
 id text PRIMARY KEY,reconciliation_id text NOT NULL REFERENCES customer_payment_fixture_reconciliation(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 application_id text NOT NULL REFERENCES customer_payment_fixture_application(id) ON DELETE RESTRICT,
 capture_id text NOT NULL REFERENCES customer_payment_capture(id) ON DELETE RESTRICT,
 salon_id text NOT NULL,appointment_id text NOT NULL,platform_id text NOT NULL,
 account_scope text NOT NULL CHECK(account_scope IN ('connected','platform')),account_id text,
 source text NOT NULL CHECK(source='offline_fixture_test'),mode text NOT NULL CHECK(mode='test'),
 allocation text NOT NULL DEFAULT 'unallocated' CHECK(allocation='unallocated'),booking_credit text NOT NULL DEFAULT 'none' CHECK(booking_credit='none'),
 kind text NOT NULL CHECK(kind IN ('customer_refund','application_fee_refund','dispute_withdrawal','dispute_reinstatement')),
 movement_id text NOT NULL,movement_key_hash text NOT NULL CHECK(movement_key_hash ~ '^[a-f0-9]{64}$'),
 operation_id text NOT NULL REFERENCES customer_payment_provider_operation(id) ON DELETE RESTRICT,
 charge_id text NOT NULL CHECK(charge_id ~ '^ch_[A-Za-z0-9]+$'),payment_intent_id text NOT NULL CHECK(payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
 application_fee_id text,dispute_id text,amount_cents integer NOT NULL,fee_cents integer,net_cents integer,
 currency text NOT NULL CHECK(currency='cad'),object_created_at timestamptz NOT NULL,occurred_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
 FOREIGN KEY(salon_id,appointment_id) REFERENCES appointment(salon_id,id) ON DELETE RESTRICT,
 CHECK(object_created_at<=occurred_at AND occurred_at<=recorded_at),
 CHECK((kind='application_fee_refund' AND account_scope='platform' AND account_id IS NULL AND application_fee_id IS NOT NULL AND application_fee_id ~ '^fee_[A-Za-z0-9]+$') OR (kind<>'application_fee_refund' AND account_scope='connected' AND account_id IS NOT NULL AND account_id ~ '^acct_[A-Za-z0-9]+$')),
 CHECK(kind<>'customer_refund' OR application_fee_id IS NULL),
 CHECK(kind<>'customer_refund' OR movement_id ~ '^re_[A-Za-z0-9]+$'),
 CHECK(kind<>'application_fee_refund' OR movement_id ~ '^fr_[A-Za-z0-9]+$'),
 CHECK((kind IN ('customer_refund','application_fee_refund') AND amount_cents>0 AND fee_cents IS NULL AND net_cents IS NULL AND dispute_id IS NULL AND movement_id ~ '^(re|fr)_[A-Za-z0-9]+$') OR
 (kind IN ('dispute_withdrawal','dispute_reinstatement') AND dispute_id IS NOT NULL AND dispute_id ~ '^dp_[A-Za-z0-9]+$' AND application_fee_id IS NULL AND movement_id ~ '^txn_[A-Za-z0-9]+$' AND fee_cents IS NOT NULL AND net_cents IS NOT NULL AND net_cents::bigint=amount_cents::bigint-fee_cents::bigint AND ((kind='dispute_withdrawal' AND amount_cents<0) OR (kind='dispute_reinstatement' AND amount_cents>0)))));
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_fixture_movement_key_once ON customer_payment_fixture_movement(movement_key_hash);
--> statement-breakpoint
-- Null-safe fee identity; dispute category deliberately excluded from identity.
CREATE UNIQUE INDEX customer_payment_fixture_movement_identity_once ON customer_payment_fixture_movement(platform_id,account_scope,coalesce(account_id,''),mode,(CASE WHEN kind LIKE 'dispute_%' THEN 'dispute_balance' ELSE kind END),movement_id);
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_movement_admission BEFORE INSERT ON customer_payment_fixture_movement FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER aaa_fixture_reconciliation_admission BEFORE INSERT ON customer_payment_fixture_reconciliation FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_source_admission();
--> statement-breakpoint
CREATE TRIGGER customer_payment_fixture_movement_immutable BEFORE UPDATE OR DELETE ON customer_payment_fixture_movement FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
--> statement-breakpoint
CREATE TRIGGER customer_payment_fixture_reconciliation_immutable BEFORE UPDATE OR DELETE ON customer_payment_fixture_reconciliation FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
--> statement-breakpoint
CREATE FUNCTION customer_payment_fixture_movement_validate(target_id text) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE m customer_payment_fixture_movement; a customer_payment_fixture_application; r customer_payment_fixture_reconciliation; c customer_payment_capture; t appointment_payment; q customer_payment_prepared_quote; o customer_payment_provider_operation; os customer_payment_provider_operation_state; cl jsonb; cand jsonb; p jsonb; receipt customer_payment_provider_inbox; expected_key jsonb; expected_facts jsonb;
BEGIN
 PERFORM customer_payment_fixture_admit();
 SELECT * INTO m FROM customer_payment_fixture_movement WHERE id=target_id;
 SELECT * INTO a FROM customer_payment_fixture_application WHERE id=m.application_id;
 SELECT * INTO r FROM customer_payment_fixture_reconciliation WHERE id=m.reconciliation_id;
 SELECT * INTO c FROM customer_payment_capture WHERE id=m.capture_id;
 SELECT * INTO t FROM appointment_payment WHERE id=a.tender_id;
 SELECT * INTO q FROM customer_payment_prepared_quote WHERE id=a.quote_id;
 SELECT * INTO o FROM customer_payment_provider_operation WHERE id=m.operation_id;
 SELECT * INTO os FROM customer_payment_provider_operation_state WHERE operation_id=m.operation_id;
 IF m.id IS NULL OR a.id IS NULL OR r.id IS NULL OR c.id IS NULL OR t.id IS NULL OR q.id IS NULL OR o.id IS NULL OR os.operation_id IS NULL
 OR r.application_id IS DISTINCT FROM a.id
 OR ROW(m.capture_id,m.salon_id,m.appointment_id,m.platform_id,m.charge_id,m.payment_intent_id,m.currency) IS DISTINCT FROM ROW(a.capture_id,a.salon_id,a.appointment_id,a.platform_id,a.charge_id,a.payment_intent_id,a.currency)
 OR (m.account_scope='connected' AND m.account_id IS DISTINCT FROM a.account_id)
 OR ROW(c.salon_id,c.appointment_id,c.quote_id,c.stripe_account_id,c.mode,c.source,c.payment_intent_id,c.tender_id,c.currency,c.amount_cents,c.principal_cents,c.tip_cents,c.application_fee_cents,c.fingerprint,c.captured_at) IS DISTINCT FROM ROW(a.salon_id,a.appointment_id,a.quote_id,a.account_id,a.mode,a.source,a.payment_intent_id,a.tender_id,a.currency,a.amount_cents,a.principal_cents,a.tip_cents,a.application_fee_cents,a.capture_fingerprint,a.success_event_at)
 OR c.state IS DISTINCT FROM 'posted' OR c.review_reason IS NOT NULL
 OR ROW(t.salon_id,t.appointment_id,t.amount_cents,t.method,t.recorded_by_type,t.reference,t.recorded_at) IS DISTINCT FROM ROW(a.salon_id,a.appointment_id,a.amount_cents,'online'::text,'system'::text,'customer_payment_capture:'||a.capture_id,a.success_event_at) OR t.voided_at IS NOT NULL
 OR q.fingerprint IS DISTINCT FROM a.quote_fingerprint
 OR a.source_revision IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(a.source_evidence),'UTF8')),'hex')
 OR a.ownership_revision IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(a.ownership_evidence),'UTF8')),'hex')
 OR ROW(o.salon_id,o.appointment_id,o.quote_id,o.identity->>'platformId',o.identity->>'mode') IS DISTINCT FROM ROW(a.salon_id,a.appointment_id,a.quote_id,a.platform_id,'test'::text)
 OR os.state->>'state' IS DISTINCT FROM 'succeeded'
 OR (m.kind LIKE 'dispute_%' AND m.operation_id IS DISTINCT FROM a.operation_id)
 OR (m.kind NOT LIKE 'dispute_%' AND (o.identity->>'kind' IS DISTINCT FROM m.kind OR os.state#>>'{result,objectId}' IS DISTINCT FROM m.movement_id OR os.state#>>'{result,provenance}' IS DISTINCT FROM 'offline_fixture'))
 OR m.recorded_at>clock_timestamp() OR m.object_created_at<a.success_event_at
 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_BINDING_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM customer_payment_charge_claim x WHERE x.candidate_id=a.candidate_id AND x.operation_id=a.operation_id)
 OR EXISTS(SELECT 1 FROM customer_payment_charge_claim x WHERE x.candidate_id=a.candidate_id AND (x.operation_id<>a.operation_id OR x.fingerprint<>(SELECT fingerprint FROM customer_payment_charge_claim WHERE candidate_id=a.candidate_id AND operation_id=a.operation_id ORDER BY id LIMIT 1)))
 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_PARENT_OWNERSHIP'; END IF;
 IF m.kind LIKE 'dispute_%' THEN
  SELECT to_jsonb(x) INTO cl FROM customer_payment_dispute_balance_claim x WHERE id=m.evidence->>'claimId';
  SELECT to_jsonb(x) INTO cand FROM customer_payment_dispute_balance_candidate x WHERE id=m.evidence->>'candidateId';
  SELECT to_jsonb(x) INTO p FROM customer_payment_dispute_projection x WHERE id=m.evidence->>'projectionId';
  expected_key:=jsonb_build_object('platformId',m.platform_id,'accountScope',m.account_scope,'accountId',m.account_id,'mode',m.mode,'balanceTransactionId',m.movement_id);
 ELSE
  SELECT to_jsonb(x) INTO cl FROM customer_payment_movement_claim x WHERE id=m.evidence->>'claimId';
  SELECT to_jsonb(x) INTO cand FROM customer_payment_movement_candidate x WHERE id=m.evidence->>'candidateId';
  SELECT to_jsonb(x) INTO p FROM customer_payment_refund_projection x WHERE id=m.evidence->>'projectionId';
  expected_key:=jsonb_build_object('platformId',m.platform_id,'accountScope',m.account_scope,'accountId',m.account_id,'mode',m.mode,'kind',m.kind,'movementId',m.movement_id);
 END IF;
 SELECT * INTO receipt FROM customer_payment_provider_inbox WHERE id=m.evidence->>'inboxId';
 IF cl IS NULL OR cand IS NULL OR p IS NULL OR receipt.id IS NULL
 OR cl->>'candidate_id' IS DISTINCT FROM cand->>'id' OR cand->>'first_operation_id' IS DISTINCT FROM m.operation_id OR cl->>'operation_id' IS DISTINCT FROM m.operation_id
 OR cl->>'fingerprint' IS DISTINCT FROM m.evidence->>'candidateFingerprint' OR cl->'facts' IS DISTINCT FROM m.evidence->'candidateFacts'
 OR coalesce(cand->'movement_key',cand->'key') IS DISTINCT FROM expected_key OR m.evidence->'movementKey' IS DISTINCT FROM expected_key
 OR m.movement_key_hash IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(expected_key),'UTF8')),'hex')
 OR p->>'inbox_id' IS DISTINCT FROM receipt.id OR p->>'receipt_fingerprint' IS DISTINCT FROM receipt.fingerprint OR p->>'fingerprint' IS DISTINCT FROM m.evidence->>'projectionFingerprint'
 OR receipt.fingerprint IS DISTINCT FROM m.evidence->>'receiptFingerprint' OR receipt.platform_id IS DISTINCT FROM a.platform_id OR receipt.mode IS DISTINCT FROM 'test'
 OR receipt.receipt->>'source' IS DISTINCT FROM 'offline_signed_fixture' OR EXISTS(SELECT 1 FROM customer_payment_provider_conflict WHERE inbox_id=receipt.id)
 OR cl#>>'{facts,chargeId}' IS DISTINCT FROM m.charge_id OR cl#>>'{facts,paymentIntentId}' IS DISTINCT FROM m.payment_intent_id OR cl#>>'{facts,currency}' IS DISTINCT FROM m.currency OR (cl#>>'{facts,amountCents}')::bigint IS DISTINCT FROM m.amount_cents::bigint
 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_EVIDENCE_INVALID'; END IF;
 IF m.kind LIKE 'dispute_%' THEN
  IF cl#>>'{facts,disputeId}' IS DISTINCT FROM m.dispute_id OR (cl#>>'{facts,feeCents}')::bigint IS DISTINCT FROM m.fee_cents::bigint OR (cl#>>'{facts,netCents}')::bigint IS DISTINCT FROM m.net_cents::bigint
  OR p#>>'{projection,disputeId}' IS DISTINCT FROM m.dispute_id
  OR to_timestamp((p#>>'{projection,objectCreated}')::double precision) IS DISTINCT FROM m.object_created_at
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p#>'{projection,balanceTransactions}') bt WHERE bt->>'id'=m.movement_id AND bt->>'sourceId'=m.dispute_id AND (bt->>'amountCents')::bigint=m.amount_cents::bigint AND (bt->>'feeCents')::bigint=m.fee_cents::bigint AND (bt->>'netCents')::bigint=m.net_cents::bigint AND bt->>'currency'=m.currency AND to_timestamp((bt->>'created')::double precision)=m.occurred_at AND bt->>'reportingCategory'=cl#>>'{facts,category}')
  OR cl#>>'{facts,category}' IS DISTINCT FROM (CASE WHEN m.kind='dispute_withdrawal' THEN 'dispute' ELSE 'dispute_reversal' END)
  OR to_timestamp((cl#>>'{facts,created}')::double precision) IS DISTINCT FROM m.occurred_at
  OR EXISTS(SELECT 1 FROM customer_payment_dispute_balance_claim x WHERE candidate_id=cand->>'id' AND (operation_id<>m.operation_id OR fingerprint<>cl->>'fingerprint'))
  THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_DISPUTE_INVALID'; END IF;
 ELSE
  IF cl#>>'{facts,kind}' IS DISTINCT FROM m.kind OR cl#>>'{facts,applicationFeeId}' IS DISTINCT FROM m.application_fee_id
  OR (m.kind='customer_refund' AND p#>>'{projection,status}' IS DISTINCT FROM 'succeeded')
  OR (m.kind='application_fee_refund' AND p#>>'{projection,outcome}' IS DISTINCT FROM 'fee_return_observed')
  OR p#>>'{projection,movementId}' IS DISTINCT FROM m.movement_id OR p#>>'{projection,kind}' IS DISTINCT FROM m.kind
  OR p#>>'{projection,currency}' IS DISTINCT FROM m.currency OR (p#>>'{projection,amountCents}')::bigint IS DISTINCT FROM m.amount_cents::bigint
  OR (m.kind='customer_refund' AND (p#>>'{projection,chargeId}' IS DISTINCT FROM m.charge_id OR p#>>'{projection,paymentIntentId}' IS DISTINCT FROM m.payment_intent_id))
  OR (m.kind='application_fee_refund' AND ((p#>>'{projection,chargeId}' IS NOT NULL AND p#>>'{projection,chargeId}' IS DISTINCT FROM m.charge_id) OR (p#>>'{projection,paymentIntentId}' IS NOT NULL AND p#>>'{projection,paymentIntentId}' IS DISTINCT FROM m.payment_intent_id)))
  OR p#>>'{projection,applicationFeeId}' IS DISTINCT FROM m.application_fee_id
  OR (m.kind='application_fee_refund' AND NOT EXISTS(SELECT 1 FROM customer_payment_provider_inbox i WHERE i.id=a.success_inbox_id AND i.receipt#>>'{normalizedFacts,applicationFeeId}'=m.application_fee_id))
  OR (o.identity#>>'{parameters,amount}')::bigint IS DISTINCT FROM m.amount_cents::bigint
  OR os.state->>'firstDispatchedAt' IS NULL OR m.object_created_at<to_timestamp(floor((os.state->>'firstDispatchedAt')::double precision/1000))
  OR o.identity->>'targetId' IS DISTINCT FROM (CASE WHEN m.kind='customer_refund' THEN m.payment_intent_id ELSE m.application_fee_id END)
  OR to_timestamp((p#>>'{projection,objectCreated}')::double precision) IS DISTINCT FROM m.object_created_at
  OR to_timestamp((p#>>'{projection,eventCreated}')::double precision) IS DISTINCT FROM m.occurred_at
  OR EXISTS(SELECT 1 FROM customer_payment_movement_claim x WHERE candidate_id=cand->>'id' AND (operation_id<>m.operation_id OR fingerprint<>cl->>'fingerprint'))
  THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_REFUND_INVALID'; END IF;
 END IF;
 expected_facts:=jsonb_build_object('applicationId',m.application_id,'kind',m.kind,'movementKeyHash',m.movement_key_hash,'operationId',m.operation_id,'chargeId',m.charge_id,'paymentIntentId',m.payment_intent_id,'applicationFeeId',m.application_fee_id,'disputeId',m.dispute_id,'amountCents',m.amount_cents,'feeCents',m.fee_cents,'netCents',m.net_cents,'currency',m.currency,'objectCreatedAt',to_char(m.object_created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'occurredAt',to_char(m.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 IF m.fingerprint IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(expected_facts),'UTF8')),'hex') THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_FINGERPRINT_INVALID'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION customer_payment_fixture_reconciliation_validate(target_id text) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE r customer_payment_fixture_reconciliation; a customer_payment_fixture_application; current_revision bigint; expected jsonb; expected_conflicts jsonb; rowdata jsonb; m customer_payment_fixture_movement; dispute_limit bigint; outstanding bigint; prior_at timestamptz; prior_kind text; d text;
BEGIN
 PERFORM customer_payment_fixture_admit();
 SELECT * INTO r FROM customer_payment_fixture_reconciliation WHERE id=target_id;
 SELECT * INTO a FROM customer_payment_fixture_application WHERE id=r.application_id;
 SELECT revision INTO current_revision FROM customer_payment_fixture_platform WHERE platform_id=a.platform_id FOR SHARE NOWAIT;
 IF r.id IS NULL OR a.id IS NULL OR r.platform_revision IS DISTINCT FROM current_revision OR r.created_at>clock_timestamp()
 OR r.source_revision IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(r.source_evidence),'UTF8')),'hex')
 OR r.ownership_revision IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(r.ownership_evidence),'UTF8')),'hex')
 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_RECONCILIATION_INVALID'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'fingerprint',fingerprint) ORDER BY id),'[]'::jsonb) INTO expected FROM customer_payment_provider_inbox WHERE platform_id=a.platform_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'inboxId',x.inbox_id,'fingerprint',x.fingerprint) ORDER BY x.id),'[]'::jsonb) INTO expected_conflicts FROM customer_payment_provider_conflict x JOIN customer_payment_provider_inbox i ON i.id=x.inbox_id WHERE i.platform_id=a.platform_id;
 IF r.source_evidence->'platformEvidence' IS DISTINCT FROM expected OR r.source_evidence->'platformConflicts' IS DISTINCT FROM expected_conflicts OR expected_conflicts IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_RECONCILIATION_SOURCE'; END IF;
 IF EXISTS(SELECT 1 FROM customer_payment_provider_inbox i WHERE i.platform_id=a.platform_id AND
 (i.mode<>'test' OR i.receipt->>'source' IS DISTINCT FROM 'offline_signed_fixture'
 OR coalesce(i.receipt->>'eventType','') NOT IN ('checkout.session.completed','checkout.session.async_payment_succeeded','payment_intent.succeeded','charge.succeeded','application_fee.created','refund.created','refund.updated','refund.failed','application_fee.refund.updated','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated')
 OR (i.receipt->>'eventType' IN ('refund.created','refund.updated','refund.failed','application_fee.refund.updated') AND NOT EXISTS(SELECT 1 FROM customer_payment_refund_projection p WHERE p.inbox_id=i.id AND p.receipt_fingerprint=i.fingerprint))
 OR (i.receipt->>'eventType' LIKE 'charge.dispute.%' AND NOT EXISTS(SELECT 1 FROM customer_payment_dispute_projection p WHERE p.inbox_id=i.id AND p.receipt_fingerprint=i.fingerprint AND p.conflict_id IS NULL))))
 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_RECONCILIATION_UNSUPPORTED_SOURCE'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'inboxId',p.inbox_id,'receiptFingerprint',p.receipt_fingerprint,'fingerprint',p.fingerprint) ORDER BY p.id),'[]'::jsonb) INTO expected FROM customer_payment_refund_projection p JOIN customer_payment_provider_inbox i ON i.id=p.inbox_id WHERE i.platform_id=a.platform_id;
 IF r.source_evidence->'refundProjections' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_RECONCILIATION_PROJECTIONS'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'inboxId',p.inbox_id,'conflictId',p.conflict_id,'receiptFingerprint',p.receipt_fingerprint,'fingerprint',p.fingerprint) ORDER BY p.id),'[]'::jsonb) INTO expected FROM customer_payment_dispute_projection p JOIN customer_payment_provider_inbox i ON i.id=p.inbox_id WHERE i.platform_id=a.platform_id;
 IF r.source_evidence->'disputeProjections' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_RECONCILIATION_PROJECTIONS'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'identityFingerprint',o.fingerprint,'state',s.state) ORDER BY o.id),'[]'::jsonb) INTO expected FROM customer_payment_provider_operation o JOIN customer_payment_provider_operation_state s ON s.operation_id=o.id WHERE o.salon_id=a.salon_id AND o.appointment_id=a.appointment_id AND o.quote_id=a.quote_id;
 IF r.source_evidence->'operations' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_RECONCILIATION_OPERATIONS'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'candidateId',candidate_id,'operationId',operation_id,'fingerprint',fingerprint) ORDER BY id),'[]'::jsonb) INTO expected FROM customer_payment_charge_claim WHERE candidate_id=a.candidate_id;
 IF r.ownership_evidence->'parent' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_RECONCILIATION_OWNERSHIP'; END IF;
 IF NOT EXISTS(SELECT 1 FROM customer_payment_charge_claim x WHERE x.candidate_id=a.candidate_id AND x.operation_id=a.operation_id)
 OR EXISTS(SELECT 1 FROM customer_payment_charge_claim x WHERE x.candidate_id=a.candidate_id AND (x.operation_id<>a.operation_id OR x.fingerprint<>(SELECT fingerprint FROM customer_payment_charge_claim WHERE candidate_id=a.candidate_id AND operation_id=a.operation_id ORDER BY id LIMIT 1)))
 OR NOT EXISTS(SELECT 1 FROM customer_payment_capture c JOIN appointment_payment t ON t.id=a.tender_id JOIN customer_payment_prepared_quote q ON q.id=a.quote_id WHERE c.id=a.capture_id AND c.source='offline_fixture_test' AND c.fingerprint=a.capture_fingerprint AND c.amount_cents=a.amount_cents AND c.tender_id=a.tender_id AND t.amount_cents=a.amount_cents AND t.voided_at IS NULL AND q.fingerprint=a.quote_fingerprint)
 OR a.source_revision IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(a.source_evidence),'UTF8')),'hex')
 OR a.ownership_revision IS DISTINCT FROM encode(sha256(convert_to(customer_payment_provider_canonical(a.ownership_evidence),'UTF8')),'hex')
 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_PARENT_OWNERSHIP'; END IF;

 FOR rowdata IN SELECT value FROM jsonb_array_elements(coalesce(r.ownership_evidence->'refund','[]'::jsonb)) LOOP
  IF NOT EXISTS(SELECT 1 FROM customer_payment_movement_claim x WHERE rowdata=jsonb_build_object('id',x.id,'candidateId',x.candidate_id,'operationId',x.operation_id,'fingerprint',x.fingerprint)) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_RECONCILIATION_OWNERSHIP'; END IF;
 END LOOP;
 FOR rowdata IN SELECT value FROM jsonb_array_elements(coalesce(r.ownership_evidence->'dispute','[]'::jsonb)) LOOP
  IF NOT EXISTS(SELECT 1 FROM customer_payment_dispute_claim x WHERE rowdata=jsonb_build_object('id',x.id,'candidateId',x.candidate_id,'operationId',x.operation_id,'fingerprint',x.fingerprint)) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_RECONCILIATION_OWNERSHIP'; END IF;
 END LOOP;
 FOR rowdata IN SELECT value FROM jsonb_array_elements(coalesce(r.ownership_evidence->'balance','[]'::jsonb)) LOOP
  IF NOT EXISTS(SELECT 1 FROM customer_payment_dispute_balance_claim x WHERE rowdata=jsonb_build_object('id',x.id,'candidateId',x.candidate_id,'operationId',x.operation_id,'fingerprint',x.fingerprint)) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_RECONCILIATION_OWNERSHIP'; END IF;
 END LOOP;

 -- Completeness is independently checked against successful signed source movements,
 -- not merely the writer's supplied list of whatever rows it happened to insert.
 IF EXISTS(SELECT 1 FROM customer_payment_refund_projection p JOIN customer_payment_provider_inbox i ON i.id=p.inbox_id
 WHERE i.platform_id=a.platform_id AND ((p.projection->>'chargeId'=a.charge_id AND p.projection->>'paymentIntentId'=a.payment_intent_id) OR (p.projection->>'kind'='application_fee_refund' AND EXISTS(SELECT 1 FROM customer_payment_provider_inbox cap WHERE cap.id=a.success_inbox_id AND cap.receipt#>>'{normalizedFacts,applicationFeeId}'=p.projection->>'applicationFeeId')))
 AND p.projection->>'outcome' IN ('succeeded','fee_return_observed')
 AND NOT EXISTS(SELECT 1 FROM customer_payment_fixture_movement x WHERE x.application_id=a.id AND x.kind=p.projection->>'kind' AND x.movement_id=p.projection->>'movementId' AND x.amount_cents::bigint=(p.projection->>'amountCents')::bigint AND x.currency=p.projection->>'currency'))
 OR EXISTS(SELECT 1 FROM customer_payment_dispute_projection p JOIN customer_payment_provider_inbox i ON i.id=p.inbox_id CROSS JOIN LATERAL jsonb_array_elements(p.projection->'balanceTransactions') bt
 WHERE i.platform_id=a.platform_id AND p.projection->>'chargeId'=a.charge_id AND p.projection->>'paymentIntentId'=a.payment_intent_id
 AND NOT EXISTS(SELECT 1 FROM customer_payment_fixture_movement x WHERE x.application_id=a.id AND x.movement_id=bt->>'id' AND x.dispute_id=p.projection->>'disputeId' AND x.amount_cents::bigint=(bt->>'amountCents')::bigint AND x.fee_cents::bigint=(bt->>'feeCents')::bigint AND x.net_cents::bigint=(bt->>'netCents')::bigint))
 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_RECONCILIATION_INCOMPLETE'; END IF;
 FOR m IN SELECT * FROM customer_payment_fixture_movement WHERE application_id=a.id LOOP
  PERFORM customer_payment_fixture_movement_validate(m.id);
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'candidateId',x.candidate_id,'operationId',x.operation_id,'fingerprint',x.fingerprint) ORDER BY x.id),'[]'::jsonb) INTO expected FROM customer_payment_movement_claim x JOIN customer_payment_movement_candidate c ON c.id=x.candidate_id WHERE c.movement_key->>'platformId'=a.platform_id AND EXISTS(SELECT 1 FROM customer_payment_movement_claim own WHERE own.candidate_id=c.id AND own.facts->>'chargeId'=a.charge_id AND own.facts->>'paymentIntentId'=a.payment_intent_id);
 IF r.ownership_evidence->'refund' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_RECONCILIATION_OWNERSHIP'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'candidateId',x.candidate_id,'operationId',x.operation_id,'fingerprint',x.fingerprint) ORDER BY x.id),'[]'::jsonb) INTO expected FROM customer_payment_dispute_claim x JOIN customer_payment_dispute_candidate c ON c.id=x.candidate_id WHERE c.key->>'platformId'=a.platform_id AND EXISTS(SELECT 1 FROM customer_payment_dispute_claim own WHERE own.candidate_id=c.id AND own.facts->>'chargeId'=a.charge_id AND own.facts->>'paymentIntentId'=a.payment_intent_id);
 IF r.ownership_evidence->'dispute' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_RECONCILIATION_OWNERSHIP'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'candidateId',x.candidate_id,'operationId',x.operation_id,'fingerprint',x.fingerprint) ORDER BY x.id),'[]'::jsonb) INTO expected FROM customer_payment_dispute_balance_claim x JOIN customer_payment_dispute_balance_candidate c ON c.id=x.candidate_id WHERE c.key->>'platformId'=a.platform_id AND EXISTS(SELECT 1 FROM customer_payment_dispute_balance_claim own WHERE own.candidate_id=c.id AND own.facts->>'chargeId'=a.charge_id AND own.facts->>'paymentIntentId'=a.payment_intent_id);
 IF r.ownership_evidence->'balance' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_RECONCILIATION_OWNERSHIP'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'movementKeyHash',movement_key_hash,'fingerprint',fingerprint) ORDER BY movement_key_hash),'[]'::jsonb) INTO expected FROM customer_payment_fixture_movement WHERE application_id=a.id;
 IF r.movement_evidence IS DISTINCT FROM expected THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_RECONCILIATION_MOVEMENT_SET'; END IF;
 IF (SELECT coalesce(sum(amount_cents::bigint),0) FROM customer_payment_fixture_movement WHERE application_id=a.id AND kind='customer_refund')>a.amount_cents
 OR (SELECT coalesce(sum(amount_cents::bigint),0) FROM customer_payment_fixture_movement WHERE application_id=a.id AND kind='application_fee_refund')>a.application_fee_cents THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_CUMULATIVE_LIMIT'; END IF;
 FOR d IN SELECT DISTINCT dispute_id FROM customer_payment_fixture_movement WHERE application_id=a.id AND dispute_id IS NOT NULL LOOP
  SELECT min((p.projection->>'amountCents')::bigint) INTO dispute_limit FROM customer_payment_dispute_projection p JOIN customer_payment_provider_inbox i ON i.id=p.inbox_id WHERE i.platform_id=a.platform_id AND p.projection->>'disputeId'=d;
  IF dispute_limit IS NULL OR dispute_limit<=0 OR dispute_limit>a.amount_cents THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_DISPUTE_LIMIT'; END IF;
  outstanding:=0; prior_at:=NULL; prior_kind:=NULL;
  FOR m IN SELECT * FROM customer_payment_fixture_movement WHERE application_id=a.id AND dispute_id=d ORDER BY occurred_at,movement_key_hash LOOP
   IF prior_at=m.occurred_at AND prior_kind IS DISTINCT FROM m.kind THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_DISPUTE_ORDER'; END IF;
   outstanding:=outstanding-m.amount_cents::bigint;
   IF outstanding<0 OR outstanding>dispute_limit THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_DISPUTE_LIMIT'; END IF;
   prior_at:=m.occurred_at; prior_kind:=m.kind;
  END LOOP;
  IF (SELECT coalesce(sum(-amount_cents::bigint),0) FROM customer_payment_fixture_movement WHERE application_id=a.id AND dispute_id=d AND kind='dispute_withdrawal')>dispute_limit THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_DISPUTE_LIMIT'; END IF;
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION customer_payment_fixture_movement_deferred() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='customer_payment_fixture_movement' THEN
  PERFORM customer_payment_fixture_movement_validate(NEW.id);
  PERFORM customer_payment_fixture_reconciliation_validate(NEW.reconciliation_id);
 ELSE PERFORM customer_payment_fixture_reconciliation_validate(NEW.id);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_payment_fixture_movement_deferred AFTER INSERT ON customer_payment_fixture_movement DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_movement_deferred();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_payment_fixture_reconciliation_deferred AFTER INSERT ON customer_payment_fixture_reconciliation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_payment_fixture_movement_deferred();
