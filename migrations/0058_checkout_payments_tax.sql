ALTER TABLE "appointment"
  ADD COLUMN IF NOT EXISTS "actual_start_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "actual_end_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "tax_enabled_snapshot" boolean,
  ADD COLUMN IF NOT EXISTS "tax_name_snapshot" text,
  ADD COLUMN IF NOT EXISTS "tax_rate_bps" integer,
  ADD COLUMN IF NOT EXISTS "tax_inclusive" boolean,
  ADD COLUMN IF NOT EXISTS "tax_amount_cents" integer,
  ADD COLUMN IF NOT EXISTS "taxable_subtotal_cents" integer,
  ADD COLUMN IF NOT EXISTS "tax_exempt" boolean,
  ADD COLUMN IF NOT EXISTS "tax_exempt_reason" text,
  ADD COLUMN IF NOT EXISTS "final_subtotal_cents" integer,
  ADD COLUMN IF NOT EXISTS "final_discount_cents" integer,
  ADD COLUMN IF NOT EXISTS "final_discount_reason" text,
  ADD COLUMN IF NOT EXISTS "amount_paid_cents" integer;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "appointment_final_item" (
  "id" text PRIMARY KEY NOT NULL,
  "appointment_id" text NOT NULL REFERENCES "appointment"("id") ON DELETE CASCADE,
  "salon_id" text NOT NULL REFERENCES "salon"("id"),
  "kind" text NOT NULL,
  "catalog_service_id" text REFERENCES "service"("id"),
  "catalog_add_on_id" text REFERENCES "add_on"("id"),
  "name" text NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "unit_price_cents" integer NOT NULL,
  "line_total_cents" integer NOT NULL,
  "duration_minutes" integer,
  "taxable" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "appt_final_item_kind_valid" CHECK ("kind" IN ('service','addon','custom')),
  CONSTRAINT "appt_final_item_qty_positive" CHECK ("quantity" > 0),
  CONSTRAINT "appt_final_item_amounts_nonneg" CHECK ("unit_price_cents" >= 0 AND "line_total_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appt_final_item_appointment_idx"
  ON "appointment_final_item" ("appointment_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "appointment_payment" (
  "id" text PRIMARY KEY NOT NULL,
  "appointment_id" text NOT NULL REFERENCES "appointment"("id") ON DELETE CASCADE,
  "salon_id" text NOT NULL REFERENCES "salon"("id"),
  "amount_cents" integer NOT NULL,
  "method" text,
  "reference" text,
  "note" text,
  "recorded_by_type" text NOT NULL,
  "recorded_by_id" text,
  "recorded_by_name" text,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "voided_at" timestamp with time zone,
  "voided_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "appt_payment_amount_positive" CHECK ("amount_cents" > 0),
  CONSTRAINT "appt_payment_method_valid" CHECK ("method" IS NULL OR "method" IN ('cash','debit','credit','e_transfer','online','gift_card','other')),
  CONSTRAINT "appt_payment_recorder_valid" CHECK ("recorded_by_type" IN ('admin','staff','system'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appt_payment_appointment_idx"
  ON "appointment_payment" ("appointment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appt_payment_salon_recorded_idx"
  ON "appointment_payment" ("salon_id", "recorded_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "appointment_payment_link" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "appointment_id" text NOT NULL REFERENCES "appointment"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_payment_link_token_idx"
  ON "appointment_payment_link" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_payment_link_appointment_idx"
  ON "appointment_payment_link" ("salon_id", "appointment_id");
