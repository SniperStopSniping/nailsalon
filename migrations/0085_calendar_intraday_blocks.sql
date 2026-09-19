CREATE TABLE IF NOT EXISTS "technician_schedule_guard" (
	"salon_id" text NOT NULL,
	"technician_id" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "technician_schedule_guard_salon_id_technician_id_pk" PRIMARY KEY("salon_id","technician_id")
);
--> statement-breakpoint
ALTER TABLE "technician_blocked_slot" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "technician_blocked_slot" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "technician_schedule_guard" ADD CONSTRAINT "technician_schedule_guard_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "technician_schedule_guard" ADD CONSTRAINT "technician_schedule_guard_salon_technician_fk" FOREIGN KEY ("salon_id","technician_id") REFERENCES "public"."technician"("salon_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blocked_slot_exact_window_idx" ON "technician_blocked_slot" USING btree ("salon_id","technician_id","starts_at","ends_at");--> statement-breakpoint
ALTER TABLE "technician_blocked_slot" ADD CONSTRAINT "blocked_slot_exact_window" CHECK (("technician_blocked_slot"."starts_at" IS NULL AND "technician_blocked_slot"."ends_at" IS NULL) OR ("technician_blocked_slot"."starts_at" IS NOT NULL AND "technician_blocked_slot"."ends_at" IS NOT NULL AND "technician_blocked_slot"."ends_at" > "technician_blocked_slot"."starts_at" AND "technician_blocked_slot"."is_recurring" IS FALSE));