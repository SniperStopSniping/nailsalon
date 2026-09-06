import { describe, expect, it } from 'vitest';

import {
  buildPublicSalonJsonLd,
  buildPublicSalonMetadata,
  type PublicSalonMetadataInput,
} from '@/libs/publicSalonMetadata';

const PRIVATE_STREET = '18 Maple Grove Lane, Unit 4B';
const PRIVATE_POSTAL_CODE = 'M4K 1N2';

function input(overrides: Partial<PublicSalonMetadataInput> = {}): PublicSalonMetadataInput {
  return {
    salonName: 'Lacquer Lab Studio',
    slug: 'lacquer-lab-studio',
    locale: 'en',
    specialtyLine: 'Hand-painted gel art in a calm one-chair studio.',
    bio: 'A long bio that should never win over the specialty line.',
    logoUrl: 'https://cdn.example.com/logo.png',
    heroImageUrl: 'https://cdn.example.com/hero.jpg',
    address: PRIVATE_STREET,
    city: 'Toronto',
    state: 'ON',
    zipCode: PRIVATE_POSTAL_CODE,
    locationDisplayMode: 'full_address',
    ...overrides,
  };
}

describe('public salon metadata', () => {
  it('names the salon instead of Luster, and carries OpenGraph for a shared link', () => {
    const metadata = buildPublicSalonMetadata(input());

    expect(metadata.title).toBe('Lacquer Lab Studio · Book online');
    expect(metadata.description).toBe('Hand-painted gel art in a calm one-chair studio.');
    expect(metadata.openGraph?.title).toBe('Lacquer Lab Studio · Book online');
    expect(metadata.openGraph).toMatchObject({
      siteName: 'Lacquer Lab Studio',
      url: '/en/lacquer-lab-studio',
      images: [{ url: 'https://cdn.example.com/logo.png', alt: 'Lacquer Lab Studio' }],
    });
    expect(metadata.alternates?.canonical).toBe('/en/lacquer-lab-studio');
  });

  it('falls back through bio, then a city sentence, and never invents copy', () => {
    expect(buildPublicSalonMetadata(input({ specialtyLine: '  ' })).description)
      .toBe('A long bio that should never win over the specialty line.');
    expect(buildPublicSalonMetadata(input({ specialtyLine: null, bio: null })).description)
      .toBe('Book an appointment with Lacquer Lab Studio in Toronto, ON.');
    expect(buildPublicSalonMetadata(input({ specialtyLine: null, bio: null, city: null, state: null })).description)
      .toBe('Book an appointment with Lacquer Lab Studio.');
  });

  it('uses the hero image only when there is no logo, and downgrades the card without either', () => {
    expect(buildPublicSalonMetadata(input({ logoUrl: null })).openGraph?.images)
      .toEqual([{ url: 'https://cdn.example.com/hero.jpg', alt: 'Lacquer Lab Studio' }]);

    const bare = buildPublicSalonMetadata(input({ logoUrl: null, heroImageUrl: null }));

    expect(bare.openGraph?.images).toBeUndefined();
    expect((bare.twitter as { card?: string } | undefined)?.card).toBe('summary');
  });

  it('publishes the street address in JSON-LD ONLY under full_address', () => {
    const published = buildPublicSalonJsonLd(input());

    expect(published).toMatchObject({
      '@type': 'NailSalon',
      'name': 'Lacquer Lab Studio',
      'address': {
        '@type': 'PostalAddress',
        'streetAddress': PRIVATE_STREET,
        'addressLocality': 'Toronto',
        'addressRegion': 'ON',
        'postalCode': PRIVATE_POSTAL_CODE,
      },
    });

    // The two private modes are indistinguishable to a crawler: city + region,
    // never the street and never the postal code. `after_booking` is NOT
    // promoted here — no metadata reader holds an appointment capability.
    for (const mode of ['after_booking', 'city_only'] as const) {
      const jsonLd = buildPublicSalonJsonLd(input({ locationDisplayMode: mode }));
      const serialized = JSON.stringify(jsonLd);

      expect(jsonLd?.address).toEqual({
        '@type': 'PostalAddress',
        'addressLocality': 'Toronto',
        'addressRegion': 'ON',
      });
      expect(serialized).not.toContain(PRIVATE_STREET);
      expect(serialized).not.toContain(PRIVATE_POSTAL_CODE);
    }
  });

  it('omits the address block entirely when the salon has no public city', () => {
    const jsonLd = buildPublicSalonJsonLd(input({
      address: PRIVATE_STREET,
      city: null,
      state: null,
      zipCode: PRIVATE_POSTAL_CODE,
      locationDisplayMode: 'city_only',
    }));

    expect(jsonLd?.address).toBeUndefined();
    expect(JSON.stringify(jsonLd)).not.toContain(PRIVATE_STREET);
  });
});
