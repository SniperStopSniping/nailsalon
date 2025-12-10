-- Super Admin Power Features Migration
-- Adds soft delete fields to salon, audit log table, and locations table

-- =============================================================================
-- 1. Add soft delete fields to salon table
-- =============================================================================
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "deleted_by" text;

-- Index for filtering out deleted salons
CREATE INDEX IF NOT EXISTS "salon_deleted_at_idx" ON "salon"("deleted_at");

-- =============================================================================
-- 2. Create salon_audit_log table for tracking admin actions
-- =============================================================================
CREATE TABLE IF NOT EXISTS "salon_audit_log" (
  "id" text PRIMARY KEY,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "performed_by" text NOT NULL,
  "performed_by_email" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes for audit log queries
CREATE INDEX IF NOT EXISTS "audit_log_salon_idx" ON "salon_audit_log"("salon_id");
CREATE INDEX IF NOT EXISTS "audit_log_action_idx" ON "salon_audit_log"("action");
CREATE INDEX IF NOT EXISTS "audit_log_created_idx" ON "salon_audit_log"("created_at");

-- =============================================================================
-- 3. Create salon_location table for multi-location support
-- =============================================================================
CREATE TABLE IF NOT EXISTS "salon_location" (
  "id" text PRIMARY KEY,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  
  -- Location details
  "name" text NOT NULL,
  "address" text,
  "city" text,
  "state" text,
  "zip_code" text,
  "phone" text,
  "email" text,
  
  -- Operating hours (JSON, same format as salon)
  "business_hours" jsonb,
  
  -- Status
  "is_primary" boolean DEFAULT false,
  "is_active" boolean DEFAULT true,
  
  -- Metadata
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes for location queries
CREATE INDEX IF NOT EXISTS "location_salon_idx" ON "salon_location"("salon_id");
CREATE INDEX IF NOT EXISTS "location_primary_idx" ON "salon_location"("salon_id", "is_primary");

-- =============================================================================
-- 4. Update technician table to reference locations
-- =============================================================================
-- Note: primary_location_id column already exists in schema but may need FK
-- We'll add the FK constraint if the column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'technician' AND column_name = 'primary_location_id'
  ) THEN
    -- Add FK if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'technician_location_fk'
    ) THEN
      ALTER TABLE "technician" 
      ADD CONSTRAINT "technician_location_fk" 
      FOREIGN KEY ("primary_location_id") 
      REFERENCES "salon_location"("id") 
      ON DELETE SET NULL;
    END IF;
  END IF;
END $$;
