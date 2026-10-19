-- Release dependency: reviewed migrations 0098-0112 MUST ship first.
-- No salon FK: this recovery record must survive the salon purge.
CREATE TABLE "salon_deletion_cleanup" (
  "id" text PRIMARY KEY NOT NULL,
  "source_salon_id" text NOT NULL,
  "confirmation_digest" text NOT NULL,
  "rows_deleted" integer DEFAULT 0 NOT NULL,
  "media_total" integer NOT NULL,
  "media_removed" integer DEFAULT 0 NOT NULL,
  "pending_assets" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_token" text,
  "lease_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "salon_deletion_cleanup_counts_valid" CHECK (
    "rows_deleted" >= 0 AND "media_total" >= 0 AND "media_removed" >= 0
    AND "media_removed" <= "media_total" AND "attempts" >= 0
    AND jsonb_typeof("pending_assets") = 'array'
    AND "media_removed" + jsonb_array_length("pending_assets") = "media_total"
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "salon_deletion_cleanup_source_once" ON "salon_deletion_cleanup" ("source_salon_id");
--> statement-breakpoint
CREATE INDEX "salon_deletion_cleanup_due" ON "salon_deletion_cleanup" ("next_attempt_at") WHERE "completed_at" IS NULL;
