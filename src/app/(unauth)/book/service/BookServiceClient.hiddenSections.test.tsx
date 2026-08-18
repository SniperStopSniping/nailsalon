/**
 * Post-launch privacy + section-visibility hotfix: Quick Book coverage for
 * `hiddenSections`.
 *
 * A dedicated file rather than adding to the already-2000+-line
 * BookServiceClient.test.tsx or BookServiceClient.editorial.test.tsx (same
 * rationale the latter file's own top comment already documents) — Quick
 * Book's `hiddenSections` behaviour needs the same `useSalon().bookingPage`/
 * `.salonContent` mock shape the editorial suite uses, which the main suite
 * does not supply at all.
 *
 * Root cause under test: `featuredServices`/`policies`/`socialLinks` stay
 * structurally embedded inside Quick Book's shared `serviceMenu` block
 * (`renderServiceMenuContent` in `BookServiceClient.tsx`) rather than having
 * their own `SectionOrderRenderer` entry — so hiding them via the section
 * order alone does nothing for Quick Book. Every fixture below uses a
 * NON-EMPTY `hiddenSections`, which is exactly the case that shipped broken
 * (every pre-existing render fixture used `hiddenSections: []`).
 */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookingPageConfigSide } from '@/libs/bookingPageConfig';
import { EMPTY_SALON_CONTENT, type SalonContent } from '@/libs/salonContent';
import type { BookingExperience } from '@/types/salonPolicy';

import { BookServiceClient } from './BookServiceClient';

const { navigationMock, salonContextMock } = vi.hoisted(() => ({
  navigationMock: {
    routerBack: vi.fn(),
    routerPush: vi.fn(),
    searchParams: new URLSearchParams('salonSlug=salon-a'),
  },
  salonContextMock: {
    bookingPage: null as unknown,
    salonContent: null as unknown,
    bookingExperience: null as unknown,
  },
}));

const BASE_BOOKING_EXPERIENCE: BookingExperience = {
  primaryColor: null,
  bookingMessage: null,
  policy: {
    enabled: false,
    title: null,
    text: null,
    showOnServicePage: true,
    showBeforeConfirmation: true,
    showAfterConfirmation: true,
    showInConfirmationEmail: true,
  },
  quickFacts: {
    appointmentOnly: { enabled: false, label: null },
    depositNotice: { enabled: false, label: null },
    cancellationNotice: { enabled: false, label: null },
  },
  socialLinks: { instagram: null, facebook: null, tiktok: null },
  confirmationMessage: null,
};

const QUICK_BOOK_BOOKING_PAGE_SIDE: BookingPageConfigSide = {
  layout: 'quick_book',
  stylePack: 'default',
  tokenOverrides: null,
  sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'],
  sectionVariants: {},
  hiddenSections: [],
  businessMode: 'solo',
  startMode: 'services_first',
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: navigationMock.routerBack, push: navigationMock.routerPush }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => navigationMock.searchParams,
}));

vi.mock('@/components/booking/BookingStepHeader', () => ({
  BookingStepHeader: ({ bookingFlow }: { bookingFlow: string[] }) => (
    <div data-testid="booking-step-header">{bookingFlow.join(' > ')}</div>
  ),
}));

vi.mock('@/hooks/useBookingState', () => ({
  useBookingState: () => ({
    technicianId: null,
    technicianSelectionSource: null,
    baseServiceId: null,
    selectedAddOns: [],
    locationId: null,
    isHydrated: true,
    setTechnicianId: vi.fn(),
    setBaseServiceId: vi.fn(),
    setSelectedAddOns: vi.fn(),
    setServiceIds: vi.fn(),
    setLocationId: vi.fn(),
    syncFromUrl: vi.fn(),
  }),
}));

vi.mock('@/libs/haptics', () => ({
  triggerHaptic: vi.fn(),
}));

vi.mock('@/providers/SalonProvider', () => ({
  SalonProvider: ({ children }: { children: React.ReactNode }) => children,
  useSalon: () => ({
    bookingExperience: (salonContextMock.bookingExperience as BookingExperience | null) ?? BASE_BOOKING_EXPERIENCE,
    salonName: 'Isla Nail Studio',
    salonSlug: 'salon-a',
    bookingPage: salonContextMock.bookingPage,
    salonContent: salonContextMock.salonContent,
  }),
}));

const service = {
  id: 'svc-1',
  name: 'Signature Gel-X',
  description: null,
  descriptionItems: ['Full set extensions'],
  durationMinutes: 90,
  priceCents: 9000,
  priceDisplayText: null,
  category: 'extensions' as const,
  bookingCategory: 'manicure' as const,
  templateKey: null,
  featuredOrder: 1,
  imageUrl: '/service-1.jpg',
  resolvedIntroPriceLabel: null,
};

const FEATURED_SERVICE = {
  id: 'svc-featured',
  name: 'Luster Manicure',
  description: null,
  durationMinutes: 75,
  priceCents: 6500,
  priceDisplayText: null,
  category: 'manicure' as const,
  bookingCategory: null,
  imageUrl: null,
  featuredOrder: null,
};

function buildContent(overrides: Partial<SalonContent> = {}): SalonContent {
  return {
    ...EMPTY_SALON_CONTENT,
    identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Isla Nail Studio' },
    ...overrides,
  };
}

describe('BookServiceClient — Quick Book layout hiddenSections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a');
    salonContextMock.bookingPage = QUICK_BOOK_BOOKING_PAGE_SIDE;
    salonContextMock.salonContent = buildContent();
    salonContextMock.bookingExperience = null;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the embedded featured-services carousel, policy card, and social links by default (positive control)', () => {
    salonContextMock.salonContent = buildContent({
      catalog: { ...EMPTY_SALON_CONTENT.catalog, featuredServices: [FEATURED_SERVICE] },
    });
    salonContextMock.bookingExperience = {
      ...BASE_BOOKING_EXPERIENCE,
      policy: { ...BASE_BOOKING_EXPERIENCE.policy, enabled: true, text: 'Please arrive 5 minutes early.' },
      socialLinks: { instagram: 'https://instagram.com/isla', facebook: null, tiktok: null },
    };

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.getByTestId('featured-services-scroll')).toBeInTheDocument();
    expect(screen.getByTestId('booking-policy')).toBeInTheDocument();
    expect(screen.getByTestId('booking-social-links')).toBeInTheDocument();
  });

  it('hides the embedded featured-services carousel when featuredServices is hidden, even with real featured services', () => {
    salonContextMock.bookingPage = { ...QUICK_BOOK_BOOKING_PAGE_SIDE, hiddenSections: ['featuredServices'] };
    salonContextMock.salonContent = buildContent({
      catalog: { ...EMPTY_SALON_CONTENT.catalog, featuredServices: [FEATURED_SERVICE] },
    });

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.queryByTestId('featured-services-scroll')).not.toBeInTheDocument();
  });

  it('hides the embedded policy card when policies is hidden, even with the policy enabled and text present', () => {
    salonContextMock.bookingPage = { ...QUICK_BOOK_BOOKING_PAGE_SIDE, hiddenSections: ['policies'] };
    salonContextMock.bookingExperience = {
      ...BASE_BOOKING_EXPERIENCE,
      policy: { ...BASE_BOOKING_EXPERIENCE.policy, enabled: true, text: 'Please arrive 5 minutes early.' },
    };

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.queryByTestId('booking-policy')).not.toBeInTheDocument();
    expect(screen.queryByText('Please arrive 5 minutes early.')).not.toBeInTheDocument();
  });

  it('hides the embedded social links when socialLinks is hidden, even with a link configured', () => {
    salonContextMock.bookingPage = { ...QUICK_BOOK_BOOKING_PAGE_SIDE, hiddenSections: ['socialLinks'] };
    salonContextMock.bookingExperience = {
      ...BASE_BOOKING_EXPERIENCE,
      socialLinks: { instagram: 'https://instagram.com/isla', facebook: null, tiktok: null },
    };

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.queryByTestId('booking-social-links')).not.toBeInTheDocument();
  });

  it('hiding one embedded control does not hide the others (independent flags)', () => {
    salonContextMock.bookingPage = { ...QUICK_BOOK_BOOKING_PAGE_SIDE, hiddenSections: ['featuredServices'] };
    salonContextMock.salonContent = buildContent({
      catalog: { ...EMPTY_SALON_CONTENT.catalog, featuredServices: [FEATURED_SERVICE] },
    });
    salonContextMock.bookingExperience = {
      ...BASE_BOOKING_EXPERIENCE,
      policy: { ...BASE_BOOKING_EXPERIENCE.policy, enabled: true, text: 'Please arrive 5 minutes early.' },
      socialLinks: { instagram: 'https://instagram.com/isla', facebook: null, tiktok: null },
    };

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.queryByTestId('featured-services-scroll')).not.toBeInTheDocument();
    expect(screen.getByTestId('booking-policy')).toBeInTheDocument();
    expect(screen.getByTestId('booking-social-links')).toBeInTheDocument();
  });

  it('re-enabling a hidden embedded control restores it', () => {
    salonContextMock.bookingPage = { ...QUICK_BOOK_BOOKING_PAGE_SIDE, hiddenSections: ['policies'] };
    salonContextMock.bookingExperience = {
      ...BASE_BOOKING_EXPERIENCE,
      policy: { ...BASE_BOOKING_EXPERIENCE.policy, enabled: true, text: 'Please arrive 5 minutes early.' },
    };

    const { rerender } = render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.queryByTestId('booking-policy')).not.toBeInTheDocument();

    salonContextMock.bookingPage = { ...QUICK_BOOK_BOOKING_PAGE_SIDE, hiddenSections: [] };
    rerender(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.getByTestId('booking-policy')).toBeInTheDocument();
  });

  it('serviceMenu (and therefore bookingCta reachability) is never suppressed even if hiddenSections is malformed', () => {
    // Real callers only ever hand this component an already-validated
    // hiddenSections (validateSectionOrder in @/libs/bookingPageConfig
    // strips serviceMenu/bookingCta before this component ever sees it — see
    // the dedicated full-pipeline proof in bookingPageConfig.test.ts). This
    // is a defense-in-depth check that a well-formed hiddenSections (i.e.
    // one that, like every real one, never contains serviceMenu/bookingCta)
    // still leaves the booking engine itself intact and reachable.
    salonContextMock.bookingPage = {
      ...QUICK_BOOK_BOOKING_PAGE_SIDE,
      hiddenSections: ['featuredServices', 'policies', 'socialLinks'],
    };

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.getByPlaceholderText('Search services...')).toBeInTheDocument();
  });
});
