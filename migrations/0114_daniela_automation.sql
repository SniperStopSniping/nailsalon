-- Private Isla/Daniela automation. Additive; no activation and no customer backfill.
CREATE TABLE "daniela_automation_state" (
  "salon_id" text PRIMARY KEY REFERENCES "salon"("id") ON DELETE CASCADE,
  "worker_token" text,
  "worker_expires_at" timestamptz,
  "imported_at" timestamptz,
  "last_sheet_read_at" timestamptz
);
--> statement-breakpoint
CREATE TABLE "daniela_contact" (
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "phone" text NOT NULL,
  "blocked" boolean NOT NULL DEFAULT false,
  "provider_opt_out" boolean NOT NULL DEFAULT false,
  "consent_updated_at" timestamptz,
  "campaign_eligible" boolean NOT NULL DEFAULT false,
  "inbound_only" boolean NOT NULL DEFAULT false,
  "row_order" integer NOT NULL DEFAULT 2147483647,
  "last_booking_at" timestamptz,
  "promo_attempted_at" timestamptz,
  "promo_accepted_at" timestamptz,
  "last_inbound_at" timestamptz,
  "last_inbound_sid" text,
  "last_message" text,
  "last_source" text,
  "sheet_dirty" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("salon_id", "phone"),
  CONSTRAINT "daniela_contact_phone_valid" CHECK ("phone" ~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$')
);
--> statement-breakpoint
CREATE TABLE "daniela_inbound" (
  "id" text PRIMARY KEY,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "provider_sid" text NOT NULL,
  "kind" text NOT NULL,
  "phone" text,
  "body" text,
  "outcome" text NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "telegram_state" text NOT NULL DEFAULT 'pending',
  "telegram_attempted_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "daniela_inbound_event_once" ON "daniela_inbound" ("salon_id", "kind", "provider_sid");
--> statement-breakpoint
CREATE INDEX "daniela_inbound_pending" ON "daniela_inbound" ("salon_id", "telegram_state");
--> statement-breakpoint
CREATE TABLE "daniela_send" (
  "id" text PRIMARY KEY,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "phone" text NOT NULL,
  "purpose" text NOT NULL,
  "body" text NOT NULL,
  "slot" text,
  "state" text NOT NULL DEFAULT 'pending',
  "provider_sid" text,
  "error_code" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "attempted_at" timestamptz,
  "accepted_at" timestamptz,
  CONSTRAINT "daniela_send_contact_fk" FOREIGN KEY ("salon_id", "phone") REFERENCES "daniela_contact"("salon_id", "phone") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "daniela_send_slot_once" ON "daniela_send" ("salon_id", "slot");
--> statement-breakpoint
CREATE UNIQUE INDEX "daniela_send_provider_once" ON "daniela_send" ("provider_sid");
--> statement-breakpoint
CREATE INDEX "daniela_send_due" ON "daniela_send" ("salon_id", "state", "created_at");
