-- Step 21E: Add per-salon loyalty points override columns
-- Using IF NOT EXISTS for idempotency (safe to re-run)
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "welcome_bonus_points_override" INTEGER;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "profile_completion_points_override" INTEGER;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "referral_referee_points_override" INTEGER;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "referral_referrer_points_override" INTEGER;
