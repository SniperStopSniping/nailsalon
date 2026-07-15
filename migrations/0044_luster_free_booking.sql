-- Luster Free Booking pilot: invite-only solo tenants, guest appointment access,
-- consent history, and tenant-scoped Google/Twilio integrations.

ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "publication_status" text DEFAULT 'published' NOT NULL;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "published_at" timestamp;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "slug_locked_at" timestamp;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "onboarding_completed_at" timestamp;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "free_solo_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "invitation_source" text;

ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "client_email" text;
ALTER TABLE "admin_user" ADD COLUMN IF NOT EXISTS "clerk_user_id" text;
ALTER TABLE "admin_user" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp;
CREATE UNIQUE INDEX IF NOT EXISTS "admin_user_clerk_user_idx" ON "admin_user" ("clerk_user_id");

CREATE TABLE IF NOT EXISTS "salon_signup_invite" (
  "id" text PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL,
  "invited_email" text NOT NULL,
  "campaign_source" text,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "consumed_by_admin_id" text REFERENCES "admin_user"("id"),
  "created_by_admin_id" text REFERENCES "admin_user"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "salon_signup_invite_token_idx" ON "salon_signup_invite" ("token_hash");
CREATE INDEX IF NOT EXISTS "salon_signup_invite_email_idx" ON "salon_signup_invite" ("invited_email");
CREATE INDEX IF NOT EXISTS "salon_signup_invite_expires_idx" ON "salon_signup_invite" ("expires_at");

CREATE TABLE IF NOT EXISTS "salon_google_calendar_connection" (
  "salon_id" text PRIMARY KEY NOT NULL REFERENCES "salon"("id") ON DELETE cascade,
  "google_account_id" text,
  "google_email" text,
  "encrypted_refresh_token" text NOT NULL,
  "encryption_key_version" integer DEFAULT 1 NOT NULL,
  "destination_calendar_id" text DEFAULT 'primary' NOT NULL,
  "busy_calendar_ids" jsonb DEFAULT '["primary"]'::jsonb NOT NULL,
  "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "token_expires_at" timestamp with time zone,
  "last_error" text,
  "last_checked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "salon_google_calendar_status_idx" ON "salon_google_calendar_connection" ("status");

CREATE TABLE IF NOT EXISTS "salon_twilio_connection" (
  "salon_id" text PRIMARY KEY NOT NULL REFERENCES "salon"("id") ON DELETE cascade,
  "connect_account_sid" text NOT NULL,
  "messaging_service_sid" text,
  "phone_number" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "deauthorized_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "salon_twilio_account_idx" ON "salon_twilio_connection" ("connect_account_sid");
CREATE INDEX IF NOT EXISTS "salon_twilio_status_idx" ON "salon_twilio_connection" ("status");

CREATE TABLE IF NOT EXISTS "communication_consent" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE cascade,
  "recipient" text NOT NULL,
  "channel" text NOT NULL,
  "purpose" text NOT NULL,
  "status" text NOT NULL,
  "wording_version" text NOT NULL,
  "source" text NOT NULL,
  "granted_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "communication_consent_salon_recipient_idx"
  ON "communication_consent" ("salon_id", "recipient", "channel", "purpose");

CREATE TABLE IF NOT EXISTS "appointment_access_token" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE cascade,
  "appointment_id" text NOT NULL REFERENCES "appointment"("id") ON DELETE cascade,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_access_token_hash_idx" ON "appointment_access_token" ("token_hash");
CREATE INDEX IF NOT EXISTS "appointment_access_token_appointment_idx" ON "appointment_access_token" ("salon_id", "appointment_id");
CREATE INDEX IF NOT EXISTS "appointment_access_token_expires_idx" ON "appointment_access_token" ("expires_at");

CREATE TABLE IF NOT EXISTS "integration_outbox" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE cascade,
  "appointment_id" text REFERENCES "appointment"("id") ON DELETE cascade,
  "provider" text NOT NULL,
  "operation" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "integration_outbox_dedupe_idx" ON "integration_outbox" ("dedupe_key");
CREATE INDEX IF NOT EXISTS "integration_outbox_pending_idx" ON "integration_outbox" ("provider", "status", "available_at");
CREATE INDEX IF NOT EXISTS "integration_outbox_salon_idx" ON "integration_outbox" ("salon_id");

CREATE TABLE IF NOT EXISTS "notification_delivery" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE cascade,
  "appointment_id" text REFERENCES "appointment"("id") ON DELETE cascade,
  "channel" text NOT NULL,
  "purpose" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "provider_message_id" text,
  "status" text DEFAULT 'queued' NOT NULL,
  "error_code" text,
  "error_message" text,
  "retryable" boolean,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "notification_delivery_dedupe_idx" ON "notification_delivery" ("dedupe_key");
CREATE INDEX IF NOT EXISTS "notification_delivery_salon_idx" ON "notification_delivery" ("salon_id", "channel", "status");
