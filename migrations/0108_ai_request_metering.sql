-- Frozen owner consent and internal execution identity for each AI request.
-- No transcript, provider credentials or browser-controlled price carrier.
ALTER TABLE ai_credit_reservation
  ADD COLUMN request_kind text CHECK (request_kind IN ('conversation','design','extract')),
  ADD COLUMN expected_revision integer CHECK (expected_revision > 0),
  ADD COLUMN accepted_limit_micro_cad bigint CHECK (accepted_limit_micro_cad > 0 AND accepted_limit_micro_cad <= 100000000),
  ADD COLUMN pricing jsonb,
  ADD COLUMN execution_token text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN resolution text CHECK (resolution IN ('completed','platform_failure','unknown_usage','capped_usage')),
  ADD CONSTRAINT ai_credit_metered_request_shape CHECK (
    request_kind IS NULL OR (expected_revision IS NOT NULL AND accepted_limit_micro_cad >= reserved_micro_cad
      AND pricing IS NOT NULL AND execution_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  );
--> statement-breakpoint
-- Keep expense evidence when a salon/account is deleted, like the existing
-- trial ledger. This historical identifier is not an authorization mechanism.
ALTER TABLE setup_ai_call
  ALTER COLUMN budget_id DROP NOT NULL,
  ADD COLUMN credit_reservation_id text,
  ADD COLUMN credit_reserved_micro_cad bigint NOT NULL DEFAULT 0 CHECK (credit_reserved_micro_cad >= 0),
  ADD COLUMN credit_cost_micro_cad bigint CHECK (credit_cost_micro_cad >= 0),
  ADD CONSTRAINT setup_ai_call_funding CHECK (budget_id IS NOT NULL OR credit_reservation_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX setup_ai_call_credit_request ON setup_ai_call(credit_reservation_id, salon_id);
