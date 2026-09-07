import type { Metadata } from 'next';

import type { LocationDisplayMode } from '@/libs/bookingPageContent';
import { applyLocationDisplayMode } from '@/libs/salonContent';

/**
 * Document metadata and JSON-LD for a PUBLISHED salon's public pages.
 *
 * The owner's booking link is the product's distribution act: they paste it in
 * an Instagram bio, a text message, a QR code. Before this module every one of
 * those pages inherited `[locale]/layout.tsx`'s `title.default = 'Luster'` with
 * no OpenGraph tags at all, so a shared link advertised Luster rather than the
 * salon, and every salon page carried byte-identical generic metadata.
 *
 * PRIVACY. Metadata is the most public surface there is — it is scraped,
 * cached and re-rendered by parties who never load the page. So the address
 * here runs through the same `applyLocationDisplayMode` choke point every
 * on-page projection uses, at the LIVE `locationDisplayMode`, and never through
 * `resolveConfirmedBookingLocationDisplayMode`: no metadata reader ever holds a
 * verified appointment capability, so `after_booking` and `city_only` both stay
 * city-only here, permanently. There is deliberately no `telephone`, no
 * `postalCode` and no `streetAddress` unless the owner chose `full_address`.
 */
export type PublicSalonMetadataInput = {
  salonName: string;
  slug: string;
  locale: string;
  specialtyLine: string | null;
  bio: string | null;
  logoUrl: string | null;
  heroImageUrl: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  locationDisplayMode: LocationDisplayMode;
};

function trimmed(value: string | null | undefined): string | null {
  const next = value?.trim();
  return next || null;
}

/**
 * A cover saved by the local upload path is a root-relative `/uploads/...`
 * file. Link unfurlers need an absolute URL and this module has no origin,
 * so only absolute cover URLs reach the social/JSON-LD image slots.
 */
function absoluteImageUrl(value: string | null | undefined): string | null {
  const candidate = trimmed(value);
  return candidate && /^https?:\/\//iu.test(candidate) ? candidate : null;
}

/** One sentence, from the owner's own words, never fabricated. */
function resolveDescription(input: PublicSalonMetadataInput, cityLabel: string | null): string {
  const intro = trimmed(input.specialtyLine) ?? trimmed(input.bio);
  if (intro) {
    return intro.length > 200 ? `${intro.slice(0, 197).trimEnd()}…` : intro;
  }
  return cityLabel
    ? `Book an appointment with ${input.salonName} in ${cityLabel}.`
    : `Book an appointment with ${input.salonName}.`;
}

/**
 * City (and state) only — the label every browsing surface is already allowed
 * to show under all three display modes.
 */
export function resolvePublicCityLabel(input: Pick<PublicSalonMetadataInput, 'city' | 'state'>): string | null {
  const parts = [trimmed(input.city), trimmed(input.state)].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : null;
}

export function buildPublicSalonMetadata(input: PublicSalonMetadataInput): Metadata {
  const cityLabel = resolvePublicCityLabel(input);
  const title = `${input.salonName} · Book online`;
  const description = resolveDescription(input, cityLabel);
  const image = trimmed(input.logoUrl) ?? absoluteImageUrl(input.heroImageUrl);
  const canonical = `/${input.locale}/${input.slug}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      title,
      description,
      siteName: input.salonName,
      url: canonical,
      ...(image ? { images: [{ url: image, alt: input.salonName }] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

/**
 * `LocalBusiness` JSON-LD. `address` is built from the SAME redacted projection
 * as the visible page: `streetAddress`/`postalCode` exist only under
 * `full_address`, so a `city_only` or `after_booking` salon is never published
 * to a search index with a home address it asked to keep private.
 */
export function buildPublicSalonJsonLd(input: PublicSalonMetadataInput): Record<string, unknown> | null {
  const redacted = applyLocationDisplayMode({
    address: input.address,
    city: input.city,
    state: input.state,
    zipCode: input.zipCode,
  }, input.locationDisplayMode);

  const cityLabel = resolvePublicCityLabel(input);
  const street = trimmed(redacted.address);
  const postalCode = trimmed(redacted.zipCode);
  const city = trimmed(redacted.city);
  const region = trimmed(redacted.state);
  const image = trimmed(input.logoUrl) ?? absoluteImageUrl(input.heroImageUrl);
  const hasAddress = Boolean(street || city || region || postalCode);

  return {
    '@context': 'https://schema.org',
    '@type': 'NailSalon',
    'name': input.salonName,
    'description': resolveDescription(input, cityLabel),
    'url': `/${input.locale}/${input.slug}`,
    ...(image ? { image, logo: image } : {}),
    ...(hasAddress
      ? {
          address: {
            '@type': 'PostalAddress',
            ...(street ? { streetAddress: street } : {}),
            ...(city ? { addressLocality: city } : {}),
            ...(region ? { addressRegion: region } : {}),
            ...(postalCode ? { postalCode } : {}),
          },
        }
      : {}),
  };
}
