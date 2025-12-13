-- Step 16: Add settings and visibility JSONB columns to salon table
-- These columns store admin-controlled operational settings and staff visibility policy
-- null means "use defaults" - no data migration needed

ALTER TABLE salon ADD COLUMN IF NOT EXISTS settings jsonb;
ALTER TABLE salon ADD COLUMN IF NOT EXISTS visibility jsonb;

