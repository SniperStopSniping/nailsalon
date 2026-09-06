-- 0075_onboarding_cover_media_role.sql
--
-- Adds the third onboarding identity image role: `cover`.
--
-- Additive only. The role list on `onboarding_site_media` is widened so an
-- owner can upload their cover photo during onboarding, the same way logo and
-- profile photo already work. No column is added, no row is rewritten, and
-- every existing role keeps its exact meaning, so this migration is a no-op
-- for salons that never upload a cover.
--
-- The canonical destination for a promoted cover is the EXISTING
-- `salon.settings.bookingPageContent.draft.heroImageUrl` field the dashboard
-- and the public cover layouts already read. No second cover field is
-- introduced.

ALTER TABLE "onboarding_site_media" DROP CONSTRAINT IF EXISTS "onboarding_site_media_role_check";
--> statement-breakpoint
ALTER TABLE "onboarding_site_media" ADD CONSTRAINT "onboarding_site_media_role_check"
  CHECK ("role" IN ('profile', 'logo', 'gallery', 'custom_design', 'cover'));
