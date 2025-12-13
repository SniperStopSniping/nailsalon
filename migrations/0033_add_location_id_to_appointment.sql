-- Add locationId column to appointment table for multi-location support
-- This migration adds a column to track which salon location an appointment is booked at
ALTER TABLE "appointment" ADD COLUMN "location_id" text;

-- Rename duplicate audit log indexes to prevent conflicts
DROP INDEX IF EXISTS "audit_log_salon_idx";
DROP INDEX IF EXISTS "audit_log_action_idx";
CREATE INDEX IF NOT EXISTS "general_audit_log_salon_idx" ON "audit_log" ("salon_id");
CREATE INDEX IF NOT EXISTS "general_audit_log_action_idx" ON "audit_log" ("action");
CREATE INDEX IF NOT EXISTS "general_audit_log_entity_idx" ON "audit_log" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "general_audit_log_created_at_idx" ON "audit_log" ("created_at");
