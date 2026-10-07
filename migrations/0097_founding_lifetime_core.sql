CREATE TABLE IF NOT EXISTS "founding_lifetime_claim" (
	"id" text PRIMARY KEY NOT NULL,
	"salon_id" text NOT NULL,
	"source_site_id" text NOT NULL,
	"claimed_by_admin_id" text,
	"offer_key" text NOT NULL,
	"terms_version" integer NOT NULL,
	"terms" jsonb NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "founding_lifetime_claim_offer_valid" CHECK ("founding_lifetime_claim"."offer_key" = 'founding_lifetime_2026' AND "founding_lifetime_claim"."terms_version" = 1),
	CONSTRAINT "founding_lifetime_claim_core_terms_valid" CHECK (("founding_lifetime_claim"."terms"->>'coreSoftwareAccess' = 'lifetime' AND "founding_lifetime_claim"."terms"->>'coreSoftwareMonthlyPriceCents' = '0' AND "founding_lifetime_claim"."terms"->>'emails' = 'unlimited' AND "founding_lifetime_claim"."terms"->>'starterTextCredits' = '100' AND "founding_lifetime_claim"."terms"->>'starterTextCreditsFrequency' = 'once_per_verified_business' AND "founding_lifetime_claim"."terms"->>'additionalTexts' = 'paid_separately' AND "founding_lifetime_claim"."terms"->>'aiReceptionist' = 'paid_separately' AND "founding_lifetime_claim"."terms"->>'phoneUsage' = 'paid_separately' AND "founding_lifetime_claim"."terms"->>'otherUsageServices' = 'paid_separately') IS TRUE)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "founding_lifetime_claim" ADD CONSTRAINT "founding_lifetime_claim_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "founding_lifetime_claim" ADD CONSTRAINT "founding_lifetime_claim_claimed_by_admin_id_admin_user_id_fk" FOREIGN KEY ("claimed_by_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "founding_lifetime_claim_salon_uniq" ON "founding_lifetime_claim" USING btree ("salon_id");