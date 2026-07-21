-- Salon deletion safety net.
--
-- Background: 45 foreign keys point at "salon", 21 of them restrict-style
-- (NO ACTION). The super-admin hard delete had to clear every one of them by
-- hand, and any table added later silently re-broke the final DELETE FROM salon.
--
-- This migration makes the database itself responsible for salon-scoped
-- children, so a future table with a salon_id foreign key cannot reintroduce
-- the bug. src/libs/salonPurge.ts still performs an explicit ordered purge
-- inside a transaction: it handles the intra-tenant RESTRICT edges that are
-- deliberately NOT changed here, produces the row counts for the impact
-- preview, and keeps the deletion auditable.
--
-- Deliberately NOT changed: fraud_signal.appointment_id,
-- fraud_signal.salon_client_id and appointment.salon_client_id remain RESTRICT.
-- Cascading those would mean "deleting a client destroys their appointments and
-- their fraud evidence", which is a semantic change far beyond salon deletion.

-- ---------------------------------------------------------------------------
-- 0. Schema drift repair
-- ---------------------------------------------------------------------------
-- admin_invite.membership_role exists in production and in src/models/Schema.ts
-- but no migration ever created it, so any database built from migrations/
-- (including the PGlite database used by the test suite) was missing it and
-- the super-admin salon detail query failed against a fresh schema.
ALTER TABLE "admin_invite" ADD COLUMN IF NOT EXISTS "membership_role" text;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. Salon-scoped children: ON DELETE CASCADE
-- ---------------------------------------------------------------------------

ALTER TABLE "admin_invite" DROP CONSTRAINT IF EXISTS "admin_invite_salon_id_fkey";
--> statement-breakpoint
ALTER TABLE "admin_invite" ADD CONSTRAINT "admin_invite_salon_id_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "appointment" DROP CONSTRAINT IF EXISTS "appointment_salon_id_salon_id_fk";
--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_salon_id_salon_id_fk"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "appointment_audit_log" DROP CONSTRAINT IF EXISTS "appointment_audit_log_salon_id_fkey";
--> statement-breakpoint
ALTER TABLE "appointment_audit_log" ADD CONSTRAINT "appointment_audit_log_salon_id_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "appointment_final_item" DROP CONSTRAINT IF EXISTS "appointment_final_item_salon_id_fkey";
--> statement-breakpoint
ALTER TABLE "appointment_final_item" ADD CONSTRAINT "appointment_final_item_salon_id_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "appointment_payment" DROP CONSTRAINT IF EXISTS "appointment_payment_salon_id_fkey";
--> statement-breakpoint
ALTER TABLE "appointment_payment" ADD CONSTRAINT "appointment_payment_salon_id_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "appointment_photo" DROP CONSTRAINT IF EXISTS "appointment_photo_salon_id_salon_id_fk";
--> statement-breakpoint
ALTER TABLE "appointment_photo" ADD CONSTRAINT "appointment_photo_salon_id_salon_id_fk"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "autopost_queue" DROP CONSTRAINT IF EXISTS "autopost_queue_salon_id_salon_id_fk";
--> statement-breakpoint
ALTER TABLE "autopost_queue" ADD CONSTRAINT "autopost_queue_salon_id_salon_id_fk"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "client_preferences" DROP CONSTRAINT IF EXISTS "client_preferences_salon_id_salon_id_fk";
--> statement-breakpoint
ALTER TABLE "client_preferences" ADD CONSTRAINT "client_preferences_salon_id_salon_id_fk"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "fraud_signal" DROP CONSTRAINT IF EXISTS "fraud_signal_salon_id_fkey";
--> statement-breakpoint
ALTER TABLE "fraud_signal" ADD CONSTRAINT "fraud_signal_salon_id_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "referral" DROP CONSTRAINT IF EXISTS "referral_salon_id_salon_id_fk";
--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_salon_id_salon_id_fk"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "review" DROP CONSTRAINT IF EXISTS "review_salon_id_fkey";
--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_salon_id_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "reward" DROP CONSTRAINT IF EXISTS "reward_salon_id_salon_id_fk";
--> statement-breakpoint
ALTER TABLE "reward" ADD CONSTRAINT "reward_salon_id_salon_id_fk"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "salon_client" DROP CONSTRAINT IF EXISTS "salon_client_salon_id_fkey";
--> statement-breakpoint
ALTER TABLE "salon_client" ADD CONSTRAINT "salon_client_salon_id_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "salon_page_appearance" DROP CONSTRAINT IF EXISTS "salon_page_appearance_salon_id_salon_id_fk";
--> statement-breakpoint
ALTER TABLE "salon_page_appearance" ADD CONSTRAINT "salon_page_appearance_salon_id_salon_id_fk"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "service" DROP CONSTRAINT IF EXISTS "service_salon_id_salon_id_fk";
--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_salon_id_salon_id_fk"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "technician" DROP CONSTRAINT IF EXISTS "technician_salon_id_salon_id_fk";
--> statement-breakpoint
ALTER TABLE "technician" ADD CONSTRAINT "technician_salon_id_salon_id_fk"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "technician_blocked_slot" DROP CONSTRAINT IF EXISTS "technician_blocked_slot_salon_id_fkey";
--> statement-breakpoint
ALTER TABLE "technician_blocked_slot" ADD CONSTRAINT "technician_blocked_slot_salon_id_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "technician_schedule_override" DROP CONSTRAINT IF EXISTS "technician_schedule_override_salon_id_fkey";
--> statement-breakpoint
ALTER TABLE "technician_schedule_override" ADD CONSTRAINT "technician_schedule_override_salon_id_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "technician_time_off" DROP CONSTRAINT IF EXISTS "technician_time_off_salon_id_fkey";
--> statement-breakpoint
ALTER TABLE "technician_time_off" ADD CONSTRAINT "technician_time_off_salon_id_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Audit / invite trails: ON DELETE SET NULL
-- ---------------------------------------------------------------------------
-- These columns are nullable and carry no CHECK constraint referencing them, so
-- the row survives the salon and the platform history stays readable. This is
-- what lets the record of a permanent deletion outlive the salon it describes.

ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_salon_id_fkey";
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_salon_id_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salon"("id") ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE "salon_signup_invite" DROP CONSTRAINT IF EXISTS "salon_signup_invite_result_salon_id_salon_id_fk";
--> statement-breakpoint
ALTER TABLE "salon_signup_invite" ADD CONSTRAINT "salon_signup_invite_result_salon_id_salon_id_fk"
  FOREIGN KEY ("result_salon_id") REFERENCES "salon"("id") ON DELETE SET NULL;
