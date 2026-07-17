ALTER TABLE "reward" ADD COLUMN IF NOT EXISTS "discount_type" text;
--> statement-breakpoint

ALTER TABLE "reward" ADD COLUMN IF NOT EXISTS "discount_amount_cents" integer;
--> statement-breakpoint

ALTER TABLE "reward" ADD COLUMN IF NOT EXISTS "discount_percent" integer;
--> statement-breakpoint


DELETE FROM "reward";
--> statement-breakpoint

DELETE FROM "referral";
--> statement-breakpoint


UPDATE "salon_client"
SET
  "loyalty_points" = 0,
  "welcome_bonus_granted_at" = NULL,
  "updated_at" = now();
--> statement-breakpoint


UPDATE "client"
SET
  "profile_completion_reward_granted" = false,
  "updated_at" = now();
--> statement-breakpoint


UPDATE "salon"
SET
  "profile_completion_points_override" = NULL,
  "referral_referee_points_override" = NULL,
  "referral_referrer_points_override" = NULL,
  "updated_at" = now();
