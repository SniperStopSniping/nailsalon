CREATE TABLE IF NOT EXISTS "public_booking_attempt" (
	"salon_id" text NOT NULL,
	"attempt_id" uuid NOT NULL,
	"recovery_key_hash" text NOT NULL,
	"request_hash" text,
	"state" text NOT NULL,
	"appointment_id" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_booking_attempt_salon_id_attempt_id_pk" PRIMARY KEY("salon_id","attempt_id"),
	CONSTRAINT "public_booking_attempt_state_valid" CHECK ("public_booking_attempt"."state" IN ('in_flight', 'succeeded', 'failed')),
	CONSTRAINT "public_booking_attempt_recovery_key_hash_valid" CHECK ("public_booking_attempt"."recovery_key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "public_booking_attempt_request_hash_valid" CHECK ("public_booking_attempt"."request_hash" IS NULL OR "public_booking_attempt"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "public_booking_attempt_lifecycle_valid" CHECK (("public_booking_attempt"."state" = 'in_flight' AND "public_booking_attempt"."appointment_id" IS NULL AND "public_booking_attempt"."failure_code" IS NULL) OR ("public_booking_attempt"."state" = 'succeeded' AND "public_booking_attempt"."appointment_id" IS NOT NULL AND "public_booking_attempt"."failure_code" IS NULL) OR ("public_booking_attempt"."state" = 'failed' AND "public_booking_attempt"."appointment_id" IS NULL AND "public_booking_attempt"."failure_code" IS NOT NULL))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public_booking_attempt" ADD CONSTRAINT "public_booking_attempt_salon_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public_booking_attempt" ADD CONSTRAINT "public_booking_attempt_appointment_fk" FOREIGN KEY ("salon_id","appointment_id") REFERENCES "public"."appointment"("salon_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "public_booking_attempt_appointment_unique" ON "public_booking_attempt" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_booking_attempt_state_idx" ON "public_booking_attempt" USING btree ("salon_id","state","updated_at");