-- Exactly one private storage adapter owns each immutable asset.
ALTER TABLE custom_site_asset DROP CONSTRAINT custom_site_asset_check;
--> statement-breakpoint
ALTER TABLE custom_site_asset ADD CONSTRAINT custom_site_asset_storage_choice
  CHECK (num_nonnulls(storage_key, pdf_base64, image_base64) = 1);
