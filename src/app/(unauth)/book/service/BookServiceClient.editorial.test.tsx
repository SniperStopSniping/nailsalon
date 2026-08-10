/**
 * Editorial Luxury layout tests (Luster UI/UX plan rev 3, PR 6).
 *
 * A dedicated file rather than adding to the already-2000+-line
 * BookServiceClient.test.tsx: Editorial is exercised entirely through
 * `useSalon().bookingPage.layout === 'editorial'` plus a populated
 * `salonContent`, both of which the main suite's `useSalon` mock never
 * supplies (it only returns `bookingExperience`/`salonName`/`salonSlug`,
 * relying on BookServiceClient's own documented quick-book fallback). This
 * file supplies the two extra fields directly.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
    // null falls back to BASE_BOOKING_EXPERIENCE below (declared after this
    // hoisted block, so it cannot be referenced directly in here) — tests
    // that need a non-default bookingExperience (e.g. policy.enabled) set
    // this directly.
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

const EDITORIAL_BOOKING_PAGE_SIDE: BookingPageConfigSide = {
  layout: 'editorial',
  stylePack: 'default',
  tokenOverrides: null,
  sectionOrder: [
    'salonProfile',
    'featuredServices',
    'technicianProfile',
    'portfolio',
    'reviews',
    'serviceMenu',
    'hoursLocation',
    'policies',
    'bookingCta',
  ],
  sectionVariants: {},
  hiddenSections: [],
  businessMode: 'solo',
  startMode: 'services_first',
};

vi.mock('next/image', () => ({
  default: ({
    alt,
    src,
    className,
    'data-testid': dataTestId,
  }: React.ImgHTMLAttributes<HTMLImageElement> & { 'src'?: string; 'data-testid'?: string }) => (
    <img alt={alt} src={src} className={className} data-testid={dataTestId} />
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: navigationMock.routerBack, push: navigationMock.routerPush }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => navigationMock.searchParams,
}));

vi.mock('@/components/BlockingLoginModal', () => ({
  BlockingLoginModal: () => null,
}));

vi.mock('@/components/booking/BookingStepHeader', () => ({
  BookingStepHeader: ({ bookingFlow }: { bookingFlow: string[] }) => (
    <div data-testid="booking-step-header">{bookingFlow.join(' > ')}</div>
  ),
}));

vi.mock('@/components/booking/BookingFloatingDock', () => ({
  BookingFloatingDock: () => null,
}));

vi.mock('@/components/booking/BookingPhoneLogin', () => ({
  BookingPhoneLogin: () => null,
}));

vi.mock('@/hooks/useClientSession', () => ({
  useClientSession: () => ({
    isLoggedIn: false,
    isCheckingSession: false,
    handleLoginSuccess: vi.fn(),
  }),
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

// jsdom has no IntersectionObserver. Capture the constructor's callback so
// tests can invoke it directly with a fake entry — this is the "assert the
// underlying state logic" the PR6 spec calls for in place of real scrolling.
let observerCallback: IntersectionObserverCallback | null = null;

class MockIntersectionObserver implements IntersectionObserver {
  root: Element | Document | null = null;
  rootMargin = '';
  thresholds: ReadonlyArray<number> = [];
  constructor(callback: IntersectionObserverCallback) {
    observerCallback = callback;
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = (): IntersectionObserverEntry[] => [];
}

function fireAnchorIntersection(top: number) {
  act(() => {
    observerCallback?.(
      [{ boundingClientRect: { top } } as IntersectionObserverEntry],
      new MockIntersectionObserver(() => {}),
    );
  });
}

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

function buildContent(overrides: Partial<SalonContent> = {}): SalonContent {
  return {
    ...EMPTY_SALON_CONTENT,
    identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Isla Nail Studio' },
    ...overrides,
  };
}

const TECHNICIAN_DANIELA = {
  id: 'tech-daniela',
  name: 'Daniela',
  bio: 'I focus on structure and long-term nail health.',
  avatarUrl: 'https://res.cloudinary.com/demo/image/upload/daniela.jpg',
  specialties: ['Russian manicure', 'BIAB'],
  languages: ['English', 'Russian'],
  rating: 4.9,
  reviewCount: 120,
  skillLevel: 'expert',
  acceptingNewClients: true,
};

describe('BookServiceClient — Editorial Luxury layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    observerCallback = null;
    navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a');
    salonContextMock.bookingPage = EDITORIAL_BOOKING_PAGE_SIDE;
    salonContextMock.salonContent = buildContent();
    salonContextMock.bookingExperience = null;
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the hero when a hero image is present', () => {
    salonContextMock.salonContent = buildContent({
      identity: {
        ...EMPTY_SALON_CONTENT.identity,
        name: 'Isla Nail Studio',
        heroImageUrl: 'https://example.com/hero.jpg',
        specialtyLine: 'Russian manicure & BIAB · Toronto',
      },
    });

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.getByTestId('editorial-hero')).toBeInTheDocument();
    expect(screen.getByTestId('editorial-hero-image')).toHaveAttribute('src', 'https://example.com/hero.jpg');
    expect(screen.getByTestId('editorial-specialty-line')).toHaveTextContent('Russian manicure & BIAB · Toronto');
    expect(screen.queryByTestId('booking-step-header')).not.toBeInTheDocument();
  });

  it('degrades to the Quick Book identity band when no hero image is set — never an empty frame', () => {
    salonContextMock.salonContent = buildContent({
      identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Isla Nail Studio', heroImageUrl: null },
    });

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.queryByTestId('editorial-hero')).not.toBeInTheDocument();
    expect(screen.getByTestId('booking-step-header')).toBeInTheDocument();
  });

  it('renders a working Skip-to-services anchor pointing at #services, and wraps the services section with that id', () => {
    salonContextMock.salonContent = buildContent({
      identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Isla Nail Studio', heroImageUrl: 'https://example.com/hero.jpg' },
    });

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    const skipLink = screen.getByTestId('editorial-skip-to-services');

    expect(skipLink).toHaveAttribute('href', '#services');
    expect(screen.getByTestId('editorial-hero-book-cta')).toHaveAttribute('href', '#services');

    const servicesSection = document.getElementById('services');

    expect(servicesSection).toBeInTheDocument();
    // The same engine block (search bar) renders inside the anchored wrapper.
    expect(within(servicesSection as HTMLElement).getByPlaceholderText('Search services...')).toBeInTheDocument();
  });

  it('never renders portfolio or reviews UI — PR4 SalonContent always returns them empty', () => {
    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.queryByTestId('editorial-portfolio')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editorial-reviews')).not.toBeInTheDocument();
    expect(screen.queryByText(/portfolio/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reviews/i)).not.toBeInTheDocument();
  });

  it('renders the About section from real technician bio/avatarUrl/specialties/languages', () => {
    salonContextMock.salonContent = buildContent({
      people: { technicians: [TECHNICIAN_DANIELA] },
    });

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    const about = screen.getByTestId('editorial-about');

    expect(within(about).getByText('Daniela')).toBeInTheDocument();
    expect(within(about).getByText(/Russian manicure/)).toBeInTheDocument();
    expect(within(about).getByText(/English/)).toBeInTheDocument();
    expect(within(about).getByText(/I focus on structure/)).toBeInTheDocument();
  });

  it('omits the About section when no technician has a bio or an avatar', () => {
    salonContextMock.salonContent = buildContent({
      people: {
        technicians: [
          { id: 't1', name: 'No Bio', bio: null, avatarUrl: null, specialties: [], languages: [], rating: null, reviewCount: 0, skillLevel: null, acceptingNewClients: true },
        ],
      },
    });

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.queryByTestId('editorial-about')).not.toBeInTheDocument();
  });

  it('renders the Visit section with location and entrance instructions when present', () => {
    salonContextMock.salonContent = buildContent({
      place: {
        locations: [],
        address: { address: '123 Queen St W', city: 'Toronto', state: 'ON', zipCode: 'M5V 1A1' },
        hours: { monday: { open: '10:00', close: '18:00' } },
        entranceInstructions: 'Buzz 4B, 2nd floor',
      },
    });

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.getByTestId('editorial-visit-address')).toHaveTextContent('123 Queen St W');
    expect(screen.getByTestId('editorial-visit-entrance')).toHaveTextContent('Buzz 4B, 2nd floor');
  });

  it('renders the Policies section when the policy is enabled with text', () => {
    salonContextMock.salonContent = buildContent({
      policies: {
        ...EMPTY_SALON_CONTENT.policies,
        policy: { ...EMPTY_SALON_CONTENT.policies.policy, enabled: true, text: '24h cancellation notice required.' },
      },
    });

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.getByTestId('editorial-policies')).toHaveTextContent('24h cancellation notice required.');
  });

  describe('sticky CTA handoff', () => {
    it('shows only the editorial sticky CTA before the services anchor is reached, even with a service pre-selected from the URL', () => {
      navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a&baseServiceId=svc-1');

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.getByTestId('editorial-sticky-cta')).toBeInTheDocument();
      expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
    });

    it('hands off to the sticky Continue bar once the services anchor is reached — the two are never both visible', async () => {
      navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a&baseServiceId=svc-1');

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      // Before: editorial CTA only.
      expect(screen.getByTestId('editorial-sticky-cta')).toBeInTheDocument();
      expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();

      // Simulate scrolling to/past #services (its top edge reaches the
      // viewport's top edge).
      fireAnchorIntersection(-10);

      await waitFor(() => {
        expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();
      });

      expect(screen.getByTestId('service-sticky-bar')).toBeInTheDocument();

      // Never both visible at once, in either state.
      expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();
    });

    it('shows neither sticky bar past the anchor when no service is selected', async () => {
      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      fireAnchorIntersection(-5);

      await waitFor(() => {
        expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();
      });

      expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
    });

    // Review finding (PR6, High): on a short page (small catalog, brief
    // bio, one address line, one policy sentence) the document may not have
    // enough scrollable height below #services for its top edge to ever
    // reach the threshold — not even by scrolling all the way to the
    // bottom. `fireAnchorIntersection` (used by the tests above) drives the
    // handoff via a synthetic IntersectionObserver entry and so cannot
    // exercise that geometry constraint at all. These tests instead stub
    // the real DOM geometry APIs the component reads
    // (`Element.scrollHeight`, `window.innerHeight`, `window.scrollY`,
    // `getBoundingClientRect`) to reproduce the actual failure mode: a real
    // Chromium/Playwright render of this page (baseServiceId in the URL,
    // scrolled to its absolute document bottom — scrollY 633 of a 633px
    // scrollable range) measured `#services.getBoundingClientRect().top`
    // at 215.75px, nowhere near the 24px threshold.
    describe('unreachable anchor on a short page (real-geometry regression, review finding)', () => {
      const SHORT_PAGE_INNER_HEIGHT = 667;
      const SHORT_PAGE_MAX_SCROLL = 633;

      function stubShortPageGeometry() {
        const originalInnerHeight = window.innerHeight;
        const originalScrollY = window.scrollY;
        const scrollHeightSpy = vi
          .spyOn(Element.prototype, 'scrollHeight', 'get')
          .mockReturnValue(SHORT_PAGE_INNER_HEIGHT + SHORT_PAGE_MAX_SCROLL);
        const rectSpy = vi
          .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
          .mockReturnValue({ top: 215.75 } as DOMRect);
        Object.defineProperty(window, 'innerHeight', {
          value: SHORT_PAGE_INNER_HEIGHT,
          configurable: true,
          writable: true,
        });
        Object.defineProperty(window, 'scrollY', {
          value: SHORT_PAGE_MAX_SCROLL,
          configurable: true,
          writable: true,
        });
        return () => {
          scrollHeightSpy.mockRestore();
          rectSpy.mockRestore();
          Object.defineProperty(window, 'innerHeight', {
            value: originalInnerHeight,
            configurable: true,
            writable: true,
          });
          Object.defineProperty(window, 'scrollY', {
            value: originalScrollY,
            configurable: true,
            writable: true,
          });
        };
      }

      it('shows the Continue bar immediately, never the dead jump link, when the anchor can never geometrically reach the threshold', () => {
        const restore = stubShortPageGeometry();
        navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a&baseServiceId=svc-1');

        try {
          render(
            <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
          );

          // No `fireAnchorIntersection` call anywhere in this test — the
          // handoff must happen from geometry alone, on mount, without ever
          // needing a "reached" intersection entry.
          expect(screen.getByTestId('service-sticky-bar')).toBeInTheDocument();
          expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();
        } finally {
          restore();
        }
      });

      it('ignores a stale "not reached" intersection entry once geometry has already forced the handoff', () => {
        const restore = stubShortPageGeometry();
        navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a&baseServiceId=svc-1');

        try {
          render(
            <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
          );

          expect(screen.getByTestId('service-sticky-bar')).toBeInTheDocument();

          // On an unreachable page the component never subscribes an
          // IntersectionObserver in the first place, so this is a no-op —
          // asserting that explicitly guards against a regression where a
          // late "not reached" observer callback could flip the handoff
          // back off and re-trap the user.
          expect(observerCallback).toBeNull();

          fireAnchorIntersection(215.75);

          expect(screen.getByTestId('service-sticky-bar')).toBeInTheDocument();
          expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();
        } finally {
          restore();
        }
      });

      it('does not affect the reachable case: a normal-length page still uses the geometry-driven intersection handoff', () => {
        // window.innerHeight/scrollY are left at jsdom defaults (0) here —
        // only scrollHeight/getBoundingClientRect are stubbed, to a page
        // whose anchor top-at-max-scroll comfortably clears the threshold.
        const scrollHeightSpy = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(2000);
        const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 10 } as DOMRect);
        navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a&baseServiceId=svc-1');

        try {
          render(
            <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
          );

          // Reachable: the component still waits for the real
          // intersection-observer-driven handoff rather than jumping
          // straight to the Continue bar.
          expect(screen.getByTestId('editorial-sticky-cta')).toBeInTheDocument();
          expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
        } finally {
          scrollHeightSpy.mockRestore();
          rectSpy.mockRestore();
        }
      });
    });
  });

  it('does not render the editorial sticky CTA or hero for the quick_book layout (regression guard)', () => {
    salonContextMock.bookingPage = { ...EDITORIAL_BOOKING_PAGE_SIDE, layout: 'quick_book' };

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.queryByTestId('editorial-hero')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();
    expect(screen.getByTestId('booking-step-header')).toBeInTheDocument();
  });

  describe('no duplicate content (regression guard — review finding, PR6)', () => {
    it('renders Featured/Signature services exactly once when featured services are configured, not both the engine carousel and the editorial section', () => {
      // `service` (the default fixture used across this file) already has
      // featuredOrder: 1, so the reused quick-book engine block's own
      // `featuredServices` (derived from the `services` prop) is non-empty
      // here too — exactly the real-world shape (SalonContent.catalog.
      // featuredServices is computed from the same services via the same
      // getFeaturedServices helper, see src/libs/salonContent.ts).
      salonContextMock.salonContent = buildContent({
        catalog: {
          ...EMPTY_SALON_CONTENT.catalog,
          featuredServices: [
            {
              id: service.id,
              name: service.name,
              description: service.description,
              durationMinutes: service.durationMinutes,
              priceCents: service.priceCents,
              priceDisplayText: service.priceDisplayText,
              category: service.category,
              bookingCategory: service.bookingCategory,
              imageUrl: service.imageUrl,
              featuredOrder: service.featuredOrder,
            },
          ],
        },
      });

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      // Editorial's own dedicated section renders.
      expect(screen.getByTestId('editorial-featured-services')).toBeInTheDocument();
      expect(screen.getByText('Signature services')).toBeInTheDocument();

      // The reused engine block's own carousel must NOT also render —
      // exactly one "Featured services" heading/carousel on the page, not
      // two independent sections built from the same underlying data.
      expect(screen.queryByTestId('featured-services-scroll')).not.toBeInTheDocument();
      expect(screen.queryByText('Featured services')).not.toBeInTheDocument();
      expect(screen.queryAllByTestId(`featured-service-card-${service.id}`)).toHaveLength(0);
    });

    it('renders the Policies section exactly once when the policy is enabled and shown on the service page', () => {
      salonContextMock.bookingExperience = {
        ...BASE_BOOKING_EXPERIENCE,
        policy: {
          ...BASE_BOOKING_EXPERIENCE.policy,
          enabled: true,
          showOnServicePage: true,
          text: '24h cancellation notice required.',
        },
      };
      salonContextMock.salonContent = buildContent({
        policies: {
          ...EMPTY_SALON_CONTENT.policies,
          policy: {
            ...EMPTY_SALON_CONTENT.policies.policy,
            enabled: true,
            showOnServicePage: true,
            text: '24h cancellation notice required.',
          },
        },
      });

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      // Editorial's own dedicated Policies section renders.
      expect(screen.getByTestId('editorial-policies')).toHaveTextContent('24h cancellation notice required.');

      // The reused engine block's own booking-policy card must NOT also
      // render — exactly one policy notice on the page.
      expect(screen.queryByTestId('booking-policy')).not.toBeInTheDocument();
      expect(screen.getAllByText('24h cancellation notice required.')).toHaveLength(1);
    });
  });
});
