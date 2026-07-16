-- Secure email invitation delivery and claim-in-place onboarding for unowned salons.

ALTER TABLE "salon_signup_invite"
  ADD COLUMN IF NOT EXISTS "intent" text DEFAULT 'create_salon' NOT NULL,
  ADD COLUMN IF NOT EXISTS "salon_id" text REFERENCES "salon"("id") ON DELETE cascade,
  ADD COLUMN IF NOT EXISTS "revoked_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "email_delivery_status" text DEFAULT 'pending' NOT NULL,
  ADD COLUMN IF NOT EXISTS "email_sent_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "email_delivery_error_code" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'salon_signup_invite_intent_check'
  ) THEN
    ALTER TABLE "salon_signup_invite"
      ADD CONSTRAINT "salon_signup_invite_intent_check"
      CHECK ("intent" IN ('create_salon', 'claim_existing'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'salon_signup_invite_delivery_status_check'
  ) THEN
    ALTER TABLE "salon_signup_invite"
      ADD CONSTRAINT "salon_signup_invite_delivery_status_check"
      CHECK ("email_delivery_status" IN ('pending', 'sent', 'failed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'salon_signup_invite_target_check'
  ) THEN
    ALTER TABLE "salon_signup_invite"
      ADD CONSTRAINT "salon_signup_invite_target_check"
      CHECK (
        ("intent" = 'create_salon' AND "salon_id" IS NULL)
        OR ("intent" = 'claim_existing' AND "salon_id" IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "salon_signup_invite_salon_idx"
  ON "salon_signup_invite" ("salon_id");
CREATE UNIQUE INDEX IF NOT EXISTS "salon_signup_invite_active_salon_idx"
  ON "salon_signup_invite" ("salon_id")
  WHERE "salon_id" IS NOT NULL AND "consumed_at" IS NULL AND "revoked_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "salon_signup_invite_active_email_idx"
  ON "salon_signup_invite" ("invited_email")
  WHERE "intent" = 'create_salon' AND "consumed_at" IS NULL AND "revoked_at" IS NULL;
