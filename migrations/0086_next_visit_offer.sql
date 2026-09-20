CREATE TABLE IF NOT EXISTS "next_visit_offer_event" (
	"id" text PRIMARY KEY NOT NULL,
	"salon_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"appointment_id" text,
	"kind" text NOT NULL,
	"amount_cents" integer,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "next_visit_offer" (
	"id" text PRIMARY KEY NOT NULL,
	"salon_id" text NOT NULL,
	"salon_client_id" text NOT NULL,
	"source_appointment_id" text NOT NULL,
	"qualified_at" timestamp with time zone NOT NULL,
	"time_zone" text NOT NULL,
	"deadline_date" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"settings_snapshot" jsonb NOT NULL,
	"reserved_appointment_id" text,
	"state" text DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "next_visit_offer_state_valid" CHECK ("next_visit_offer"."state" IN ('available', 'reserved', 'consumed', 'revoked')),
	CONSTRAINT "next_visit_offer_reservation_valid" CHECK (("next_visit_offer"."state" IN ('available', 'revoked') AND "next_visit_offer"."reserved_appointment_id" IS NULL) OR ("next_visit_offer"."state" IN ('reserved', 'consumed') AND "next_visit_offer"."reserved_appointment_id" IS NOT NULL)),
	CONSTRAINT "next_visit_offer_source_distinct" CHECK ("next_visit_offer"."source_appointment_id" IS DISTINCT FROM "next_visit_offer"."reserved_appointment_id"),
	CONSTRAINT "next_visit_offer_deadline_valid" CHECK ("next_visit_offer"."expires_at" > "next_visit_offer"."qualified_at")
);
--> statement-breakpoint
ALTER TABLE "retention_campaign" ADD COLUMN "next_visit_offer_id" text;--> statement-breakpoint
ALTER TABLE "salon_retention_settings" ADD COLUMN "next_visit_offer" jsonb;--> statement-breakpoint
ALTER TABLE "salon_retention_settings" ADD COLUMN "next_visit_offer_enabled_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "next_visit_offer_salon_id_id" ON "next_visit_offer" USING btree ("salon_id","id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "next_visit_offer_event" ADD CONSTRAINT "next_visit_offer_event_offer_fk" FOREIGN KEY ("salon_id","offer_id") REFERENCES "public"."next_visit_offer"("salon_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "next_visit_offer_event" ADD CONSTRAINT "next_visit_offer_event_appointment_fk" FOREIGN KEY ("salon_id","appointment_id") REFERENCES "public"."appointment"("salon_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "next_visit_offer" ADD CONSTRAINT "next_visit_offer_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "next_visit_offer" ADD CONSTRAINT "next_visit_offer_client_fk" FOREIGN KEY ("salon_id","salon_client_id") REFERENCES "public"."salon_client"("salon_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "next_visit_offer" ADD CONSTRAINT "next_visit_offer_source_fk" FOREIGN KEY ("salon_id","source_appointment_id") REFERENCES "public"."appointment"("salon_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "next_visit_offer" ADD CONSTRAINT "next_visit_offer_reserved_fk" FOREIGN KEY ("salon_id","reserved_appointment_id") REFERENCES "public"."appointment"("salon_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "next_visit_offer_event_history" ON "next_visit_offer_event" USING btree ("salon_id","offer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "next_visit_offer_source_once" ON "next_visit_offer" USING btree ("salon_id","source_appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "next_visit_offer_reserved_once" ON "next_visit_offer" USING btree ("salon_id","reserved_appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "next_visit_offer_client_idx" ON "next_visit_offer" USING btree ("salon_id","salon_client_id","qualified_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "retention_campaign" ADD CONSTRAINT "retention_campaign_next_visit_offer_fk" FOREIGN KEY ("salon_id","next_visit_offer_id") REFERENCES "public"."next_visit_offer"("salon_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "retention_campaign" ADD CONSTRAINT "retention_campaign_next_visit_stage_valid" CHECK (("retention_campaign"."stage" = 'next_visit') = ("retention_campaign"."next_visit_offer_id" IS NOT NULL));--> statement-breakpoint
-- Lifecycle fence only for appointments associated with a Next Visit Offer.
-- All existing status writers (owner, guest, expiry, deposit) share this guard.
-- NOWAIT prevents an appointment-first writer waiting behind a booking's offer lock.
CREATE FUNCTION luster_next_visit_appointment_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE offer_row next_visit_offer%ROWTYPE;
DECLARE event_kind text;
BEGIN
  IF OLD.status IN ('cancelled', 'no_show') AND NEW.status IN ('pending', 'confirmed', 'in_progress', 'awaiting_payment')
    AND EXISTS (SELECT 1 FROM next_visit_offer_event e WHERE e.salon_id = NEW.salon_id AND e.appointment_id = NEW.id AND e.kind = 'reserved')
    AND NOT EXISTS (SELECT 1 FROM next_visit_offer o WHERE o.salon_id = NEW.salon_id AND o.reserved_appointment_id = NEW.id AND o.state = 'reserved') THEN
    RAISE EXCEPTION 'NEXT_VISIT_OFFER_CHANGED: Rebook this cancelled visit to check its offer and current price.' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.completed_at IS DISTINCT FROM OLD.completed_at OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    FOR offer_row IN SELECT * FROM next_visit_offer o
      WHERE o.salon_id = NEW.salon_id AND (o.source_appointment_id = NEW.id OR o.reserved_appointment_id = NEW.id)
      ORDER BY o.id FOR UPDATE NOWAIT
    LOOP
      IF offer_row.source_appointment_id = NEW.id AND
        (NEW.status <> 'completed' OR NEW.completed_at IS DISTINCT FROM offer_row.qualified_at OR NEW.deleted_at IS NOT NULL) THEN
        IF offer_row.state IN ('reserved', 'consumed') THEN
          RAISE EXCEPTION 'NEXT_VISIT_OFFER_CHANGED: Resolve the next visit offer before reopening its qualifying visit.' USING ERRCODE = '23514';
        END IF;
        UPDATE next_visit_offer SET state = 'revoked', reserved_appointment_id = NULL, updated_at = now() WHERE id = offer_row.id;
        INSERT INTO next_visit_offer_event (id,salon_id,offer_id,appointment_id,kind,reason)
          VALUES (gen_random_uuid()::text,NEW.salon_id,offer_row.id,NEW.id,'revoked','qualifying_visit_invalidated');
      ELSIF offer_row.reserved_appointment_id = NEW.id AND offer_row.state = 'reserved' THEN
        event_kind := CASE WHEN NEW.status = 'cancelled' THEN 'released' WHEN NEW.status IN ('completed','no_show') THEN 'consumed' ELSE NULL END;
        IF event_kind IS NOT NULL THEN
          UPDATE next_visit_offer SET state = CASE WHEN event_kind = 'released' THEN 'available' ELSE 'consumed' END,
            reserved_appointment_id = CASE WHEN event_kind = 'released' THEN NULL ELSE NEW.id END, updated_at = now()
            WHERE id = offer_row.id;
          INSERT INTO next_visit_offer_event (id,salon_id,offer_id,appointment_id,kind,reason)
            VALUES (gen_random_uuid()::text,NEW.salon_id,offer_row.id,NEW.id,event_kind,NEW.status::text);
        END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER next_visit_appointment_lifecycle AFTER UPDATE OF status,completed_at,deleted_at ON appointment
FOR EACH ROW EXECUTE FUNCTION luster_next_visit_appointment_lifecycle();

--> statement-breakpoint
ALTER TABLE retention_campaign DROP CONSTRAINT retention_campaign_stage_valid;
--> statement-breakpoint
ALTER TABLE retention_campaign ADD CONSTRAINT retention_campaign_stage_valid CHECK (stage IN ('promo_6w', 'promo_8w', 'next_visit'));
