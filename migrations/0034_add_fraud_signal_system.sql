-- =============================================================================
-- Fraud Signal System (v1) Migration
-- =============================================================================
-- Adds fraud detection infrastructure:
-- 1. salon_client_id column to appointment table
-- 2. fraud_signal table with enums for type/severity
-- 3. Partial indexes for optimal query performance
-- =============================================================================

-- =============================================================================
-- 1. Add salonClientId to appointment table
-- =============================================================================

-- Phase 1: Add nullable column (to allow migration without downtime)
ALTER TABLE appointment
ADD COLUMN IF NOT EXISTS salon_client_id TEXT REFERENCES salon_client(id) ON DELETE RESTRICT;

-- Basic composite index for salonClientId lookups
CREATE INDEX IF NOT EXISTS appointment_salon_client_idx
ON appointment (salon_id, salon_client_id);

-- Partial index for fraud queries (ONLY index needed for fraud - most efficient)
-- Covers frequency and velocity checks: completed + paid + completed_at window
CREATE INDEX IF NOT EXISTS appt_fraud_lookup_idx
ON appointment (salon_id, salon_client_id, completed_at)
WHERE status = 'completed' AND payment_status = 'paid';

-- =============================================================================
-- 2. Create fraud signal enums
-- =============================================================================

-- Type enum (PG enum for type safety)
DO $$ BEGIN
  CREATE TYPE fraud_signal_type AS ENUM (
    'HIGH_APPOINTMENT_FREQUENCY',
    'HIGH_REWARD_VELOCITY'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Severity enum
DO $$ BEGIN
  CREATE TYPE fraud_signal_severity AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- 3. Create fraud_signal table
-- =============================================================================

CREATE TABLE IF NOT EXISTS fraud_signal (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL REFERENCES salon(id),
  salon_client_id TEXT NOT NULL REFERENCES salon_client(id) ON DELETE RESTRICT,
  appointment_id TEXT NOT NULL REFERENCES appointment(id) ON DELETE RESTRICT,
  type fraud_signal_type NOT NULL,
  severity fraud_signal_severity NOT NULL DEFAULT 'MEDIUM',
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 4. Create fraud_signal indexes
-- =============================================================================

-- Basic indexes for common lookups
CREATE INDEX IF NOT EXISTS fraud_signal_salon_idx
ON fraud_signal (salon_id);

CREATE INDEX IF NOT EXISTS fraud_signal_client_idx
ON fraud_signal (salon_client_id);

CREATE INDEX IF NOT EXISTS fraud_signal_appointment_idx
ON fraud_signal (appointment_id);

-- UNIQUE constraint: one signal per type per appointment
-- This prevents duplicate signals for the same event
CREATE UNIQUE INDEX IF NOT EXISTS fraud_signal_appt_type_unique
ON fraud_signal (appointment_id, type);

-- Partial index for unresolved signals (most common query)
-- Orders by (created_at DESC, id DESC) for stable pagination
CREATE INDEX IF NOT EXISTS fraud_signal_unresolved_idx
ON fraud_signal (salon_id, created_at DESC, id DESC)
WHERE resolved_at IS NULL;

-- =============================================================================
-- 5. Comments for documentation
-- =============================================================================

COMMENT ON TABLE fraud_signal IS 'Non-blocking fraud detection flags for human review. Created on appointment completion.';
COMMENT ON COLUMN fraud_signal.salon_client_id IS 'Stable client identity - never use phone for joins';
COMMENT ON COLUMN fraud_signal.type IS 'HIGH_APPOINTMENT_FREQUENCY (3+ in 7d or 5+ in 14d) or HIGH_REWARD_VELOCITY (5000+ points in 7d)';
COMMENT ON COLUMN fraud_signal.severity IS 'LOW/MEDIUM/HIGH - determined by thresholds in AppConfig';
COMMENT ON COLUMN fraud_signal.resolved_at IS 'NULL = unresolved. Set when owner marks as reviewed.';
COMMENT ON COLUMN fraud_signal.resolved_by IS 'Admin user ID who resolved the signal (from session)';

-- =============================================================================
-- NOTE: After backfill, run this to make salon_client_id NOT NULL:
-- ALTER TABLE appointment ALTER COLUMN salon_client_id SET NOT NULL;
-- =============================================================================
