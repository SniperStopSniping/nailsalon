-- Durable customer confirmation only. Existing catalog, billing and messaging schemas are unchanged.
CREATE TABLE IF NOT EXISTS "customer_booking_operation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"salon_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"request_hash" text NOT NULL,
	"contact_binding" text NOT NULL,
	"material" jsonb NOT NULL,
	"appointment_id" text,
	"last_failure" text,
	"review_expires_at" timestamp with time zone NOT NULL,
	"recovery_expires_at" timestamp with time zone NOT NULL,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_booking_operation_revision_positive" CHECK ("customer_booking_operation"."revision" > 0),
	CONSTRAINT "customer_booking_operation_linked_state" CHECK (("customer_booking_operation"."appointment_id" IS NULL) = ("customer_booking_operation"."committed_at" IS NULL)),
	CONSTRAINT "customer_booking_operation_expiry_order" CHECK ("customer_booking_operation"."recovery_expires_at" > "customer_booking_operation"."review_expires_at")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_booking_operation" ADD CONSTRAINT "customer_booking_operation_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_booking_operation_session_unique" ON "customer_booking_operation" USING btree ("salon_id","session_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_booking_operation_appointment_unique" ON "customer_booking_operation" USING btree ("appointment_id");
