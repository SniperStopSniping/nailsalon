-- Backstop for indirect legacy writers while synthetic captured money exists.
-- Untagged legacy appointments/deposits follow their existing rules unchanged.
CREATE FUNCTION customer_payment_has_marker(target_id text) RETURNS boolean
LANGUAGE sql VOLATILE AS $$
  SELECT EXISTS (SELECT 1 FROM appointment_payment p WHERE p.appointment_id=target_id
    AND (left(p.id,5)='cpay_' OR left(coalesce(p.reference,''),25)='customer_payment_capture:'))
$$;
--> statement-breakpoint
CREATE FUNCTION customer_payment_tender_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF left(OLD.id,5)='cpay_' OR left(coalesce(OLD.reference,''),25)='customer_payment_capture:'
    OR (TG_OP='UPDATE' AND (left(NEW.id,5)='cpay_' OR left(coalesce(NEW.reference,''),25)='customer_payment_capture:')) THEN
    RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_tender_immutable BEFORE UPDATE OR DELETE ON appointment_payment
FOR EACH ROW EXECUTE FUNCTION customer_payment_tender_immutable_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_appointment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_tip bigint; expected_principal bigint; expected_services bigint; expected_tax bigint;
  current_paid bigint; capture_count integer; expected_snapshot jsonb;
BEGIN
  IF NOT customer_payment_has_marker(OLD.id) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED'; END IF;
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
CREATE TRIGGER customer_payment_appointment_mutations BEFORE UPDATE OR DELETE ON appointment
FOR EACH ROW EXECUTE FUNCTION customer_payment_appointment_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Serialize even uncoordinated item writers with capture's appointment lock.
  -- Sorted locking also covers a row moved between appointments.
  PERFORM id FROM appointment WHERE id IN (
    CASE WHEN TG_OP<>'INSERT' THEN OLD.appointment_id ELSE NULL END,
    CASE WHEN TG_OP<>'DELETE' THEN NEW.appointment_id ELSE NULL END)
    ORDER BY id FOR KEY SHARE NOWAIT;
  IF (TG_OP<>'INSERT' AND customer_payment_has_marker(OLD.appointment_id))
    OR (TG_OP<>'DELETE' AND customer_payment_has_marker(NEW.appointment_id)) THEN
    RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_service_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_services
FOR EACH ROW EXECUTE FUNCTION customer_payment_item_guard();
--> statement-breakpoint
CREATE TRIGGER customer_payment_addon_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON appointment_add_on
FOR EACH ROW EXECUTE FUNCTION customer_payment_item_guard();
--> statement-breakpoint
CREATE FUNCTION customer_payment_new_deposit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Existing deposit receipt/refund processing is never intercepted here.
  PERFORM id FROM appointment WHERE id=NEW.appointment_id FOR KEY SHARE NOWAIT;
  IF NOT customer_payment_has_marker(NEW.appointment_id) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM customer_payment_capture WHERE appointment_id=NEW.appointment_id AND state='posted') THEN
    RAISE EXCEPTION 'CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER customer_payment_deposit_insert_guard BEFORE INSERT ON appointment_deposit
FOR EACH ROW EXECUTE FUNCTION customer_payment_new_deposit_guard();

--> statement-breakpoint
CREATE FUNCTION customer_payment_tender_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE due bigint; paid bigint;
BEGIN
  -- All new tender joins the same canonical lock before its FK/check work.
  PERFORM id FROM appointment WHERE id=NEW.appointment_id FOR KEY SHARE NOWAIT;
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
CREATE TRIGGER customer_payment_tender_insert_lock BEFORE INSERT ON appointment_payment
FOR EACH ROW EXECUTE FUNCTION customer_payment_tender_insert_guard();
