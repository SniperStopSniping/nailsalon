-- Synthetic cumulative obligation decisions. No money writes or action-hold clearing.
CREATE FUNCTION customer_payment_credit_evidence(target_salon text,target_appointment text) RETURNS jsonb
LANGUAGE sql VOLATILE AS $$
 SELECT jsonb_build_object(
 'invoice',jsonb_build_object('id',a.id,'salonId',a.salon_id,'status',a.status,'canvasState',a.canvas_state,
 'currency',a.invoice_currency,'finalPriceCents',a.final_price_cents,'tipCents',a.tip_cents,'taxAmountCents',a.tax_amount_cents,
 'amountPaidCents',a.amount_paid_cents,'finalSubtotalCents',a.final_subtotal_cents,'finalDiscountCents',a.final_discount_cents,
 'taxEnabled',a.tax_enabled_snapshot,'taxName',a.tax_name_snapshot,'taxRateBps',a.tax_rate_bps,'taxInclusive',a.tax_inclusive,
 'taxableSubtotalCents',a.taxable_subtotal_cents,'taxExempt',a.tax_exempt,'taxExemptReason',a.tax_exempt_reason,
 'finalTaxSnapshot',a.final_tax_snapshot,'completedAt',a.completed_at),
 'captures',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM customer_payment_capture c WHERE c.appointment_id=a.id),'[]'::jsonb),
 'refunds',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM customer_payment_refund r WHERE r.appointment_id=a.id),'[]'::jsonb),
 'tenders',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM appointment_payment p WHERE p.appointment_id=a.id),'[]'::jsonb),
 'deposits',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM appointment_deposit d WHERE d.appointment_id=a.id),'[]'::jsonb))
 FROM appointment a WHERE a.id=target_appointment AND a.salon_id=target_salon
$$;
--> statement-breakpoint
CREATE FUNCTION customer_payment_credit_revision(evidence jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT encode(sha256(convert_to(evidence::text,'UTF8')),'hex')
$$;
--> statement-breakpoint
CREATE TABLE customer_payment_credit_decision (
 id text PRIMARY KEY, salon_id text NOT NULL, appointment_id text NOT NULL,
 capture_id text NOT NULL REFERENCES customer_payment_capture(id) ON DELETE RESTRICT,
 actor_id text NOT NULL REFERENCES admin_user(id) ON DELETE RESTRICT,
 previous_decision_id text REFERENCES customer_payment_credit_decision(id) ON DELETE RESTRICT, projection_fingerprint text NOT NULL CHECK(projection_fingerprint ~ '^[a-f0-9]{64}$'),
 delta_service_credit_cents integer NOT NULL CHECK(delta_service_credit_cents>=0),
 delta_tax_credit_cents integer NOT NULL CHECK(delta_tax_credit_cents>=0),
 delta_tip_credit_cents integer NOT NULL CHECK(delta_tip_credit_cents>=0),
 request_id text NOT NULL CHECK(customer_payment_nonblank_identity(request_id)), request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 evidence_revision text NOT NULL CHECK(evidence_revision ~ '^[a-f0-9]{64}$'), evidence jsonb NOT NULL,
 service_credit_cents integer NOT NULL CHECK(service_credit_cents>=0),
 tax_credit_cents integer NOT NULL CHECK(tax_credit_cents>=0),
 tip_credit_cents integer NOT NULL CHECK(tip_credit_cents>=0),
 reason text NOT NULL CHECK(length(reason)<=2000 AND length(btrim(reason,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))>0),
 mode text NOT NULL CHECK(mode='test'), source text NOT NULL CHECK(source='synthetic_test'), created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT customer_payment_credit_appointment_fk FOREIGN KEY(salon_id,appointment_id) REFERENCES appointment(salon_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_credit_request_once ON customer_payment_credit_decision(salon_id,request_id);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_credit_evidence_once ON customer_payment_credit_decision(capture_id,evidence_revision);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_credit_chain_once ON customer_payment_credit_decision(previous_decision_id) WHERE previous_decision_id IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION customer_payment_credit_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a appointment; c customer_payment_capture; p appointment_payment; principal bigint; tip bigint; evidence jsonb; prior customer_payment_credit_decision;
BEGIN
 SELECT * INTO a FROM appointment WHERE id=NEW.appointment_id AND salon_id=NEW.salon_id FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_CREDIT_TENANT_MISMATCH'; END IF;
 PERFORM admin_id FROM admin_salon_membership WHERE admin_id=NEW.actor_id AND salon_id=NEW.salon_id AND role='owner' FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_CREDIT_OWNER_REQUIRED'; END IF;
 evidence:=customer_payment_credit_evidence(NEW.salon_id,NEW.appointment_id);
 IF NEW.evidence IS DISTINCT FROM evidence OR NEW.evidence_revision IS DISTINCT FROM customer_payment_credit_revision(evidence) THEN
  RAISE EXCEPTION 'CUSTOMER_PAYMENT_CREDIT_STALE_EVIDENCE'; END IF;
 IF a.deleted_at IS NOT NULL OR a.status IS DISTINCT FROM 'completed' OR a.canvas_state IN ('cancelled','no_show') OR a.completed_at IS NULL
 OR a.invoice_currency IS DISTINCT FROM 'CAD' OR a.final_tax_snapshot IS NULL
 OR jsonb_array_length(evidence->'captures')<>1 OR jsonb_array_length(evidence->'tenders')<>1
 OR jsonb_array_length(evidence->'deposits')<>0 OR jsonb_array_length(evidence->'refunds')=0 THEN
  RAISE EXCEPTION 'CUSTOMER_PAYMENT_CREDIT_INELIGIBLE'; END IF;
 SELECT * INTO c FROM customer_payment_capture WHERE id=NEW.capture_id AND appointment_id=a.id AND salon_id=a.salon_id;
 SELECT * INTO p FROM appointment_payment WHERE appointment_id=a.id;
 IF c.id IS NULL OR c.state<>'posted' OR c.currency<>'cad' OR c.mode<>'test' OR c.source<>'synthetic_test'
 OR p.id IS DISTINCT FROM c.tender_id OR p.salon_id IS DISTINCT FROM c.salon_id OR p.amount_cents IS DISTINCT FROM c.amount_cents
 OR p.id IS DISTINCT FROM 'cpay_'||c.id OR p.reference IS DISTINCT FROM 'customer_payment_capture:'||c.id
 OR p.method IS DISTINCT FROM 'online' OR p.recorded_by_type IS DISTINCT FROM 'system' OR p.voided_at IS NOT NULL
 OR c.captured_at>a.completed_at OR c.recorded_at<c.captured_at OR p.recorded_at IS DISTINCT FROM c.captured_at
 OR a.tip_cents IS DISTINCT FROM c.tip_cents OR a.final_price_cents IS NULL OR a.tax_amount_cents IS NULL
 OR a.final_price_cents::bigint+a.tax_amount_cents IS DISTINCT FROM c.principal_cents::bigint
 OR c.amount_cents::bigint IS DISTINCT FROM c.principal_cents::bigint+c.tip_cents
 OR a.final_tax_snapshot->>'kind' IS DISTINCT FROM 'final_actual'
 OR a.final_tax_snapshot->>'classification' IS DISTINCT FROM 'actual'
 OR a.final_tax_snapshot->>'currency' IS DISTINCT FROM 'CAD'
 OR (a.final_tax_snapshot->>'capturedAt')::timestamptz IS DISTINCT FROM a.completed_at
 OR a.final_tax_snapshot->'invoiceTotalCents' IS DISTINCT FROM to_jsonb(c.principal_cents)
 OR a.final_tax_snapshot->'serviceSubtotalCents' IS DISTINCT FROM to_jsonb(a.final_price_cents)
 OR a.final_tax_snapshot->'taxAmountCents' IS DISTINCT FROM to_jsonb(a.tax_amount_cents) THEN
  RAISE EXCEPTION 'CUSTOMER_PAYMENT_CREDIT_INELIGIBLE'; END IF;
 IF EXISTS(SELECT 1 FROM customer_payment_refund r WHERE r.appointment_id=a.id AND
  (r.capture_id<>c.id OR r.salon_id<>c.salon_id OR r.stripe_account_id<>c.stripe_account_id OR r.payment_intent_id<>c.payment_intent_id
   OR r.currency<>'cad' OR r.mode<>'test' OR r.source<>'synthetic_test' OR r.state<>'applied'
   OR r.amount_cents::bigint<>r.principal_cents::bigint+r.tip_cents)) THEN
  RAISE EXCEPTION 'CUSTOMER_PAYMENT_CREDIT_REVIEW_REQUIRED'; END IF;
 SELECT coalesce(sum(principal_cents),0),coalesce(sum(tip_cents),0) INTO principal,tip FROM customer_payment_refund WHERE appointment_id=a.id;
 IF principal>c.principal_cents OR tip>c.tip_cents OR principal+tip<=0
 OR NEW.service_credit_cents>a.final_price_cents OR NEW.tax_credit_cents>a.tax_amount_cents OR NEW.tip_credit_cents>a.tip_cents
 OR NEW.service_credit_cents::bigint+NEW.tax_credit_cents IS DISTINCT FROM principal OR NEW.tip_credit_cents IS DISTINCT FROM tip
 OR a.amount_paid_cents IS DISTINCT FROM c.amount_cents-principal-tip THEN
  RAISE EXCEPTION 'CUSTOMER_PAYMENT_CREDIT_ALLOCATION_INVALID'; END IF;
 SELECT d.* INTO prior FROM customer_payment_credit_decision d WHERE d.appointment_id=a.id
   AND NOT EXISTS(SELECT 1 FROM customer_payment_credit_decision next WHERE next.previous_decision_id=d.id);
 IF NEW.previous_decision_id IS DISTINCT FROM prior.id
 OR NEW.delta_service_credit_cents IS DISTINCT FROM NEW.service_credit_cents-coalesce(prior.service_credit_cents,0)
 OR NEW.delta_tax_credit_cents IS DISTINCT FROM NEW.tax_credit_cents-coalesce(prior.tax_credit_cents,0)
 OR NEW.delta_tip_credit_cents IS DISTINCT FROM NEW.tip_credit_cents-coalesce(prior.tip_credit_cents,0)
 OR NEW.delta_service_credit_cents::bigint+NEW.delta_tax_credit_cents+NEW.delta_tip_credit_cents<=0 THEN
  RAISE EXCEPTION 'CUSTOMER_PAYMENT_CREDIT_HISTORY_CONFLICT'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_credit_validate BEFORE INSERT ON customer_payment_credit_decision FOR EACH ROW EXECUTE FUNCTION customer_payment_credit_validate();
--> statement-breakpoint
CREATE TRIGGER customer_payment_credit_immutable BEFORE UPDATE OR DELETE ON customer_payment_credit_decision FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
