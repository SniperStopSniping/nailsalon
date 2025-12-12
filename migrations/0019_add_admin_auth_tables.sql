-- Admin Auth Tables
-- Adds admin_user, admin_session, admin_invite, admin_salon_membership

-- Admin User - Admin/Super Admin identity (phone-based)
CREATE TABLE IF NOT EXISTS "admin_user" (
  "id" text PRIMARY KEY NOT NULL,
  "phone_e164" text NOT NULL UNIQUE,
  "name" text,
  "is_super_admin" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_user_phone_idx" ON "admin_user" ("phone_e164");

-- Admin Session - Server-side sessions for admin auth
CREATE TABLE IF NOT EXISTS "admin_session" (
  "id" text PRIMARY KEY NOT NULL,
  "admin_id" text NOT NULL REFERENCES "admin_user"("id") ON DELETE CASCADE,
  "expires_at" timestamp NOT NULL,
  "last_seen_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "admin_session_admin_idx" ON "admin_session" ("admin_id");
CREATE INDEX IF NOT EXISTS "admin_session_expires_idx" ON "admin_session" ("expires_at");

-- Admin Invite - Invites for admin access (invite-only system)
CREATE TABLE IF NOT EXISTS "admin_invite" (
  "id" text PRIMARY KEY NOT NULL,
  "phone_e164" text NOT NULL,
  "salon_id" text REFERENCES "salon"("id"),
  "role" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_by" text REFERENCES "admin_user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  -- Constraint: SUPER_ADMIN must have null salonId, ADMIN must have non-null salonId
  CONSTRAINT "admin_invite_role_salon_check" CHECK (
    (role = 'SUPER_ADMIN' AND salon_id IS NULL) OR
    (role = 'ADMIN' AND salon_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "admin_invite_phone_idx" ON "admin_invite" ("phone_e164");
CREATE INDEX IF NOT EXISTS "admin_invite_expires_idx" ON "admin_invite" ("expires_at");
CREATE INDEX IF NOT EXISTS "admin_invite_phone_used_idx" ON "admin_invite" ("phone_e164", "used_at");

-- Admin Salon Membership - Which admins can access which salons
CREATE TABLE IF NOT EXISTS "admin_salon_membership" (
  "admin_id" text NOT NULL REFERENCES "admin_user"("id") ON DELETE CASCADE,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "role" text DEFAULT 'admin' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("admin_id", "salon_id")
);

CREATE INDEX IF NOT EXISTS "admin_membership_salon_idx" ON "admin_salon_membership" ("salon_id");
