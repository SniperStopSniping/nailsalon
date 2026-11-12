-- Match ECMAScript trim whitespace without rewriting external identifiers.
CREATE FUNCTION customer_payment_nonblank_identity(value text) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT length(value)<=200 AND length(btrim(value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))>0
$$;
--> statement-breakpoint
CREATE TABLE customer_payment_refund (id text PRIMARY KEY, capture_id text NOT NULL REFERENCES customer_payment_capture(id) ON DELETE RESTRICT,
 salon_id text NOT NULL, appointment_id text NOT NULL, stripe_account_id text NOT NULL, payment_intent_id text NOT NULL,
 currency text NOT NULL CHECK(currency='cad'), mode text NOT NULL CHECK(mode='test'), source text NOT NULL CHECK(source='synthetic_test'),
 amount_cents integer NOT NULL CHECK(amount_cents>0), occurred_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), fingerprint text NOT NULL, refund_id text NOT NULL CHECK(customer_payment_nonblank_identity(refund_id)),
 principal_cents integer NOT NULL CHECK(principal_cents>=0), tip_cents integer NOT NULL CHECK(tip_cents>=0),
 state text NOT NULL CHECK(state IN ('applied','held_review')), review_reason text,
 CHECK ((state='applied' AND review_reason IS NULL AND amount_cents::bigint=principal_cents::bigint+tip_cents) OR (state='held_review' AND review_reason IS NOT NULL AND length(review_reason)>0)));
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_refund_once ON customer_payment_refund(stripe_account_id,mode,refund_id);
--> statement-breakpoint
CREATE TABLE customer_payment_fee_binding (id text PRIMARY KEY, capture_id text NOT NULL REFERENCES customer_payment_capture(id) ON DELETE RESTRICT,
 salon_id text NOT NULL, appointment_id text NOT NULL, stripe_account_id text NOT NULL, payment_intent_id text NOT NULL,
 currency text NOT NULL CHECK(currency='cad'), mode text NOT NULL CHECK(mode='test'), source text NOT NULL CHECK(source='synthetic_test'),
 amount_cents integer NOT NULL CHECK(amount_cents>0), occurred_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), fingerprint text NOT NULL, application_fee_id text NOT NULL CHECK(customer_payment_nonblank_identity(application_fee_id)));
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_fee_capture_once ON customer_payment_fee_binding(capture_id);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_fee_identity_once ON customer_payment_fee_binding(stripe_account_id,mode,application_fee_id);
--> statement-breakpoint
CREATE TABLE customer_payment_fee_refund (id text PRIMARY KEY, capture_id text NOT NULL REFERENCES customer_payment_capture(id) ON DELETE RESTRICT,
 salon_id text NOT NULL, appointment_id text NOT NULL, stripe_account_id text NOT NULL, payment_intent_id text NOT NULL,
 currency text NOT NULL CHECK(currency='cad'), mode text NOT NULL CHECK(mode='test'), source text NOT NULL CHECK(source='synthetic_test'),
 amount_cents integer NOT NULL CHECK(amount_cents>0), occurred_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), fingerprint text NOT NULL, application_fee_id text NOT NULL CHECK(customer_payment_nonblank_identity(application_fee_id)), fee_refund_id text NOT NULL CHECK(customer_payment_nonblank_identity(fee_refund_id)),
 binding_id text REFERENCES customer_payment_fee_binding(id) ON DELETE RESTRICT,
 state text NOT NULL CHECK(state IN ('applied','held_review')), review_reason text,
 CHECK ((state='applied' AND review_reason IS NULL AND binding_id IS NOT NULL) OR (state='held_review' AND review_reason IS NOT NULL AND length(review_reason)>0)));
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_fee_refund_once ON customer_payment_fee_refund(stripe_account_id,mode,fee_refund_id);
--> statement-breakpoint
CREATE TABLE customer_payment_refund_event (id text PRIMARY KEY,
 capture_id text NOT NULL REFERENCES customer_payment_capture(id) ON DELETE RESTRICT, stripe_account_id text NOT NULL,
 mode text NOT NULL CHECK(mode='test'), event_id text NOT NULL CHECK(customer_payment_nonblank_identity(event_id)), kind text NOT NULL,
 refund_id text REFERENCES customer_payment_refund(id) ON DELETE RESTRICT,
 binding_id text REFERENCES customer_payment_fee_binding(id) ON DELETE RESTRICT,
 fee_refund_id text REFERENCES customer_payment_fee_refund(id) ON DELETE RESTRICT,
 fingerprint text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='customer_refund' AND refund_id IS NOT NULL AND binding_id IS NULL AND fee_refund_id IS NULL)
 OR (kind='fee_binding' AND refund_id IS NULL AND binding_id IS NOT NULL AND fee_refund_id IS NULL)
 OR (kind='fee_refund' AND refund_id IS NULL AND binding_id IS NULL AND fee_refund_id IS NOT NULL)));
--> statement-breakpoint
CREATE UNIQUE INDEX customer_payment_refund_event_once ON customer_payment_refund_event(stripe_account_id,mode,event_id);
--> statement-breakpoint
CREATE FUNCTION customer_payment_has_refund_hold(target_id text) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM customer_payment_refund WHERE appointment_id=target_id)
$$;
--> statement-breakpoint
CREATE FUNCTION customer_payment_refund_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c customer_payment_capture; principal bigint; tip bigint; refunded bigint; customer_returned bigint; b customer_payment_fee_binding;
BEGIN
 PERFORM id FROM appointment WHERE id=NEW.appointment_id FOR UPDATE;
 SELECT * INTO c FROM customer_payment_capture WHERE id=NEW.capture_id;
 IF c.id IS NULL OR c.state<>'posted' OR c.currency<>'cad' OR c.mode<>'test' OR c.source<>'synthetic_test'
 OR ROW(NEW.salon_id,NEW.appointment_id,NEW.stripe_account_id,NEW.payment_intent_id,NEW.currency,NEW.mode,NEW.source)
 IS DISTINCT FROM ROW(c.salon_id,c.appointment_id,c.stripe_account_id,c.payment_intent_id,c.currency,c.mode,c.source) THEN
 RAISE EXCEPTION 'CUSTOMER_PAYMENT_REFUND_IDENTITY_MISMATCH'; END IF;
 IF TG_TABLE_NAME='customer_payment_refund' THEN
 IF NEW.state='applied' THEN
  SELECT coalesce(sum(principal_cents),0),coalesce(sum(tip_cents),0) INTO principal,tip FROM customer_payment_refund WHERE capture_id=c.id AND state='applied';
  IF NEW.occurred_at<c.captured_at OR NEW.principal_cents::bigint+principal>c.principal_cents OR NEW.tip_cents::bigint+tip>c.tip_cents
   OR EXISTS(SELECT 1 FROM customer_payment_refund WHERE capture_id=c.id AND state='held_review') THEN
   RAISE EXCEPTION 'CUSTOMER_PAYMENT_REFUND_ALLOCATION_INVALID'; END IF;
 END IF;
 ELSIF TG_TABLE_NAME='customer_payment_fee_binding' THEN
  IF NEW.amount_cents<>c.application_fee_cents THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FEE_BINDING_INVALID'; END IF;
 ELSIF TG_TABLE_NAME='customer_payment_fee_refund' THEN
 IF NEW.state='applied' THEN
  SELECT * INTO b FROM customer_payment_fee_binding WHERE id=NEW.binding_id;
  SELECT coalesce(sum(amount_cents),0) INTO refunded FROM customer_payment_fee_refund WHERE capture_id=c.id AND state='applied';
  SELECT coalesce(sum(amount_cents),0) INTO customer_returned FROM customer_payment_refund WHERE capture_id=c.id AND state='applied';
  IF b.id IS NULL OR b.capture_id<>c.id OR b.application_fee_id<>NEW.application_fee_id OR refunded+NEW.amount_cents>b.amount_cents
  OR refunded+NEW.amount_cents>(c.application_fee_cents::bigint*customer_returned/c.amount_cents)
  OR EXISTS(SELECT 1 FROM customer_payment_fee_refund WHERE capture_id=c.id AND state='held_review')
  OR NEW.occurred_at<c.captured_at THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_FEE_REFUND_INVALID'; END IF;
 END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION customer_payment_refund_cache_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE appointment SET amount_paid_cents=(SELECT coalesce(sum(amount_cents),0) FROM appointment_payment WHERE appointment_id=NEW.appointment_id AND voided_at IS NULL)
 -(SELECT coalesce(sum(amount_cents),0) FROM customer_payment_refund WHERE appointment_id=NEW.appointment_id AND state='applied'), updated_at=greatest(updated_at+interval '1 millisecond',clock_timestamp())
 WHERE id=NEW.appointment_id;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION customer_payment_refund_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE movement record;
BEGIN
 IF NEW.kind='customer_refund' THEN SELECT capture_id,stripe_account_id,mode,fingerprint INTO movement FROM customer_payment_refund WHERE id=NEW.refund_id;
 ELSIF NEW.kind='fee_binding' THEN SELECT capture_id,stripe_account_id,mode,fingerprint INTO movement FROM customer_payment_fee_binding WHERE id=NEW.binding_id;
 ELSE SELECT capture_id,stripe_account_id,mode,fingerprint INTO movement FROM customer_payment_fee_refund WHERE id=NEW.fee_refund_id; END IF;
 IF movement.capture_id IS NULL OR ROW(NEW.capture_id,NEW.stripe_account_id,NEW.mode,NEW.fingerprint)
 IS DISTINCT FROM ROW(movement.capture_id,movement.stripe_account_id,movement.mode,movement.fingerprint) THEN
 RAISE EXCEPTION 'CUSTOMER_PAYMENT_REFUND_EVENT_INVALID'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION customer_payment_appointment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_tip bigint; expected_principal bigint; expected_services bigint; expected_tax bigint;
  current_paid bigint; capture_count integer; expected_snapshot jsonb;
BEGIN
  IF NOT customer_payment_has_marker(OLD.id) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED'; END IF;
  IF customer_payment_has_refund_hold(OLD.id) THEN
    SELECT coalesce(sum(amount_cents),0) INTO current_paid FROM appointment_payment WHERE appointment_id=OLD.id AND voided_at IS NULL;
    current_paid := current_paid-(SELECT coalesce(sum(amount_cents),0) FROM customer_payment_refund WHERE appointment_id=OLD.id AND state='applied');
    IF current_paid>=0 AND NEW.amount_paid_cents IS NOT DISTINCT FROM current_paid
      AND (to_jsonb(NEW)-'amount_paid_cents'-'updated_at'-'notes'-'tech_notes'-'client_phone'-'client_name'-'client_email') IS NOT DISTINCT FROM (to_jsonb(OLD)-'amount_paid_cents'-'updated_at'-'notes'-'tech_notes'-'client_phone'-'client_name'-'client_email') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'CUSTOMER_PAYMENT_REFUND_RECONCILIATION_REQUIRED';
  END IF;
  -- Notes/contact-only updates remain possible. Every money/lifecycle mutation
  -- below is checked regardless of application flags or the writer's route.
  IF ROW(NEW.id,NEW.salon_id,NEW.technician_id,NEW.status,NEW.payment_status,
    NEW.canvas_state,NEW.cancel_reason,NEW.start_time,NEW.end_time,NEW.total_price,NEW.total_duration_minutes,
    NEW.base_price_cents,NEW.add_ons_price_cents,NEW.subtotal_before_discount_cents,
    NEW.discount_amount_cents,NEW.discount_type,NEW.discount_label,NEW.discount_percent,NEW.discount_applied_at,
    NEW.final_price_cents,NEW.final_subtotal_cents,NEW.final_discount_cents,NEW.final_discount_reason,
    NEW.tax_enabled_snapshot,NEW.tax_name_snapshot,NEW.tax_rate_bps,NEW.tax_inclusive,
    NEW.taxable_subtotal_cents,NEW.tax_amount_cents,NEW.tax_exempt,NEW.tax_exempt_reason,NEW.invoice_currency,
    NEW.booking_tax_snapshot,NEW.reschedule_tax_snapshot,NEW.final_tax_snapshot,
    NEW.tip_cents,NEW.amount_paid_cents,NEW.deleted_at,NEW.deposit_hold_expires_at,NEW.completed_at)
    IS NOT DISTINCT FROM ROW(OLD.id,OLD.salon_id,OLD.technician_id,OLD.status,OLD.payment_status,
    OLD.canvas_state,OLD.cancel_reason,OLD.start_time,OLD.end_time,OLD.total_price,OLD.total_duration_minutes,
    OLD.base_price_cents,OLD.add_ons_price_cents,OLD.subtotal_before_discount_cents,
    OLD.discount_amount_cents,OLD.discount_type,OLD.discount_label,OLD.discount_percent,OLD.discount_applied_at,
    OLD.final_price_cents,OLD.final_subtotal_cents,OLD.final_discount_cents,OLD.final_discount_reason,
    OLD.tax_enabled_snapshot,OLD.tax_name_snapshot,OLD.tax_rate_bps,OLD.tax_inclusive,
    OLD.taxable_subtotal_cents,OLD.tax_amount_cents,OLD.tax_exempt,OLD.tax_exempt_reason,OLD.invoice_currency,
    OLD.booking_tax_snapshot,OLD.reschedule_tax_snapshot,OLD.final_tax_snapshot,
    OLD.tip_cents,OLD.amount_paid_cents,OLD.deleted_at,OLD.deposit_hold_expires_at,OLD.completed_at) THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM appointment_payment p LEFT JOIN customer_payment_capture c ON c.tender_id=p.id
    WHERE p.appointment_id=OLD.id AND (left(p.id,5)='cpay_' OR left(coalesce(p.reference,''),25)='customer_payment_capture:')
    AND (c.id IS NULL OR c.state<>'posted' OR c.salon_id<>OLD.salon_id OR c.appointment_id<>OLD.id
      OR c.currency<>'cad' OR p.salon_id<>OLD.salon_id OR p.voided_at IS NOT NULL
      OR p.method IS DISTINCT FROM 'online' OR p.recorded_by_type<>'system' OR p.amount_cents<>c.amount_cents
      OR p.reference IS DISTINCT FROM 'customer_payment_capture:'||c.id)) THEN
    RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED';
  END IF;
  SELECT count(*)::integer,coalesce(sum(c.tip_cents),0),coalesce(sum(c.principal_cents),0),
    coalesce(sum((q.snapshot->>'servicesCents')::bigint),0),coalesce(sum((q.snapshot->>'taxCents')::bigint),0)
    INTO capture_count,expected_tip,expected_principal,expected_services,expected_tax
    FROM customer_payment_capture c JOIN customer_payment_prepared_quote q ON q.id=c.quote_id
    WHERE c.appointment_id=OLD.id AND c.salon_id=OLD.salon_id AND c.state='posted';
  SELECT coalesce(nullif(q.context#>'{appointment,rescheduleTaxSnapshot}', 'null'::jsonb),
    q.context#>'{appointment,bookingTaxSnapshot}') INTO expected_snapshot
    FROM customer_payment_capture c JOIN customer_payment_prepared_quote q ON q.id=c.quote_id
    WHERE c.appointment_id=OLD.id AND c.state='posted' LIMIT 1;
  SELECT coalesce(sum(amount_cents) FILTER (WHERE voided_at IS NULL),0) INTO current_paid
    FROM appointment_payment WHERE appointment_id=OLD.id;
  IF capture_count<>1 OR NEW.tip_cents<expected_tip OR NEW.amount_paid_cents IS DISTINCT FROM current_paid
    OR current_paid>expected_principal+NEW.tip_cents OR NEW.invoice_currency IS DISTINCT FROM 'CAD'
    OR EXISTS (SELECT 1 FROM appointment_payment WHERE appointment_id=OLD.id AND salon_id<>OLD.salon_id)
    OR NEW.canvas_state IS NULL OR NEW.canvas_state IN ('cancelled','no_show')
    OR (OLD.canvas_state='complete' AND NEW.canvas_state<>'complete')
    OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason
    OR NEW.status IS NULL OR NEW.status NOT IN ('confirmed','in_progress','completed')
    OR NEW.payment_status IS NULL OR NEW.payment_status NOT IN ('pending','partially_paid','paid')
    OR (OLD.status='completed' AND NEW.status<>'completed')
    OR (OLD.status='in_progress' AND NEW.status='confirmed') THEN
    RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED';
  END IF;
  IF ROW(NEW.id,NEW.salon_id,NEW.technician_id,NEW.start_time,NEW.end_time,NEW.total_price,NEW.total_duration_minutes,
    NEW.base_price_cents,NEW.add_ons_price_cents,NEW.subtotal_before_discount_cents,
    NEW.discount_amount_cents,NEW.discount_type,NEW.discount_label,NEW.discount_percent,NEW.discount_applied_at,
    NEW.booking_tax_snapshot,NEW.reschedule_tax_snapshot,NEW.deleted_at,NEW.deposit_hold_expires_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.salon_id,OLD.technician_id,OLD.start_time,OLD.end_time,OLD.total_price,OLD.total_duration_minutes,
    OLD.base_price_cents,OLD.add_ons_price_cents,OLD.subtotal_before_discount_cents,
    OLD.discount_amount_cents,OLD.discount_type,OLD.discount_label,OLD.discount_percent,OLD.discount_applied_at,
    OLD.booking_tax_snapshot,OLD.reschedule_tax_snapshot,OLD.deleted_at,OLD.deposit_hold_expires_at) THEN
    RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED';
  END IF;
  IF OLD.final_tax_snapshot IS NOT NULL AND ROW(NEW.tax_enabled_snapshot,NEW.tax_name_snapshot,NEW.tax_rate_bps,NEW.tax_inclusive,
    NEW.final_price_cents,NEW.final_subtotal_cents,
    NEW.final_discount_cents,NEW.final_discount_reason,NEW.taxable_subtotal_cents,NEW.tax_amount_cents,
    NEW.tax_exempt,NEW.tax_exempt_reason,NEW.final_tax_snapshot,NEW.tip_cents,NEW.completed_at)
    IS DISTINCT FROM ROW(OLD.tax_enabled_snapshot,OLD.tax_name_snapshot,OLD.tax_rate_bps,OLD.tax_inclusive,
    OLD.final_price_cents,OLD.final_subtotal_cents,
    OLD.final_discount_cents,OLD.final_discount_reason,OLD.taxable_subtotal_cents,OLD.tax_amount_cents,
    OLD.tax_exempt,OLD.tax_exempt_reason,OLD.final_tax_snapshot,OLD.tip_cents,OLD.completed_at) THEN
    RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED';
  END IF;
  IF NEW.status<>'completed' AND ROW(NEW.tax_enabled_snapshot,NEW.tax_name_snapshot,NEW.tax_rate_bps,NEW.tax_inclusive,
    NEW.taxable_subtotal_cents,NEW.tax_amount_cents,NEW.tax_exempt,NEW.tax_exempt_reason)
    IS DISTINCT FROM ROW(OLD.tax_enabled_snapshot,OLD.tax_name_snapshot,OLD.tax_rate_bps,OLD.tax_inclusive,
    OLD.taxable_subtotal_cents,OLD.tax_amount_cents,OLD.tax_exempt,OLD.tax_exempt_reason) THEN
    RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED';
  END IF;
  IF (NEW.final_price_cents IS NOT NULL OR NEW.final_tax_snapshot IS NOT NULL OR NEW.status='completed')
    AND (NEW.status<>'completed' OR NEW.final_tax_snapshot IS NULL
      OR NEW.final_price_cents IS DISTINCT FROM expected_services OR NEW.tax_amount_cents IS DISTINCT FROM expected_tax
      OR NEW.final_tax_snapshot->>'kind' IS DISTINCT FROM 'final_actual'
      OR NEW.final_tax_snapshot->>'classification' IS DISTINCT FROM 'actual'
      OR NEW.final_tax_snapshot->'configuration' IS DISTINCT FROM expected_snapshot->'configuration'
      OR NEW.final_tax_snapshot->'invoiceTotalCents' IS DISTINCT FROM to_jsonb(expected_principal)
      OR NEW.final_tax_snapshot->'taxableSubtotalCents' IS DISTINCT FROM to_jsonb(NEW.taxable_subtotal_cents)
      OR NEW.final_tax_snapshot->'taxExempt' IS DISTINCT FROM to_jsonb(NEW.tax_exempt)
      OR NEW.final_tax_snapshot->'taxExemptReason' IS DISTINCT FROM coalesce(to_jsonb(NEW.tax_exempt_reason),'null'::jsonb)
      OR NEW.tax_enabled_snapshot IS DISTINCT FROM (expected_snapshot#>>'{configuration,enabled}')::boolean
      OR NEW.tax_name_snapshot IS DISTINCT FROM expected_snapshot#>>'{configuration,label}'
      OR NEW.tax_rate_bps IS DISTINCT FROM (expected_snapshot#>>'{configuration,rateBps}')::integer
      OR NEW.tax_inclusive IS DISTINCT FROM ((expected_snapshot#>>'{configuration,mode}')='included')
      OR NEW.final_tax_snapshot->>'currency' IS DISTINCT FROM 'CAD'
      OR NEW.final_tax_snapshot->'schemaVersion' IS DISTINCT FROM '1'::jsonb
      OR NEW.final_tax_snapshot->'serviceSubtotalCents' IS DISTINCT FROM to_jsonb(expected_services)
      OR NEW.final_tax_snapshot->'taxAmountCents' IS DISTINCT FROM to_jsonb(expected_tax)
      OR jsonb_typeof(NEW.final_tax_snapshot->'configuration') IS DISTINCT FROM 'object'
      OR NEW.final_tax_snapshot->>'capturedAt' IS NULL OR NEW.completed_at IS NULL
      OR (NEW.final_tax_snapshot->>'capturedAt')::timestamptz IS DISTINCT FROM NEW.completed_at) THEN
    RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION customer_payment_tender_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE due bigint; paid bigint;
BEGIN
  -- All new tender joins the same canonical lock before its FK/check work.
  PERFORM id FROM appointment WHERE id=NEW.appointment_id FOR KEY SHARE NOWAIT;
  IF customer_payment_has_marker(NEW.appointment_id) THEN
    IF customer_payment_has_refund_hold(NEW.appointment_id) THEN
      -- Retain newly observed late capture cash without issuing booking credit.
      IF NEW.id ~ '^cpay_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND NEW.reference='customer_payment_capture:'||substring(NEW.id FROM 6)
        AND NEW.recorded_by_type='system' AND NEW.method='online' AND NEW.voided_at IS NOT NULL
        AND NEW.voided_by='customer_payment_review'
        AND NEW.salon_id=(SELECT salon_id FROM appointment WHERE id=NEW.appointment_id) THEN RETURN NEW; END IF;
      RAISE EXCEPTION 'CUSTOMER_PAYMENT_REFUND_RECONCILIATION_REQUIRED';
    END IF;
  END IF;
  IF left(NEW.id,5)='cpay_' OR left(coalesce(NEW.reference,''),25)='customer_payment_capture:'
    OR NOT customer_payment_has_marker(NEW.appointment_id) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM appointment_payment p LEFT JOIN customer_payment_capture c ON c.tender_id=p.id
    WHERE p.appointment_id=NEW.appointment_id
      AND (left(p.id,5)='cpay_' OR left(coalesce(p.reference,''),25)='customer_payment_capture:')
      AND (c.id IS NULL OR c.state<>'posted' OR p.voided_at IS NOT NULL OR p.amount_cents<>c.amount_cents)) THEN
    RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED';
  END IF;
  SELECT max(c.principal_cents)+a.tip_cents INTO due FROM appointment a
    JOIN customer_payment_capture c ON c.appointment_id=a.id AND c.salon_id=a.salon_id
    WHERE a.id=NEW.appointment_id AND a.salon_id=NEW.salon_id AND c.state='posted'
    GROUP BY a.tip_cents;
  SELECT coalesce(sum(amount_cents),0) INTO paid FROM appointment_payment
    WHERE appointment_id=NEW.appointment_id AND voided_at IS NULL;
  IF due IS NULL OR NEW.voided_at IS NOT NULL OR paid+NEW.amount_cents>due THEN
    RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION customer_payment_tender_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM appointment WHERE id IN (OLD.appointment_id,
    CASE WHEN TG_OP='UPDATE' THEN NEW.appointment_id ELSE NULL END) ORDER BY id FOR KEY SHARE NOWAIT;
  IF customer_payment_has_marker(OLD.appointment_id) THEN
    IF customer_payment_has_refund_hold(OLD.appointment_id) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_REFUND_RECONCILIATION_REQUIRED'; END IF;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF customer_payment_has_marker(NEW.appointment_id) THEN
      IF customer_payment_has_refund_hold(NEW.appointment_id) THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_REFUND_RECONCILIATION_REQUIRED'; END IF;
    END IF;
  END IF;
  IF left(OLD.id,5)='cpay_' OR left(coalesce(OLD.reference,''),25)='customer_payment_capture:'
    OR (TG_OP='UPDATE' AND (left(NEW.id,5)='cpay_' OR left(coalesce(NEW.reference,''),25)='customer_payment_capture:')) THEN
    RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER customer_payment_refund_validate BEFORE INSERT ON customer_payment_refund FOR EACH ROW EXECUTE FUNCTION customer_payment_refund_insert_guard();
--> statement-breakpoint
CREATE TRIGGER customer_payment_fee_binding_validate BEFORE INSERT ON customer_payment_fee_binding FOR EACH ROW EXECUTE FUNCTION customer_payment_refund_insert_guard();
--> statement-breakpoint
CREATE TRIGGER customer_payment_fee_refund_validate BEFORE INSERT ON customer_payment_fee_refund FOR EACH ROW EXECUTE FUNCTION customer_payment_refund_insert_guard();
--> statement-breakpoint
CREATE TRIGGER customer_payment_refund_immutable BEFORE UPDATE OR DELETE ON customer_payment_refund FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
--> statement-breakpoint
CREATE TRIGGER customer_payment_fee_binding_immutable BEFORE UPDATE OR DELETE ON customer_payment_fee_binding FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
--> statement-breakpoint
CREATE TRIGGER customer_payment_fee_refund_immutable BEFORE UPDATE OR DELETE ON customer_payment_fee_refund FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
--> statement-breakpoint
CREATE TRIGGER customer_payment_refund_event_immutable BEFORE UPDATE OR DELETE ON customer_payment_refund_event FOR EACH ROW EXECUTE FUNCTION customer_payment_preparation_immutable();
--> statement-breakpoint
CREATE TRIGGER customer_payment_refund_project AFTER INSERT ON customer_payment_refund FOR EACH ROW EXECUTE FUNCTION customer_payment_refund_cache_project();
--> statement-breakpoint
CREATE TRIGGER customer_payment_refund_event_validate BEFORE INSERT ON customer_payment_refund_event FOR EACH ROW EXECUTE FUNCTION customer_payment_refund_event_guard();
