CREATE TABLE IF NOT EXISTS "voice_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_call_id" text NOT NULL,
	"provider_account_sid" text,
	"live_session_id" text,
	"caller_number" text,
	"route_token_hash" text NOT NULL,
	"route_expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"outcome" text,
	"draft" jsonb,
	"summary" text,
	"appointment_id" text,
	"callback_requested" boolean DEFAULT false NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"voice_seconds" integer DEFAULT 0 NOT NULL,
	"metrics" jsonb,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "voice_call_provider_valid" CHECK ("voice_call"."provider" in ('twilio', 'browser')),
	CONSTRAINT "voice_call_summary_length" CHECK (char_length("voice_call"."summary") <= 1000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_number_route" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_sid" text NOT NULL,
	"phone_number" text NOT NULL,
	"forwarded_from" text NOT NULL,
	"salon_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_receptionist_settings" (
	"salon_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"booking_enabled" boolean DEFAULT false NOT NULL,
	"greeting" text,
	"voice" text DEFAULT 'marin' NOT NULL,
	"language" text DEFAULT 'auto' NOT NULL,
	"answer_mode" text DEFAULT 'always' NOT NULL,
	"callback_enabled" boolean DEFAULT true NOT NULL,
	"summary_retention_days" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_receptionist_greeting_length" CHECK (char_length("voice_receptionist_settings"."greeting") <= 300),
	CONSTRAINT "voice_receptionist_voice_valid" CHECK ("voice_receptionist_settings"."voice" in ('marin', 'cedar')),
	CONSTRAINT "voice_receptionist_language_valid" CHECK ("voice_receptionist_settings"."language" in ('auto', 'en', 'es')),
	CONSTRAINT "voice_receptionist_answer_mode_valid" CHECK ("voice_receptionist_settings"."answer_mode" in ('always', 'after_hours')),
	CONSTRAINT "voice_receptionist_retention_fixed" CHECK ("voice_receptionist_settings"."summary_retention_days" = 30)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voice_call" ADD CONSTRAINT "voice_call_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voice_call" ADD CONSTRAINT "voice_call_salon_appointment_fk" FOREIGN KEY ("salon_id","appointment_id") REFERENCES "public"."appointment"("salon_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voice_number_route" ADD CONSTRAINT "voice_number_route_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voice_receptionist_settings" ADD CONSTRAINT "voice_receptionist_settings_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voice_call_provider_call_unique" ON "voice_call" USING btree ("provider","provider_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voice_call_live_session_unique" ON "voice_call" USING btree ("live_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voice_call_route_token_unique" ON "voice_call" USING btree ("route_token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_call_salon_created_idx" ON "voice_call" USING btree ("salon_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voice_number_route_account_phone_unique" ON "voice_number_route" USING btree ("account_sid","phone_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_number_route_salon_idx" ON "voice_number_route" USING btree ("salon_id");