ALTER TABLE "service"
  ADD COLUMN IF NOT EXISTS "preparation_buffer_minutes" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "cleanup_buffer_minutes" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint


DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_preparation_buffer_range') THEN
    ALTER TABLE "service"
      ADD CONSTRAINT "service_preparation_buffer_range"
      CHECK ("preparation_buffer_minutes" >= 0 AND "preparation_buffer_minutes" <= 120) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_cleanup_buffer_range') THEN
    ALTER TABLE "service"
      ADD CONSTRAINT "service_cleanup_buffer_range"
      CHECK ("cleanup_buffer_minutes" >= 0 AND "cleanup_buffer_minutes" <= 120) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint


ALTER TABLE "service" VALIDATE CONSTRAINT "service_preparation_buffer_range";
--> statement-breakpoint

ALTER TABLE "service" VALIDATE CONSTRAINT "service_cleanup_buffer_range";
