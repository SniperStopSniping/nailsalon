ALTER TABLE "appointment_add_on" ADD COLUMN "appointment_service_id" text;--> statement-breakpoint
ALTER TABLE "appointment_add_on" ADD COLUMN "price_display_text_snapshot" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_services_appointment_id_id_unique" ON "appointment_services" USING btree ("appointment_id","id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_add_on" ADD CONSTRAINT "appointment_add_on_appointment_service_fk" FOREIGN KEY ("appointment_id","appointment_service_id") REFERENCES "public"."appointment_services"("appointment_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_add_on_appointment_service_idx" ON "appointment_add_on" USING btree ("appointment_service_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_add_on_service_add_on_unique_idx" ON "appointment_add_on" USING btree ("appointment_service_id","add_on_id") WHERE "appointment_add_on"."appointment_service_id" is not null;
