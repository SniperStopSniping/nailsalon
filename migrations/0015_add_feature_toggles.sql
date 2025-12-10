-- Feature Toggles V1
-- Add feature toggle fields to salon table for Super Admin control

ALTER TABLE "salon" ADD COLUMN "online_booking_enabled" boolean DEFAULT true;
ALTER TABLE "salon" ADD COLUMN "sms_reminders_enabled" boolean DEFAULT true;
ALTER TABLE "salon" ADD COLUMN "rewards_enabled" boolean DEFAULT true;
ALTER TABLE "salon" ADD COLUMN "profile_page_enabled" boolean DEFAULT true;
