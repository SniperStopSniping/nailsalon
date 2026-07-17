-- =============================================================================
-- STEP 16A: Core Salon Operations - Operational Safety Layer
-- =============================================================================
-- This migration adds mandatory operational safety features required for every
-- real salon to function without chaos, disputes, or data corruption.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Appointment Locking (prevents edits once service starts)
-- -----------------------------------------------------------------------------
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP;
--> statement-breakpoint

ALTER TABLE appointment ADD COLUMN IF NOT EXISTS locked_by TEXT;
--> statement-breakpoint


-- -----------------------------------------------------------------------------
-- 2. Arrival Tracking (grace window handling)
-- -----------------------------------------------------------------------------
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMP;
--> statement-breakpoint

ALTER TABLE appointment ADD COLUMN IF NOT EXISTS was_late BOOLEAN DEFAULT false;
--> statement-breakpoint


-- -----------------------------------------------------------------------------
-- 3. Staff Private Notes (only visible to assigned tech)
-- -----------------------------------------------------------------------------
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS tech_notes TEXT;
--> statement-breakpoint


-- -----------------------------------------------------------------------------
-- 4. Salon Grace Window Setting
-- -----------------------------------------------------------------------------
ALTER TABLE salon ADD COLUMN IF NOT EXISTS grace_window_minutes INTEGER DEFAULT 10;
--> statement-breakpoint


-- -----------------------------------------------------------------------------
-- 5. Client Accountability (late cancellation tracking)
-- -----------------------------------------------------------------------------
ALTER TABLE salon_client ADD COLUMN IF NOT EXISTS late_cancel_count INTEGER DEFAULT 0;
--> statement-breakpoint

ALTER TABLE salon_client ADD COLUMN IF NOT EXISTS last_late_cancel_at TIMESTAMP;
--> statement-breakpoint


-- -----------------------------------------------------------------------------
-- 6. Admin-Only Client Flags (problem client management)
-- -----------------------------------------------------------------------------
ALTER TABLE salon_client ADD COLUMN IF NOT EXISTS admin_flags JSONB;
--> statement-breakpoint

ALTER TABLE salon_client ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false;
--> statement-breakpoint

ALTER TABLE salon_client ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
--> statement-breakpoint


-- -----------------------------------------------------------------------------
-- 7. Appointment Audit Log (immutable change tracking)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointment_audit_log (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointment(id) ON DELETE CASCADE,
  salon_id TEXT NOT NULL REFERENCES salon(id),
  
  -- Action performed
  action TEXT NOT NULL,
  
  -- Who performed the action
  performed_by TEXT NOT NULL,
  performed_by_role TEXT NOT NULL,
  performed_by_name TEXT,
  
  -- Change details
  previous_value JSONB,
  new_value JSONB,
  reason TEXT,
  
  -- Timestamp (immutable)
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
--> statement-breakpoint


-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS appt_audit_appointment_idx ON appointment_audit_log(appointment_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS appt_audit_salon_idx ON appointment_audit_log(salon_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS appt_audit_action_idx ON appointment_audit_log(action);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS appt_audit_created_idx ON appointment_audit_log(created_at);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS appt_audit_performer_idx ON appointment_audit_log(performed_by);
--> statement-breakpoint


-- -----------------------------------------------------------------------------
-- 8. Additional indexes for new fields
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS appointment_locked_at_idx ON appointment(locked_at) WHERE locked_at IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS salon_client_blocked_idx ON salon_client(salon_id, is_blocked) WHERE is_blocked = true;
