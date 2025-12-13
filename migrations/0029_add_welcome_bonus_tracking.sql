-- Step 21A: Add welcome bonus tracking to salon_client
-- This tracks when the one-time 25,000 point welcome bonus was granted

ALTER TABLE "salon_client" ADD COLUMN IF NOT EXISTS "welcome_bonus_granted_at" TIMESTAMP;
