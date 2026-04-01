ALTER TABLE "appointment"
  ADD COLUMN IF NOT EXISTS "day_before_reminder_sent_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "day_before_reminder_channel" text,
  ADD COLUMN IF NOT EXISTS "same_day_reminder_sent_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "same_day_reminder_channel" text;
