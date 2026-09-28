-- These constraints were originally declared in migration 0069, outside Drizzle's snapshot.
ALTER TABLE "billing_business_identity_link" DROP CONSTRAINT "billing_identity_link_type_valid";
--> statement-breakpoint
ALTER TABLE "billing_business_identity_link" DROP CONSTRAINT "billing_identity_link_version_pairing";
--> statement-breakpoint
ALTER TABLE "billing_business_identity_link" ADD CONSTRAINT "billing_identity_link_type_valid" CHECK ("billing_business_identity_link"."link_type" IN ('clerk_user', 'salon', 'stripe_customer', 'email_hmac', 'phone_hmac'));--> statement-breakpoint
ALTER TABLE "billing_business_identity_link" ADD CONSTRAINT "billing_identity_link_version_pairing" CHECK (("billing_business_identity_link"."link_type" IN ('email_hmac', 'phone_hmac')) = ("billing_business_identity_link"."hmac_key_version" IS NOT NULL));
