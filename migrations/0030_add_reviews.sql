-- Step 21B: Add reviews feature for post-appointment feedback

-- Add reviewsEnabled toggle to salon (default true)
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "reviews_enabled" BOOLEAN DEFAULT true;

-- Create reviews table with proper identity references
CREATE TABLE IF NOT EXISTS "review" (
  "id" TEXT PRIMARY KEY,
  "salon_id" TEXT NOT NULL REFERENCES "salon"("id"),
  "appointment_id" TEXT NOT NULL REFERENCES "appointment"("id"),
  "salon_client_id" TEXT NOT NULL REFERENCES "salon_client"("id"),
  "client_name_snapshot" TEXT,
  "technician_id" TEXT REFERENCES "technician"("id"),
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "is_public" BOOLEAN DEFAULT true,
  "admin_hidden" BOOLEAN DEFAULT false,
  "created_at" TIMESTAMP DEFAULT NOW() NOT NULL,
  "updated_at" TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "review_salon_idx" ON "review"("salon_id");
CREATE UNIQUE INDEX IF NOT EXISTS "review_appointment_idx" ON "review"("appointment_id");
CREATE INDEX IF NOT EXISTS "review_technician_idx" ON "review"("technician_id");
CREATE INDEX IF NOT EXISTS "review_salon_client_idx" ON "review"("salon_client_id");
CREATE INDEX IF NOT EXISTS "review_rating_idx" ON "review"("salon_id", "rating");
