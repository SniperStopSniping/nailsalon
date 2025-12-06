CREATE TABLE IF NOT EXISTS "appointment_photo" (
	"id" text PRIMARY KEY NOT NULL,
	"appointment_id" text NOT NULL,
	"salon_id" text NOT NULL,
	"normalized_client_phone" text NOT NULL,
	"photo_type" text DEFAULT 'after' NOT NULL,
	"cloudinary_public_id" text NOT NULL,
	"image_url" text NOT NULL,
	"thumbnail_url" text,
	"caption" text,
	"is_public" boolean DEFAULT false,
	"uploaded_by_tech_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "started_at" timestamp;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "payment_status" text DEFAULT 'pending';--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_photo" ADD CONSTRAINT "appointment_photo_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_photo" ADD CONSTRAINT "appointment_photo_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_photo" ADD CONSTRAINT "appointment_photo_uploaded_by_tech_id_technician_id_fk" FOREIGN KEY ("uploaded_by_tech_id") REFERENCES "public"."technician"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_appointment_idx" ON "appointment_photo" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_client_phone_idx" ON "appointment_photo" USING btree ("normalized_client_phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_salon_idx" ON "appointment_photo" USING btree ("salon_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_type_idx" ON "appointment_photo" USING btree ("appointment_id","photo_type");