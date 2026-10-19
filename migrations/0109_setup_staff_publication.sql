-- Keep temporary draft team identities mapped to their committed Luster records.
-- Existing receipts remain valid and need no backfill beyond the empty map.
ALTER TABLE business_setup_publication
  ADD COLUMN staff_ids jsonb NOT NULL DEFAULT '{}'::jsonb;
