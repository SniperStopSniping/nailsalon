-- Setup timestamps represent instants. The previous timezone-less DB defaults
-- made fresh messages appear expired when Postgres used America/Toronto.
-- These unreleased feature tables have DB-generated creation timestamps;
-- interpret historical defaults in the database's original session timezone.
ALTER TABLE business_setup_workspace
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE current_setting('TimeZone'),
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE (CASE WHEN head_revision = 1 THEN current_setting('TimeZone') ELSE 'UTC' END);
--> statement-breakpoint
ALTER TABLE business_setup_revision ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE current_setting('TimeZone');
--> statement-breakpoint
ALTER TABLE business_setup_approval
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE current_setting('TimeZone'),
  ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE business_setup_publication ALTER COLUMN published_at TYPE timestamptz USING published_at AT TIME ZONE current_setting('TimeZone');
--> statement-breakpoint
ALTER TABLE business_setup_turn
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE current_setting('TimeZone'),
  ALTER COLUMN lease_expires_at TYPE timestamptz USING lease_expires_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE custom_site_asset ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE current_setting('TimeZone');
--> statement-breakpoint
ALTER TABLE custom_site_artifact ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE current_setting('TimeZone');
--> statement-breakpoint
ALTER TABLE custom_site_generation ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE current_setting('TimeZone');
--> statement-breakpoint
ALTER TABLE setup_ai_call ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE current_setting('TimeZone');
