CREATE TABLE IF NOT EXISTS "appointment" (
	"id" text PRIMARY KEY NOT NULL,
	"salon_id" text NOT NULL,
	"technician_id" text,
	"client_phone" text NOT NULL,
	"client_name" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"total_price" integer NOT NULL,
	"total_duration_minutes" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "appointment_services" (
	"id" text PRIMARY KEY NOT NULL,
	"appointment_id" text NOT NULL,
	"service_id" text NOT NULL,
	"price_at_booking" integer NOT NULL,
	"duration_at_booking" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"custom_domain" text,
	"theme_key" text DEFAULT 'nail-salon-no5',
	"logo_url" text,
	"cover_image_url" text,
	"phone" text,
	"email" text,
	"address" text,
	"city" text,
	"state" text,
	"zip_code" text,
	"social_links" jsonb,
	"business_hours" jsonb,
	"policies" jsonb,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_subscription_status" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "salon_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service" (
	"id" text PRIMARY KEY NOT NULL,
	"salon_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"category" text NOT NULL,
	"image_url" text,
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "technician" (
	"id" text PRIMARY KEY NOT NULL,
	"salon_id" text NOT NULL,
	"name" text NOT NULL,
	"bio" text,
	"avatar_url" text,
	"specialties" jsonb,
	"rating" numeric(2, 1),
	"review_count" integer DEFAULT 0,
	"work_days" jsonb,
	"start_time" text,
	"end_time" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "technician_services" (
	"technician_id" text NOT NULL,
	"service_id" text NOT NULL,
	CONSTRAINT "technician_services_technician_id_service_id_pk" PRIMARY KEY("technician_id","service_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment" ADD CONSTRAINT "appointment_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment" ADD CONSTRAINT "appointment_technician_id_technician_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."technician"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service" ADD CONSTRAINT "service_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "technician" ADD CONSTRAINT "technician_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "technician_services" ADD CONSTRAINT "technician_services_technician_id_technician_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."technician"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "technician_services" ADD CONSTRAINT "technician_services_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_salon_idx" ON "appointment" USING btree ("salon_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_client_idx" ON "appointment" USING btree ("client_phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_date_idx" ON "appointment" USING btree ("salon_id","start_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_status_idx" ON "appointment" USING btree ("salon_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appt_services_appointment_idx" ON "appointment_services" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appt_services_service_idx" ON "appointment_services" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_appt_service" ON "appointment_services" USING btree ("appointment_id","service_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_slug_idx" ON "salon" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_custom_domain_idx" ON "salon" USING btree ("custom_domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_salon_idx" ON "service" USING btree ("salon_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_category_idx" ON "service" USING btree ("salon_id","category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technician_salon_idx" ON "technician" USING btree ("salon_id");