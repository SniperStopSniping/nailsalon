-- Step 16.1: Add features JSONB column to salon table
-- This column stores structured feature entitlements (Super Admin controlled)
-- Supplements existing boolean columns for future extensibility
-- null means "use defaults" (all core features enabled)

ALTER TABLE salon ADD COLUMN IF NOT EXISTS features jsonb;

