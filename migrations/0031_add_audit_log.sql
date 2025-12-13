-- Step 21D: Add audit log for critical action tracking

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" TEXT PRIMARY KEY,
  "salon_id" TEXT REFERENCES "salon"("id"),
  "actor_type" TEXT NOT NULL,
  "actor_id" TEXT,
  "actor_phone" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "metadata" JSONB,
  "ip" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS "audit_log_salon_idx" ON "audit_log"("salon_id");
CREATE INDEX IF NOT EXISTS "audit_log_action_idx" ON "audit_log"("action");
CREATE INDEX IF NOT EXISTS "audit_log_entity_idx" ON "audit_log"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx" ON "audit_log"("created_at");
