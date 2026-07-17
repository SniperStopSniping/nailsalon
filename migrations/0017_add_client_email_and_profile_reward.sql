-- Add email and profile completion reward tracking to client table
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "email" text;
--> statement-breakpoint

ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "profile_completion_reward_granted" boolean DEFAULT false;
