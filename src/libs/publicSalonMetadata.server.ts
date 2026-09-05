import type { Metadata } from 'next';

import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import {
  buildPublicSalonJsonLd,
  buildPublicSalonMetadata,
  type PublicSalonMetadataInput,
} from '@/libs/publicSalonMetadata';
import { getSalonBySlug } from '@/libs/queries';

/**
 * Server side of `publicSalonMetadata`: resolve the salon from the route slug
 * and project it into the metadata input.
 *
 * PUBLISHED SALONS ONLY. A draft salon's public routes 404 for everyone but its
 * owner, and emitting its name/description from `generateMetadata` would turn
 * the title of that 404 into an existence oracle for guessed slugs. When the
 * salon is missing or unpublished this returns `null` and the caller inherits
 * the generic Luster metadata that shipped before — no new disclosure.
 *
 * Reads the LIVE booking-page side only. Owner draft previews are a private
 * rehearsal; metadata is what the rest of the world caches.
 */
async function loadPublicSalonMetadataInput(
  locale: string,
  slug: string,
): Promise<PublicSalonMetadataInput | null> {
  const salon = await getSalonBySlug(slug).catch(() => null);
  if (!salon || salon.publicationStatus !== 'published' || salon.deletedAt || salon.status !== 'active') {
    return null;
  }

  const live = resolveBookingPageContent(salon.settings).live;

  return {
    salonName: salon.name,
    slug: salon.slug,
    locale,
    specialtyLine: live.specialtyLine,
    bio: live.bio,
    logoUrl: salon.logoUrl ?? null,
    heroImageUrl: live.heroImageUrl,
    address: salon.address ?? null,
    city: salon.city ?? null,
    state: salon.state ?? null,
    zipCode: salon.zipCode ?? null,
    locationDisplayMode: live.locationDisplayMode,
  };
}

/**
 * `generateMetadata` for the tenant routes (`/[locale]/[slug]` and its booking
 * steps). Returns `{}` — i.e. inherit the app defaults — for anything that is
 * not a live published salon.
 */
export async function generatePublicSalonMetadata(
  props: { params: Promise<{ locale: string; slug: string }> },
): Promise<Metadata> {
  const params = await props.params;
  const input = await loadPublicSalonMetadataInput(params.locale, params.slug);
  return input ? buildPublicSalonMetadata(input) : {};
}

export async function loadPublicSalonJsonLd(
  locale: string,
  slug: string,
): Promise<Record<string, unknown> | null> {
  const input = await loadPublicSalonMetadataInput(locale, slug);
  return input ? buildPublicSalonJsonLd(input) : null;
}
