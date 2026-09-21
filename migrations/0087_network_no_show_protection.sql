CREATE TABLE IF NOT EXISTS "network_no_show_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"salon_id" text,
	"event_id" text,
	"actor_id" text,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "network_no_show_booking_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"salon_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"subject_id" text,
	"resolver_version" text DEFAULT 'exact_contact_pair_v1' NOT NULL,
	"state" text NOT NULL,
	"booking_channel" text NOT NULL,
	"decision_snapshot" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"invalidated_at" timestamp with time zone,
	CONSTRAINT "network_no_show_booking_binding_state_valid" CHECK ("network_no_show_booking_binding"."state" IN ('eligible', 'unavailable', 'suppressed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "network_no_show_event" (
	"id" text PRIMARY KEY NOT NULL,
	"salon_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"source_revision" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"marked_by" text NOT NULL,
	"marked_by_role" text NOT NULL,
	"marked_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"suppression_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "network_no_show_event_expiry_valid" CHECK ("network_no_show_event"."expires_at" > "network_no_show_event"."occurred_at"),
	CONSTRAINT "network_no_show_event_state_valid" CHECK ("network_no_show_event"."state" IN ('active', 'revoked', 'suppressed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "network_no_show_participation" (
	"salon_id" text PRIMARY KEY NOT NULL,
	"enabled_at" timestamp with time zone NOT NULL,
	"disabled_at" timestamp with time zone,
	"prospective_after" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "network_no_show_subject" (
	"id" text PRIMARY KEY NOT NULL,
	"pair_hmac" text NOT NULL,
	"resolver_version" text DEFAULT 'exact_contact_pair_v1' NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "network_no_show_subject_state_valid" CHECK ("network_no_show_subject"."state" IN ('active', 'unavailable', 'suppressed', 'erased'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_no_show_audit" ADD CONSTRAINT "network_no_show_audit_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_no_show_audit" ADD CONSTRAINT "network_no_show_audit_event_id_network_no_show_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."network_no_show_event"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_no_show_booking_binding" ADD CONSTRAINT "network_no_show_booking_binding_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_no_show_booking_binding" ADD CONSTRAINT "network_no_show_booking_binding_subject_id_network_no_show_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."network_no_show_subject"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_no_show_booking_binding" ADD CONSTRAINT "network_no_show_booking_binding_appointment_fk" FOREIGN KEY ("salon_id","appointment_id") REFERENCES "public"."appointment"("salon_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_no_show_event" ADD CONSTRAINT "network_no_show_event_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_no_show_event" ADD CONSTRAINT "network_no_show_event_subject_id_network_no_show_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."network_no_show_subject"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_no_show_event" ADD CONSTRAINT "network_no_show_event_appointment_fk" FOREIGN KEY ("salon_id","appointment_id") REFERENCES "public"."appointment"("salon_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_no_show_participation" ADD CONSTRAINT "network_no_show_participation_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_no_show_audit_event_history" ON "network_no_show_audit" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_no_show_audit_salon_history" ON "network_no_show_audit" USING btree ("salon_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "network_no_show_booking_binding_appointment_once" ON "network_no_show_booking_binding" USING btree ("salon_id","appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_no_show_booking_binding_subject_active" ON "network_no_show_booking_binding" USING btree ("subject_id","state","invalidated_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "network_no_show_event_source_once" ON "network_no_show_event" USING btree ("salon_id","appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_no_show_event_active_subject_expiry" ON "network_no_show_event" USING btree ("subject_id","expires_at") WHERE "network_no_show_event"."state" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "network_no_show_subject_pair_resolver_once" ON "network_no_show_subject" USING btree ("pair_hmac","resolver_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_no_show_subject_eligible_lookup" ON "network_no_show_subject" USING btree ("pair_hmac","state");
--> statement-breakpoint
-- The derived event must never outlive a changed source appointment. This is a
-- database fence for every status writer, including future writers that do not
-- call the application projection helper. A later no-show write cannot revive
-- this row because the source uniqueness constraint preserves the revocation.
CREATE FUNCTION luster_network_no_show_source_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'no_show'
    OR NEW.deleted_at IS NOT NULL
    OR NEW.client_phone IS DISTINCT FROM OLD.client_phone
    OR NEW.client_email IS DISTINCT FROM OLD.client_email
    OR NEW.start_time IS DISTINCT FROM OLD.start_time
    OR NEW.end_time IS DISTINCT FROM OLD.end_time THEN
    -- Match the application lock order: source appointment -> subject ->
    -- projection rows. This prevents a correction from racing suppression or
    -- erasure after either operation has inspected the subject state.
    PERFORM 1
      FROM network_no_show_subject subject_row
      WHERE subject_row.id IN (
        SELECT subject_id FROM network_no_show_event
          WHERE salon_id = NEW.salon_id AND appointment_id = NEW.id
        UNION
        SELECT subject_id FROM network_no_show_booking_binding
          WHERE salon_id = NEW.salon_id AND appointment_id = NEW.id AND subject_id IS NOT NULL
      )
      FOR UPDATE;
    INSERT INTO network_no_show_audit (id, salon_id, event_id, actor_id, actor_role, action)
      SELECT gen_random_uuid()::text, salon_id, id,
        nullif(current_setting('luster.network_no_show_actor_id', true), ''),
        coalesce(nullif(current_setting('luster.network_no_show_actor_role', true), ''), 'system'),
        'revoked:source_changed'
      FROM network_no_show_event
      WHERE salon_id = NEW.salon_id AND appointment_id = NEW.id AND state = 'active';
    UPDATE network_no_show_event
      SET state = 'revoked', revoked_at = now(), updated_at = now(), source_revision = source_revision + 1
      WHERE salon_id = NEW.salon_id AND appointment_id = NEW.id AND state = 'active';
    IF NEW.deleted_at IS NOT NULL
      OR NEW.client_phone IS DISTINCT FROM OLD.client_phone
      OR NEW.client_email IS DISTINCT FROM OLD.client_email
      OR ((NEW.start_time IS DISTINCT FROM OLD.start_time OR NEW.end_time IS DISTINCT FROM OLD.end_time)
        AND EXISTS (
          SELECT 1 FROM network_no_show_event
          WHERE salon_id = NEW.salon_id AND appointment_id = NEW.id
        )) THEN
      UPDATE network_no_show_booking_binding
        SET state = 'suppressed', invalidated_at = now()
        WHERE salon_id = NEW.salon_id AND appointment_id = NEW.id AND state = 'eligible';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER network_no_show_source_changed AFTER UPDATE OF status, deleted_at, client_phone, client_email, start_time, end_time ON appointment
FOR EACH ROW EXECUTE FUNCTION luster_network_no_show_source_changed();
