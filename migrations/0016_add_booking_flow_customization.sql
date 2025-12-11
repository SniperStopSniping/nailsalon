-- Add booking flow customization columns to salon table
ALTER TABLE "salon"
  ADD COLUMN IF NOT EXISTS "booking_flow_customization_enabled" boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "booking_flow" jsonb;
