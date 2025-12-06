CREATE TABLE IF NOT EXISTS "client_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"salon_id" text NOT NULL,
	"normalized_client_phone" text NOT NULL,
	"favorite_tech_id" text,
	"favorite_services" jsonb,
	"nail_shape" text,
	"nail_length" text,
	"finishes" jsonb,
	"color_families" jsonb,
	"preferred_brands" jsonb,
	"sensitivities" jsonb,
	"music_preference" text,
	"conversation_level" text,
	"beverage_preferences" jsonb,
	"tech_notes" text,
	"appointment_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_preferences" ADD CONSTRAINT "client_preferences_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_preferences" ADD CONSTRAINT "client_preferences_favorite_tech_id_technician_id_fk" FOREIGN KEY ("favorite_tech_id") REFERENCES "public"."technician"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_prefs_salon_idx" ON "client_preferences" USING btree ("salon_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_client_salon_prefs" ON "client_preferences" USING btree ("salon_id","normalized_client_phone");