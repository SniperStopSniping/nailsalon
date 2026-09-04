import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { useSalon } from '@/providers/SalonProvider';

// SalonProvider pulls its `BOOKING_PAGE_CONFIG_SIDE_DEFAULTS` fallback value
// from `@/libs/bookingPageConfig`, which in turn imports `@/libs/DB`
// (server-only). Stub the one value SalonProvider actually needs so this
// component-level test never touches the real DB module — every test below
// passes an explicit `bookingPage` prop anyway, so the default is never
// read.
vi.mock('@/libs/bookingPageConfig', () => ({
  BOOKING_PAGE_CONFIG_SIDE_DEFAULTS: {
    layout: 'quick_book',
    stylePack: 'default',
    tokenOverrides: null,
    sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'],
    sectionVariants: {},
    hiddenSections: [],
    businessMode: 'solo',
    startMode: 'services_first',
  },
}));

// `PublicSalonPageShell` now resolves `bookingPageContent` (and therefore
// `locationDisplayMode`) itself — see the "salon-level address redaction"
// describe block below. `@/libs/bookingPageContent` starts with `import
// 'server-only'` (transitively `@/libs/DB`), so it's mocked here for the
// same reason `@/libs/bookingPageConfig` is above: keep this
// component-level test off the real DB module. Defaults to `full_address`
// on both sides; individual tests override with `mockReturnValueOnce`.
vi.mock('@/libs/bookingPageContent', () => ({
  resolveBookingPageContent: vi.fn(() => ({
    version: 1,
    draft: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' },
    live: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' },
  })),
}));

/**
 * Regression coverage for the PR3 review finding (incomplete-wiring,
 * High): `PublicSalonPageShell` mounts the nested `SalonProvider` that the
 * real booking flow (service/tech/time/confirm) actually renders under —
 * `[locale]/[slug]/layout.tsx`'s own SalonProvider/PreviewBanner never wrap
 * these pages when reached via the canonical `/book?salonSlug=...` entry
 * URL. This file asserts the `bookingPage`/`ownerPreview` props actually
 * reach `useSalon()` here, and that the preview banner renders in the one
 * place an owner previewing their draft would actually see it.
 */

// Regression fixture for the PR 125 review finding (incomplete-wiring,
// High / "Blocker 2"): `baseSalon` previously had NO address fields at all,
// so no test built on top of it could ever exercise the
// `hasSalonLevelAddress` branch of `resolveSalonContent` — the exact branch
// that leaked `salon.address` unredacted into the RSC flight payload on
// `/book/tech`, `/book/time`, and `/book/confirm` (none of which pass a
// `locations` array, so `salonContent.place.address` falls back to these
// salon-level fields). Carrying a real, synthetic-PII address on the base
// fixture means every existing test built on `baseSalon` now doubles as a
// non-regression check that the shell's own choke point stays wired.
const SALON_LEVEL_PRIVATE_STREET_ADDRESS = '999 PRIVATE HOME ROAD';
const SALON_LEVEL_PRIVATE_UNIT = 'UNIT 77';
const SALON_LEVEL_PRIVATE_POSTAL_CODE = 'A1A 1A1';
const SALON_LEVEL_PRIVATE_FULL_ADDRESS = `${SALON_LEVEL_PRIVATE_STREET_ADDRESS}, ${SALON_LEVEL_PRIVATE_UNIT}`;

const baseSalon = {
  id: 'salon-a-id',
  name: 'Salon A',
  slug: 'salon-a',
  themeKey: null,
  status: 'active',
  settings: null,
  features: null,
  plan: 'single_salon',
  address: SALON_LEVEL_PRIVATE_FULL_ADDRESS,
  city: 'Homeburg',
  state: 'ON',
  zipCode: SALON_LEVEL_PRIVATE_POSTAL_CODE,
} as React.ComponentProps<typeof PublicSalonPageShell>['salon'];

const liveBookingPageSide: React.ComponentProps<typeof PublicSalonPageShell>['bookingPage'] = {
  layout: 'quick_book',
  serviceMenuLayout: 'visual_grid',
  stylePack: 'default',
  tokenOverrides: null,
  sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'],
  sectionVariants: {},
  hiddenSections: [],
  businessMode: 'solo',
  startMode: 'services_first',
  quickBookProfile: {
    showTechName: false,
    showTechPhoto: false,
    showLocation: false,
    showHours: false,
    showPhone: false,
    showEmail: false,
    showBookingPolicy: false,
    showCancellationPolicy: false,
    showReviews: false,
    showInstagram: false,
    showBio: false,
  },
};

const draftBookingPageSide: React.ComponentProps<typeof PublicSalonPageShell>['bookingPage'] = {
  ...liveBookingPageSide,
  layout: 'editorial',
};

function SalonContextProbe() {
  const { bookingPage, ownerPreview } = useSalon();
  return (
    <div data-testid="salon-context-probe">
      {JSON.stringify({ bookingPage, ownerPreview })}
    </div>
  );
}

function SalonContentPlaceProbe() {
  const { salonContent } = useSalon();
  return (
    <div data-testid="salon-content-place-probe">
      {JSON.stringify(salonContent.place)}
    </div>
  );
}

describe('PublicSalonPageShell owner-preview wiring', () => {
  it('does not render a preview banner and exposes the live bookingPage side by default', () => {
    render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-service"
        salon={baseSalon}
        bookingPage={liveBookingPageSide}
      >
        <SalonContextProbe />
      </PublicSalonPageShell>,
    );

    expect(screen.queryByTestId('owner-preview-banner')).not.toBeInTheDocument();

    const probe = JSON.parse(screen.getByTestId('salon-context-probe').textContent ?? '{}');

    expect(probe.bookingPage.layout).toBe('quick_book');
    expect(probe.ownerPreview).toEqual({ isPreviewing: false, actorType: null });
  });

  it('renders the draft-salon banner and forwards the draft bookingPage side and ownerPreview state', () => {
    render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-service"
        salon={baseSalon}
        bookingPage={draftBookingPageSide}
        ownerPreview={{ isPreviewing: true, actorType: 'owner' }}
        previewBannerVariant="draft-salon"
      >
        <SalonContextProbe />
      </PublicSalonPageShell>,
    );

    const banner = screen.getByTestId('owner-preview-banner');

    expect(banner).toHaveAttribute('data-preview-variant', 'draft-salon');
    expect(banner).toHaveTextContent('Draft — only you can see this');

    const probe = JSON.parse(screen.getByTestId('salon-context-probe').textContent ?? '{}');

    expect(probe.bookingPage.layout).toBe('editorial');
    expect(probe.ownerPreview).toEqual({ isPreviewing: true, actorType: 'owner' });
  });

  it('renders the draft-config banner for an authorized super admin previewing config changes on a published salon', () => {
    render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-service"
        salon={baseSalon}
        bookingPage={draftBookingPageSide}
        ownerPreview={{ isPreviewing: true, actorType: 'super_admin' }}
        previewBannerVariant="draft-config"
      >
        <SalonContextProbe />
      </PublicSalonPageShell>,
    );

    const banner = screen.getByTestId('owner-preview-banner');

    expect(banner).toHaveAttribute('data-preview-variant', 'draft-config');
    expect(banner).toHaveTextContent('Previewing unpublished changes');
  });
});

/** Builds a `resolveBookingPageContent` mock return value with an explicit mode per side. */
function bookingPageContentReturn(liveMode: 'full_address' | 'city_only', draftMode: 'full_address' | 'city_only' = liveMode) {
  return {
    version: 1 as const,
    draft: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: draftMode },
    live: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: liveMode },
  };
}

// Post-launch privacy fix: `resolveSalonContent` is called exactly once,
// right here in `PublicSalonPageShell` (this file's own doc comment already
// says so) — the natural, single server-side projection point for
// `locationDisplayMode`. This suite exercises the REAL `resolveSalonContent`
// (not mocked), proving the projection actually reaches `useSalon().salonContent`
// as seen by every consumer downstream (e.g. BookServiceClient's Editorial
// "Visit" section).
describe('PublicSalonPageShell location privacy (locationDisplayMode) — per-location address', () => {
  const PRIVATE_STREET_ADDRESS = '999 PRIVATE HOME ROAD';
  const PRIVATE_UNIT = 'UNIT 77';
  const PRIVATE_POSTAL_CODE = 'A1A 1A1';
  const PRIVATE_FULL_ADDRESS = `${PRIVATE_STREET_ADDRESS}, ${PRIVATE_UNIT}`;
  // Unmistakable synthetic phone (never a real number) — post-launch privacy
  // fix: `applyLocationDisplayMode` (`@/libs/salonContent`) now redacts
  // `phone` alongside `address`/`zipCode`, closing the gap where a
  // home-based solo tech's personal mobile survived `city_only` redaction
  // (this exact `place.locations[].phone` field is where it leaked, since
  // `resolveSalonContent` is the ONE public choke point this shell calls).
  const PRIVATE_PHONE = '+14165550199';

  const privateLocation = {
    id: 'loc-private',
    name: 'Home Studio',
    address: PRIVATE_FULL_ADDRESS,
    city: 'Homeburg',
    state: 'ON',
    zipCode: PRIVATE_POSTAL_CODE,
    phone: PRIVATE_PHONE,
    isPrimary: true,
  };

  it('full_address (default) preserves the exact address and phone in salonContent.place unchanged', () => {
    render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-service"
        salon={baseSalon}
        bookingPage={liveBookingPageSide}
        salonContentInput={{ locations: [privateLocation] }}
      >
        <SalonContentPlaceProbe />
      </PublicSalonPageShell>,
    );

    const place = JSON.parse(screen.getByTestId('salon-content-place-probe').textContent ?? '{}');

    expect(place.address.address).toBe(PRIVATE_FULL_ADDRESS);
    expect(place.address.zipCode).toBe(PRIVATE_POSTAL_CODE);
    expect(place.locations[0].address).toBe(PRIVATE_FULL_ADDRESS);
    expect(place.locations[0].phone).toBe(PRIVATE_PHONE);
  });

  it('booking-only contact strips the location phone even when the address is public', () => {
    render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-service"
        salon={{
          ...baseSalon,
          settings: { sharedProfile: { bookingOnlyContact: true } },
        }}
        bookingPage={liveBookingPageSide}
        salonContentInput={{ locations: [privateLocation] }}
      >
        <SalonContentPlaceProbe />
      </PublicSalonPageShell>,
    );

    const place = JSON.parse(screen.getByTestId('salon-content-place-probe').textContent ?? '{}');

    expect(place.address.address).toBe(PRIVATE_FULL_ADDRESS);
    expect(place.locations[0]).toMatchObject({
      address: PRIVATE_FULL_ADDRESS,
      phone: null,
    });
    expect(JSON.stringify(place)).not.toContain(PRIVATE_PHONE);
  });

  it('city_only redacts address/zipCode/phone from salonContent.place.address and every place.locations entry', () => {
    vi.mocked(resolveBookingPageContent).mockReturnValueOnce(bookingPageContentReturn('city_only'));

    render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-service"
        salon={baseSalon}
        bookingPage={liveBookingPageSide}
        salonContentInput={{ locations: [privateLocation] }}
      >
        <SalonContentPlaceProbe />
      </PublicSalonPageShell>,
    );

    const serialized = screen.getByTestId('salon-content-place-probe').textContent ?? '';

    expect(serialized).not.toContain(PRIVATE_STREET_ADDRESS);
    expect(serialized).not.toContain(PRIVATE_UNIT);
    expect(serialized).not.toContain(PRIVATE_POSTAL_CODE);
    expect(serialized).not.toContain(PRIVATE_PHONE);

    const place = JSON.parse(serialized);

    expect(place.address).toEqual({ address: null, city: 'Homeburg', state: 'ON', zipCode: null });
    expect(place.locations[0]).toMatchObject({ id: 'loc-private', name: 'Home Studio', address: null, zipCode: null, phone: null, city: 'Homeburg' });
  });
});

// PR 125 review finding ("Blocker 2"): `/book/tech`, `/book/time`, and
// `/book/confirm` all mount this exact shell with NO `salonContentInput` at
// all (only `/book/service` resolves technicians/services/locations to
// build one) — reproduced here by omitting `salonContentInput` entirely,
// exactly like those three pages do. With no `locations` array,
// `resolveSalonContent`'s `hasSalonLevelAddress` branch falls back to
// `salon.address/city/state/zipCode` — `baseSalon`'s own fields (see the
// fixture comment above) — and that fallback used to skip redaction
// entirely, because nothing inside this shell ever resolved
// `bookingPageContent`/`locationDisplayMode` on its own. This describe
// block is the real, non-mocked-shell proof that the three pages are safe:
// each of their own `page.test.tsx` files mocks this shell out (spy-only),
// so they can only prove correct WIRING (`isPreviewingDraftConfig` reaching
// this component) — the actual redaction mechanism is proven exactly once,
// here, against the identical no-`salonContentInput` shape all three use.
describe('PublicSalonPageShell salon-level address redaction (Blocker 2 — /book/tech, /book/time, /book/confirm)', () => {
  it('full_address (default) leaves the salon-level address intact in salonContent.place — control case, proves the redaction below is not vacuous', () => {
    render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-technician"
        salon={baseSalon}
      >
        <SalonContentPlaceProbe />
      </PublicSalonPageShell>,
    );

    const place = JSON.parse(screen.getByTestId('salon-content-place-probe').textContent ?? '{}');

    expect(place.address.address).toBe(SALON_LEVEL_PRIVATE_FULL_ADDRESS);
    expect(place.address.zipCode).toBe(SALON_LEVEL_PRIVATE_POSTAL_CODE);
    expect(place.address.city).toBe('Homeburg');
  });

  it('city_only strips the salon-level address/zipCode with no salonContentInput at all — the exact path that leaked', () => {
    vi.mocked(resolveBookingPageContent).mockReturnValueOnce(bookingPageContentReturn('city_only'));

    render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-technician"
        salon={baseSalon}
      >
        <SalonContentPlaceProbe />
      </PublicSalonPageShell>,
    );

    const serialized = screen.getByTestId('salon-content-place-probe').textContent ?? '';

    expect(serialized).not.toContain(SALON_LEVEL_PRIVATE_STREET_ADDRESS);
    expect(serialized).not.toContain(SALON_LEVEL_PRIVATE_UNIT);
    expect(serialized).not.toContain(SALON_LEVEL_PRIVATE_POSTAL_CODE);

    const place = JSON.parse(serialized);

    expect(place.address).toEqual({ address: null, city: 'Homeburg', state: 'ON', zipCode: null });
  });

  it('an authorized owner preview (isPreviewingDraftConfig=true) redacts using the DRAFT side even while live is full_address', () => {
    vi.mocked(resolveBookingPageContent).mockReturnValueOnce(
      bookingPageContentReturn('full_address', 'city_only'),
    );

    render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-technician"
        salon={baseSalon}
        ownerPreview={{ isPreviewing: true, actorType: 'owner' }}
        isPreviewingDraftConfig
      >
        <SalonContentPlaceProbe />
      </PublicSalonPageShell>,
    );

    const serialized = screen.getByTestId('salon-content-place-probe').textContent ?? '';

    expect(serialized).not.toContain(SALON_LEVEL_PRIVATE_STREET_ADDRESS);
    expect(serialized).not.toContain(SALON_LEVEL_PRIVATE_POSTAL_CODE);

    const place = JSON.parse(serialized);

    expect(place.address).toEqual({ address: null, city: 'Homeburg', state: 'ON', zipCode: null });
  });

  it('a public visitor (isPreviewingDraftConfig omitted) sees LIVE, not the owner\'s in-progress draft — full_address draft never leaks past a city_only live setting either', () => {
    vi.mocked(resolveBookingPageContent).mockReturnValueOnce(
      bookingPageContentReturn('city_only', 'full_address'),
    );

    render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-technician"
        salon={baseSalon}
      >
        <SalonContentPlaceProbe />
      </PublicSalonPageShell>,
    );

    const serialized = screen.getByTestId('salon-content-place-probe').textContent ?? '';

    // Proves the gate reads the LIVE side for an unauthenticated request,
    // not just "whichever side happens to be city_only" — the draft side
    // here is deliberately full_address and must not leak through either.
    expect(serialized).not.toContain(SALON_LEVEL_PRIVATE_STREET_ADDRESS);
    expect(serialized).not.toContain(SALON_LEVEL_PRIVATE_POSTAL_CODE);

    const place = JSON.parse(serialized);

    expect(place.address).toEqual({ address: null, city: 'Homeburg', state: 'ON', zipCode: null });
  });
});
