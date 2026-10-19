-- Permit a separately approved production operator cap. No budget is created,
-- raised, reset or funded here. Every trial ledger keeps its CAD80 SQL ceiling.
ALTER TABLE setup_ai_budget DROP CONSTRAINT setup_ai_budget_cap_micro_cad_check;
--> statement-breakpoint
ALTER TABLE setup_ai_budget ADD CONSTRAINT setup_ai_budget_cap_micro_cad_check
CHECK (cap_micro_cad > 0 AND (id = 'production-custom-websites-v1' OR cap_micro_cad <= 80000000));
