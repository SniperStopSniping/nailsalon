CREATE TABLE IF NOT EXISTS "salon_retention_settings" (
  "salon_id" text PRIMARY KEY NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "default_rebook_days" integer DEFAULT 21 NOT NULL,
  "reminder_lead_hours" integer DEFAULT 24 NOT NULL,
  "google_review_url" text,
  "parking_instructions" text,
  "six_week_promotion" jsonb DEFAULT '{"enabled":false,"name":"We miss you","discountType":"percent","value":0,"eligibleServiceIds":[],"expiryDays":14,"code":null,"messageTemplate":"Hi {firstName}, we miss you at {salonName}! Enjoy {offer} when you book by {expiry}: {bookingLink}","singleUse":true}'::jsonb NOT NULL,
  "eight_week_promotion" jsonb DEFAULT '{"enabled":false,"name":"Come back soon","discountType":"percent","value":0,"eligibleServiceIds":[],"expiryDays":14,"code":null,"messageTemplate":"Hi {firstName}, we would love to see you again at {salonName}. Enjoy {offer} when you book by {expiry}: {bookingLink}","singleUse":true}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "salon_retention_default_rebook_days_range" CHECK ("default_rebook_days" BETWEEN 1 AND 365),
  CONSTRAINT "salon_retention_reminder_lead_hours_range" CHECK ("reminder_lead_hours" BETWEEN 1 AND 168)
);
--> statement-breakpoint

-- Preserve review links configured before the retention assistant existed.
INSERT INTO "salon_retention_settings" ("salon_id", "google_review_url")
SELECT
  "id",
  CASE
    WHEN "settings"->>'googleReviewUrl' ~* '^https://' THEN NULLIF("settings"->>'googleReviewUrl', '')
    ELSE NULL
  END
FROM "salon"
ON CONFLICT ("salon_id") DO NOTHING;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "client_communication" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "salon_client_id" text NOT NULL REFERENCES "salon_client"("id") ON DELETE CASCADE,
  "appointment_id" text REFERENCES "appointment"("id") ON DELETE SET NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'prepared' NOT NULL,
  "due_at" timestamp with time zone,
  "snoozed_until" timestamp with time zone,
  "message_snapshot" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "prepared_at" timestamp with time zone,
  "marked_sent_at" timestamp with time zone,
  "dismissed_at" timestamp with time zone,
  "converted_at" timestamp with time zone,
  "actor_admin_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_communication_kind_valid" CHECK ("kind" IN ('generic_text', 'rebook', 'reminder', 'appointment_details', 'directions', 'satisfaction', 'google_review', 'promo_6w', 'promo_8w')),
  CONSTRAINT "client_communication_status_valid" CHECK ("status" IN ('prepared', 'marked_sent', 'not_sent', 'snoozed', 'dismissed', 'converted')),
  CONSTRAINT "client_communication_snooze_valid" CHECK ("status" <> 'snoozed' OR "snoozed_until" IS NOT NULL)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "client_communication_salon_client_created_idx"
  ON "client_communication" ("salon_id", "salon_client_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_communication_appointment_idx"
  ON "client_communication" ("salon_id", "appointment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_communication_queue_idx"
  ON "client_communication" ("salon_id", "kind", "status", "snoozed_until");
--> statement-breakpoint

-- At most one prepared/snoozed retention stage may be active for a client.
-- Other communication kinds (including appointment reminders) remain independent.
CREATE UNIQUE INDEX IF NOT EXISTS "client_communication_active_retention_unique"
  ON "client_communication" ("salon_id", "salon_client_id")
  WHERE "kind" IN ('rebook', 'promo_6w', 'promo_8w')
    AND "status" IN ('prepared', 'snoozed');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "retention_campaign" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "salon_client_id" text NOT NULL REFERENCES "salon_client"("id") ON DELETE CASCADE,
  "communication_id" text REFERENCES "client_communication"("id") ON DELETE SET NULL,
  "token_hash" text NOT NULL,
  "stage" text NOT NULL,
  "promotion_snapshot" jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "single_use" boolean DEFAULT true NOT NULL,
  "redeemed_at" timestamp with time zone,
  "redeemed_appointment_id" text REFERENCES "appointment"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "retention_campaign_stage_valid" CHECK ("stage" IN ('promo_6w', 'promo_8w'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "retention_campaign_token_hash_idx"
  ON "retention_campaign" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_campaign_salon_client_idx"
  ON "retention_campaign" ("salon_id", "salon_client_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_campaign_redeemed_appointment_idx"
  ON "retention_campaign" ("redeemed_appointment_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "retention_campaign_redemption" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "campaign_id" text NOT NULL REFERENCES "retention_campaign"("id") ON DELETE CASCADE,
  "appointment_id" text NOT NULL REFERENCES "appointment"("id") ON DELETE CASCADE,
  "discount_amount_cents" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "retention_campaign_redemption_campaign_idx"
  ON "retention_campaign_redemption" ("campaign_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "retention_campaign_redemption_appointment_idx"
  ON "retention_campaign_redemption" ("appointment_id");
