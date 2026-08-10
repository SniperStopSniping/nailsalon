/**
 * Real nested-route regression coverage (Luster UI/UX plan rev 3, PR3 fix
 * round).
 *
 * The actual public route tree nests the real `[locale]/[slug]/book/*` page
 * components INSIDE the real `[locale]/[slug]/layout.tsx` — this file's
 * sibling `./page.tsx` is a one-line re-export of
 * `src/app/(unauth)/book/service/page.tsx`, physically mounted under this
 * directory's parent layout by Next's file-based routing:
 *
 *   src/app/[locale]/[slug]/layout.tsx
 *     └─ src/app/[locale]/[slug]/book/service/page.tsx
 *          └─ export { default } from '../../../../(unauth)/book/service/page'
 *
 * A prior review round found that both the layout and `PublicSalonPageShell`
 * rendered `PreviewBanner` for this exact nested path, producing a
 * duplicate banner nobody's mocked-child test caught (the existing
 * `layout.test.tsx` renders a stub `<div>` child, never the real page, so it
 * could never see this). This file mounts BOTH real components together —
 * the real `SlugTenantLayout` wrapping the real (re-exported) service page —
 * and fails if more than one `PreviewBanner` renders for an authorized
 * preview.
 *
 * Only external boundaries are mocked: the admin-session/impersonation DB
 * lookups `resolveOwnerPreviewContext` depends on (`@/libs/adminAuth`),
 * salon/tenant data resolution (`@/libs/tenant`), the DB-backed booking
 * queries the service page needs (`@/libs/queries`, `@/libs/salonStatus`,
 * etc.), and `next/navigation`'s `notFound`/`redirect`.
 * `resolveOwnerPreviewContext`/`resolveDraftSalonAccess`
 * (`@/libs/ownerPreview`) are never mocked, nor is any conditional inside
 * the layout or the page component — every assertion below exercises the
 * real control flow.
 */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  getAdminSession,
  getAdminImpersonationForAdmin,
  getResolvedSalon,
  getPublicPageContext,
  notFound,
  redirectMock,
  checkSalonStatus,
  checkFeatureEnabled,
  buildTenantRedirectPath,
  getBookingConfigForSalon,
  getClientSession,
  getServicesBySalonId,
  getActiveAddOnsBySalonId,
  getServiceAddOnRulesBySalonId,
  getTechniciansBySalonId,
  getPublicBookableServiceIds,
  getActiveLocationsBySalonId,
  isClientEligibleForFirstVisitDiscount,
} = vi.hoisted(() => ({
  getAdminSession: vi.fn(),
  getAdminImpersonationForAdmin: vi.fn(),
  getResolvedSalon: vi.fn(),
  getPublicPageContext: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND_SENTINEL');
  }),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  checkSalonStatus: vi.fn(async () => ({})),
  checkFeatureEnabled: vi.fn(async () => ({})),
  buildTenantRedirectPath: vi.fn((path: string | null) => path),
  getBookingConfigForSalon: vi.fn(async () => ({
    bufferMinutes: 10,
    slotIntervalMinutes: 15,
    currency: 'CAD',
    timezone: 'America/Toronto',
    introPriceDefaultLabel: null,
    firstVisitDiscountEnabled: false,
  })),
  getClientSession: vi.fn(async () => null),
  getServicesBySalonId: vi.fn(async () => []),
  getActiveAddOnsBySalonId: vi.fn(async () => []),
  getServiceAddOnRulesBySalonId: vi.fn(async () => []),
  getTechniciansBySalonId: vi.fn(async () => []),
  getPublicBookableServiceIds: vi.fn(async () => null),
  getActiveLocationsBySalonId: vi.fn(async () => []),
  isClientEligibleForFirstVisitDiscount: vi.fn(async () => false),
}));

vi.mock('next/navigation', () => ({
  notFound,
  redirect: redirectMock,
}));

// DB boundary that `resolveOwnerPreviewContext`
// (src/libs/ownerPreview.ts, kept REAL and unmocked below) reads from.
// Mocking these two functions is the equivalent, for this file, of the
// "database" external boundary — it lets the real authorization
// conditionals in ownerPreview.ts run against a controlled admin session
// instead of a real Postgres/PGlite-backed session lookup. The full
// authorization matrix against a real PGlite database already lives in
// src/libs/ownerPreview.test.ts and src/app/[locale]/[slug]/layout.test.tsx
// — this file's job is only the nested-mount wiring regression.
vi.mock('@/libs/adminAuth', () => ({
  getAdminSession,
  getAdminImpersonationForAdmin,
}));

vi.mock('@/libs/tenant', () => ({
  getResolvedSalon,
  getPublicPageContext,
}));

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
  resolveBookingPageConfig: vi.fn(() => ({
    version: 1,
    draft: {
      layout: 'editorial',
      stylePack: 'default',
      tokenOverrides: null,
      sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'],
      sectionVariants: {},
      hiddenSections: [],
      businessMode: 'solo',
      startMode: 'services_first',
    },
    live: {
      layout: 'quick_book',
      stylePack: 'default',
      tokenOverrides: null,
      sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'],
      sectionVariants: {},
      hiddenSections: [],
      businessMode: 'solo',
      startMode: 'services_first',
    },
  })),
}));

vi.mock('@/libs/salonStatus', () => ({
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
}));

vi.mock('@/libs/bookingConfig', () => ({
  getBookingConfigForSalon,
  resolveIntroPriceLabel: vi.fn(() => null),
}));

vi.mock('@/libs/clientAuth', () => ({
  getClientSession,
}));

vi.mock('@/libs/firstVisitDiscount', () => ({
  isClientEligibleForFirstVisitDiscount,
}));

vi.mock('@/libs/queries', () => ({
  getActiveAddOnsBySalonId,
  getActiveLocationsBySalonId,
  getServiceAddOnRulesBySalonId,
  getServicesBySalonId,
  getTechniciansBySalonId,
}));

vi.mock('@/libs/serviceAssignments', () => ({
  getPublicBookableServiceIds,
}));

vi.mock('@/libs/bookingFlow', () => ({
  normalizeBookingFlow: vi.fn(() => ['service', 'tech', 'time', 'confirm']),
}));

// The real page's own client component — irrelevant to this wiring
// regression, so it's replaced with an inert stub, same as the other
// page.test.tsx files do for their *Client components.
vi.mock('@/app/(unauth)/book/service/BookServiceClient', () => ({
  BookServiceClient: () => <div data-testid="book-service-client-stub" />,
}));

/* eslint-disable import/first */
import type { Salon } from '@/models/Schema';

import SlugTenantLayout from '../../layout';
import BookServicePage from './page';
/* eslint-enable import/first */

const SALON_ID = 'salon_nested_draft';
const SALON_SLUG = 'nested-draft-salon';

const DRAFT_SALON = {
  id: SALON_ID,
  name: 'Nested Draft Salon',
  slug: SALON_SLUG,
  themeKey: null,
  status: 'active',
  settings: {},
  features: null,
  plan: 'single_salon',
  publicationStatus: 'draft',
  freeSoloEnabled: true,
  bookingFlow: ['service', 'tech', 'time', 'confirm'],
  address: null,
  city: null,
  state: null,
  zipCode: null,
  phone: null,
} as unknown as Salon;

function ownerSession() {
  return {
    id: 'admin_nested_owner',
    isSuperAdmin: false,
    salons: [
      { salonId: SALON_ID, salonSlug: SALON_SLUG, salonName: DRAFT_SALON.name, role: 'owner' },
    ],
  };
}

describe('Real nested route: [locale]/[slug]/layout.tsx wrapping [locale]/[slug]/book/service/page.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notFound.mockImplementation(() => {
      throw new Error('NOT_FOUND_SENTINEL');
    });
    redirectMock.mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });
    getResolvedSalon.mockResolvedValue(DRAFT_SALON);
    getPublicPageContext.mockResolvedValue({
      salon: DRAFT_SALON,
      appearance: { mode: 'custom', themeKey: null },
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});
    buildTenantRedirectPath.mockImplementation((path: string | null) => path);
    getBookingConfigForSalon.mockResolvedValue({
      bufferMinutes: 10,
      slotIntervalMinutes: 15,
      currency: 'CAD',
      timezone: 'America/Toronto',
      introPriceDefaultLabel: null,
      firstVisitDiscountEnabled: false,
    });
    getClientSession.mockResolvedValue(null);
    getServicesBySalonId.mockResolvedValue([]);
    getActiveAddOnsBySalonId.mockResolvedValue([]);
    getServiceAddOnRulesBySalonId.mockResolvedValue([]);
    getTechniciansBySalonId.mockResolvedValue([]);
    getPublicBookableServiceIds.mockResolvedValue(null);
    getActiveLocationsBySalonId.mockResolvedValue([]);
    getAdminImpersonationForAdmin.mockResolvedValue(null);
  });

  it('renders exactly one preview banner for an authorized owner previewing a draft salon through the real nested route', async () => {
    getAdminSession.mockResolvedValue(ownerSession());

    // Mirrors how Next composes a real nested route: the leaf page.tsx
    // renders first, then the parent layout.tsx receives that render as
    // `children` — both are the REAL exported components, not stubs.
    const pageElement = await BookServicePage({
      searchParams: { salonSlug: SALON_SLUG },
      params: { locale: 'en', slug: SALON_SLUG },
    });

    const layoutElement = await SlugTenantLayout({
      children: pageElement,
      params: { locale: 'en', slug: SALON_SLUG },
    });

    render(layoutElement);

    expect(notFound).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();

    // The regression this test exists to catch: before the fix, BOTH the
    // layout and PublicSalonPageShell (mounted inside the real page)
    // rendered PreviewBanner for this exact nested path, producing two
    // banners for one authorized preview.
    const banners = screen.getAllByTestId('owner-preview-banner');

    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveAttribute('data-preview-variant', 'draft-salon');
    expect(banners[0]).toHaveTextContent('Draft — only you can see this');

    expect(screen.getByTestId('book-service-client-stub')).toBeInTheDocument();
  });

  it('renders zero preview banners for an anonymous visitor on an already-published salon through the real nested route', async () => {
    const publishedSalon = {
      ...DRAFT_SALON,
      id: 'salon_nested_published',
      slug: 'nested-published-salon',
      publicationStatus: 'published',
    };

    getResolvedSalon.mockResolvedValue(publishedSalon);
    getPublicPageContext.mockResolvedValue({
      salon: publishedSalon,
      appearance: { mode: 'custom', themeKey: null },
    });
    getAdminSession.mockResolvedValue(null);

    const pageElement = await BookServicePage({
      searchParams: { salonSlug: publishedSalon.slug },
      params: { locale: 'en', slug: publishedSalon.slug },
    });

    const layoutElement = await SlugTenantLayout({
      children: pageElement,
      params: { locale: 'en', slug: publishedSalon.slug },
    });

    render(layoutElement);

    expect(notFound).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('owner-preview-banner')).not.toBeInTheDocument();
  });
});
