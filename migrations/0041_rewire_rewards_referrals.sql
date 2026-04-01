ALTER TABLE "reward" ADD COLUMN IF NOT EXISTS "discount_type" text;
ALTER TABLE "reward" ADD COLUMN IF NOT EXISTS "discount_amount_cents" integer;
ALTER TABLE "reward" ADD COLUMN IF NOT EXISTS "discount_percent" integer;

DELETE FROM "reward";
DELETE FROM "referral";

UPDATE "salon_client"
SET
  "loyalty_points" = 0,
  "welcome_bonus_granted_at" = NULL,
  "updated_at" = now();

UPDATE "client"
SET
  "profile_completion_reward_granted" = false,
  "updated_at" = now();

UPDATE "salon"
SET
  "profile_completion_points_override" = NULL,
  "referral_referee_points_override" = NULL,
  "referral_referrer_points_override" = NULL,
  "updated_at" = now();
