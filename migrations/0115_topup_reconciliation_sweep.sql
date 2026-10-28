-- Additive prerequisite for the reconciler. No payment/customer state changes.
-- 0114 is used by a concurrent Daniela branch: reconcile journal order against
-- latest main before integration; never replace that branch's migration.
CREATE TABLE billing_topup_reconciliation_sweep (
  scope text PRIMARY KEY NOT NULL,
  cursor_attempt_id text,
  high_water_attempt_id text,
  lease_token text,
  lease_expires_at timestamp with time zone,
  CONSTRAINT billing_topup_reconciliation_sweep_global_scope CHECK (scope = 'global'),
  CONSTRAINT billing_topup_reconciliation_sweep_cursor_bounds CHECK (
    (high_water_attempt_id IS NULL AND cursor_attempt_id IS NULL)
    OR (high_water_attempt_id IS NOT NULL AND (cursor_attempt_id IS NULL
      OR cursor_attempt_id <= high_water_attempt_id))
  ),
  CONSTRAINT billing_topup_reconciliation_sweep_lease_pair CHECK (
    (lease_token IS NULL) = (lease_expires_at IS NULL)
  )
);
