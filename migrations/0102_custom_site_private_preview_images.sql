-- Bounded private image storage for the isolated AI pilot. Existing production
-- media keeps its authenticated storage adapter. No existing asset is rewritten.
ALTER TABLE custom_site_asset ADD COLUMN IF NOT EXISTS image_base64 text;
--> statement-breakpoint
ALTER TABLE custom_site_asset ADD CONSTRAINT custom_site_asset_image_limit
  CHECK (image_base64 IS NULL OR (length(image_base64) <= 1000000 AND mime_type = 'image/webp' AND storage_key IS NULL AND pdf_base64 IS NULL));
