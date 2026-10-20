-- Stable draft-to-catalogue identities keep publication retry and restoration safe.
ALTER TABLE business_setup_publication
  ADD COLUMN add_on_ids jsonb NOT NULL DEFAULT '{}'::jsonb;
