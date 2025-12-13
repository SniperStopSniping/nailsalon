-- Step 20: Add Stripe billing fields for subscription management
-- billingMode: 'NONE' (cash-only) or 'STRIPE' (subscription billing)

-- Add new Stripe billing columns
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "stripe_price_id" TEXT;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "stripe_current_period_end" BIGINT;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "stripe_customer_email" TEXT;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "billing_mode" TEXT NOT NULL DEFAULT 'NONE';

-- Backfill existing rows to 'NONE' (already handled by DEFAULT, but explicit for clarity)
UPDATE "salon" SET "billing_mode" = 'NONE' WHERE "billing_mode" IS NULL;
