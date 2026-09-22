CREATE TYPE "public"."service_add_on_price_mode" AS ENUM('catalog_priced', 'manual_confirmation');--> statement-breakpoint
ALTER TABLE "appointment_add_on" ADD COLUMN "price_mode_snapshot" "service_add_on_price_mode" DEFAULT 'catalog_priced' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_add_on" ADD COLUMN "price_mode" "service_add_on_price_mode" DEFAULT 'catalog_priced' NOT NULL;