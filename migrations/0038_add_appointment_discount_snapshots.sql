ALTER TABLE "appointment"
  ADD COLUMN IF NOT EXISTS "subtotal_before_discount_cents" integer,
  ADD COLUMN IF NOT EXISTS "discount_amount_cents" integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discount_type" text,
  ADD COLUMN IF NOT EXISTS "discount_label" text,
  ADD COLUMN IF NOT EXISTS "discount_percent" integer,
  ADD COLUMN IF NOT EXISTS "discount_applied_at" timestamp;
