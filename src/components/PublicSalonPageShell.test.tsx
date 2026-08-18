import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
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

const baseSalon = {
  id: 'salon-a-id',
  name: 'Salon A',
  slug: 'salon-a',
  themeKey: null,
  status: 'active',
  settings: null,
  features: null,
  plan: 'single_salon',
} as React.ComponentProps<typeof PublicSalonPageShell>['salon'];

const liveBookingPageSide: React.ComponentProps<typeof PublicSalonPageShell>['bookingPage'] = {
  layout: 'quick_book',
  stylePack: 'default',
  tokenOverrides: null,
  sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'],
  sectionVariants: {},
  hiddenSections: [],
  businessMode: 'solo',
  startMode: 'services_first',
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

// Post-launch privacy fix: `resolveSalonContent` is called exactly once,
// right here in `PublicSalonPageShell` (this file's own doc comment already
// says so) — the natural, single server-side projection point for
// `locationDisplayMode`. This suite exercises the REAL `resolveSalonContent`
// (not mocked), proving the projection actually reaches `useSalon().salonContent`
// as seen by every consumer downstream (e.g. BookServiceClient's Editorial
// "Visit" section).
describe('PublicSalonPageShell location privacy (locationDisplayMode)', () => {
  const PRIVATE_STREET_ADDRESS = '999 PRIVATE HOME ROAD';
  const PRIVATE_UNIT = 'UNIT 77';
  const PRIVATE_POSTAL_CODE = 'A1A 1A1';
  const PRIVATE_FULL_ADDRESS = `${PRIVATE_STREET_ADDRESS}, ${PRIVATE_UNIT}`;

  const privateLocation = {
    id: 'loc-private',
    name: 'Home Studio',
    address: PRIVATE_FULL_ADDRESS,
    city: 'Homeburg',
    state: 'ON',
    zipCode: PRIVATE_POSTAL_CODE,
    isPrimary: true,
  };

  it('full_address (default) preserves the exact address in salonContent.place unchanged', () => {
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
  });

  it('city_only redacts address/zipCode from salonContent.place.address and every place.locations entry', () => {
    render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-service"
        salon={baseSalon}
        bookingPage={liveBookingPageSide}
        salonContentInput={{
          locations: [privateLocation],
          content: { locationDisplayMode: 'city_only' },
        }}
      >
        <SalonContentPlaceProbe />
      </PublicSalonPageShell>,
    );

    const serialized = screen.getByTestId('salon-content-place-probe').textContent ?? '';

    expect(serialized).not.toContain(PRIVATE_STREET_ADDRESS);
    expect(serialized).not.toContain(PRIVATE_UNIT);
    expect(serialized).not.toContain(PRIVATE_POSTAL_CODE);

    const place = JSON.parse(serialized);

    expect(place.address).toEqual({ address: null, city: 'Homeburg', state: 'ON', zipCode: null });
    expect(place.locations[0]).toMatchObject({ id: 'loc-private', name: 'Home Studio', address: null, zipCode: null, city: 'Homeburg' });
  });
});
