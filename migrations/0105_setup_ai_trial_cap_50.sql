-- Explicitly approved cumulative testing ceiling. Existing ledger values and
-- spending are preserved; raising an individual budget still requires approval.
ALTER TABLE setup_ai_budget DROP CONSTRAINT setup_ai_budget_cap_micro_cad_check;
--> statement-breakpoint
ALTER TABLE setup_ai_budget ADD CONSTRAINT setup_ai_budget_cap_micro_cad_check
CHECK (cap_micro_cad > 0 AND cap_micro_cad <= 50000000);
