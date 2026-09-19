ALTER TABLE "review_request" ALTER COLUMN "completed_at" DROP NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "review_request"
    WHERE "status" <> 'cancelled' AND "appointment_id" IS NOT NULL
    GROUP BY "salon_id", "appointment_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'review_request active appointment duplicates block 0082; resolve history before applying';
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "review_request_appointment_active_once" ON "review_request" USING btree ("salon_id","appointment_id") WHERE "review_request"."status" <> 'cancelled' and "review_request"."appointment_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_request_salon_client_created_idx" ON "review_request" USING btree ("salon_id","client_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_request_salon_recipient_created_idx" ON "review_request" USING btree ("salon_id","recipient","created_at");--> statement-breakpoint
ALTER TABLE "review_request" ADD CONSTRAINT "review_request_completed_or_triggered" CHECK ("review_request"."completed_at" is not null or "review_request"."trigger_id" is not null);
