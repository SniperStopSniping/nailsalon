-- Feature Toggles V1
-- Add feature toggle fields to salon table for Super Admin control

ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "online_booking_enabled" boolean DEFAULT true;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "sms_reminders_enabled" boolean DEFAULT true;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "rewards_enabled" boolean DEFAULT true;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "profile_page_enabled" boolean DEFAULT true;
