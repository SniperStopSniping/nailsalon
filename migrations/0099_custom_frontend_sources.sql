CREATE TABLE custom_site_asset (
 id text PRIMARY KEY, salon_id text NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
 actor_id text NOT NULL, role text NOT NULL CHECK (role IN ('reference','logo','photo')),
 name text NOT NULL, mime_type text NOT NULL, storage_key text, pdf_base64 text,
 byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 3000000), hash text NOT NULL,
 created_at timestamp NOT NULL DEFAULT now(),
 CHECK ((storage_key IS NULL) <> (pdf_base64 IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX custom_site_asset_tenant_key ON custom_site_asset(salon_id,id);
--> statement-breakpoint
CREATE TABLE custom_site_artifact (
 id text PRIMARY KEY, salon_id text NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
 actor_id text NOT NULL, source jsonb NOT NULL, source_hash text NOT NULL,
 asset_ids jsonb NOT NULL, parent_id text, operation_id text NOT NULL, created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX custom_site_artifact_operation_key ON custom_site_artifact(salon_id,operation_id);
--> statement-breakpoint
CREATE TABLE custom_site_generation (
 id text PRIMARY KEY, salon_id text NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
 actor_id text NOT NULL, request_hash text NOT NULL, expected_revision integer NOT NULL,
 message text NOT NULL, status text NOT NULL CHECK(status IN ('pending','generated','completed','failed')),
 artifact_id text, input_tokens integer, output_tokens integer, cost_micro_usd integer,
 reserved_micro_usd integer NOT NULL, created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX custom_site_generation_salon_idx ON custom_site_generation(salon_id,created_at);
--> statement-breakpoint
-- Source and reference bytes cannot change beneath an approved revision.
CREATE FUNCTION immutable_custom_site_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Custom site records are immutable; create a new version'; END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_custom_site_artifact BEFORE UPDATE ON custom_site_artifact FOR EACH ROW EXECUTE FUNCTION immutable_custom_site_record();
--> statement-breakpoint
--> statement-breakpoint
CREATE TRIGGER immutable_custom_site_asset BEFORE UPDATE ON custom_site_asset FOR EACH ROW EXECUTE FUNCTION immutable_custom_site_record();
--> statement-breakpoint
--> statement-breakpoint
