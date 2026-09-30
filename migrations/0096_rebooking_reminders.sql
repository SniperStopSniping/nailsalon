CREATE TABLE IF NOT EXISTS "rebooking_reminder_service_interval" (
	"salon_id" text NOT NULL,
	"service_id" text NOT NULL,
	"interval_weeks" integer NOT NULL,
	CONSTRAINT "rebooking_reminder_service_interval_salon_id_service_id_pk" PRIMARY KEY("salon_id","service_id"),
	CONSTRAINT "rebooking_reminder_service_interval_valid" CHECK ("rebooking_reminder_service_interval"."interval_weeks" BETWEEN 1 AND 52)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rebooking_reminder_settings" (
	"salon_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"default_interval_weeks" integer DEFAULT 3 NOT NULL,
	"message_template" text NOT NULL,
	"enabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rebooking_reminder_interval_valid" CHECK ("rebooking_reminder_settings"."default_interval_weeks" BETWEEN 1 AND 52),
	CONSTRAINT "rebooking_reminder_message_valid" CHECK (char_length("rebooking_reminder_settings"."message_template") BETWEEN 1 AND 500)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rebooking_reminder_service_interval" ADD CONSTRAINT "rebooking_reminder_service_interval_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "rebooking_reminder_service_interval" ADD CONSTRAINT "rebooking_reminder_service_interval_service_fk" FOREIGN KEY ("salon_id","service_id") REFERENCES "public"."service"("salon_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rebooking_reminder_settings" ADD CONSTRAINT "rebooking_reminder_settings_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
