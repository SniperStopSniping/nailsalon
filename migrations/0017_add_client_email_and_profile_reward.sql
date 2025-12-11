-- Add email and profile completion reward tracking to client table
ALTER TABLE "client" ADD COLUMN "email" text;
ALTER TABLE "client" ADD COLUMN "profile_completion_reward_granted" boolean DEFAULT false;
