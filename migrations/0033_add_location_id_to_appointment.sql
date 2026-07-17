-- Add locationId column to appointment table for multi-location support
-- This migration adds a column to track which salon location an appointment is booked at
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "location_id" text;
--> statement-breakpoint


-- Rename duplicate audit log indexes to prevent conflicts
DROP INDEX IF EXISTS "audit_log_salon_idx";
--> statement-breakpoint

DROP INDEX IF EXISTS "audit_log_action_idx";
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "general_audit_log_salon_idx" ON "audit_log" ("salon_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "general_audit_log_action_idx" ON "audit_log" ("action");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "general_audit_log_entity_idx" ON "audit_log" ("entity_type", "entity_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "general_audit_log_created_at_idx" ON "audit_log" ("created_at");
