-- Migration 0027: Add Time Off Requests and Notifications tables
-- Part of Step 17: Staff Phase 2 Features

-- =============================================================================
-- TIME OFF REQUEST TABLE
-- Staff submit requests, admin approves/denies
-- =============================================================================

CREATE TABLE IF NOT EXISTS time_off_request (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
  technician_id TEXT NOT NULL REFERENCES technician(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | DENIED
  decided_by_admin_id TEXT REFERENCES admin_user(id),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for time_off_request
CREATE INDEX IF NOT EXISTS time_off_request_salon_idx ON time_off_request(salon_id);
CREATE INDEX IF NOT EXISTS time_off_request_tech_idx ON time_off_request(technician_id);
CREATE INDEX IF NOT EXISTS time_off_request_status_idx ON time_off_request(salon_id, status);
CREATE INDEX IF NOT EXISTS time_off_request_tech_status_idx ON time_off_request(technician_id, status);

-- =============================================================================
-- NOTIFICATION TABLE
-- In-app notifications for staff (time off decisions, etc.)
-- =============================================================================

CREATE TABLE IF NOT EXISTS notification (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
  recipient_role TEXT NOT NULL,  -- 'STAFF' | 'ADMIN'
  recipient_technician_id TEXT REFERENCES technician(id) ON DELETE CASCADE,
  type TEXT NOT NULL,  -- 'TIME_OFF_DECISION', 'OVERRIDE_DECISION', etc.
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for notification
CREATE INDEX IF NOT EXISTS notification_salon_idx ON notification(salon_id);
CREATE INDEX IF NOT EXISTS notification_recipient_tech_idx ON notification(recipient_technician_id);
CREATE INDEX IF NOT EXISTS notification_unread_idx ON notification(recipient_technician_id, read_at) 
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notification_created_idx ON notification(recipient_technician_id, created_at DESC);
