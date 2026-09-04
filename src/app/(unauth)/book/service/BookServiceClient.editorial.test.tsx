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
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookingPageConfigSide } from '@/libs/bookingPageConfig';
import {
  BOOKING_PAGE_PRESET_RECIPES,
  type BookingPagePresetId,
} from '@/libs/bookingPagePresetRecipes';
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
  serviceMenuLayout: 'visual_grid',
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

const EDITORIAL_PRESET_IDS = [
  'signature',
  'menu',
  'collective',
] as const satisfies readonly BookingPagePresetId[];

function bookingPageSideForPreset(
  presetId: (typeof EDITORIAL_PRESET_IDS)[number],
): BookingPageConfigSide {
  const recipe = BOOKING_PAGE_PRESET_RECIPES[presetId];

  return {
    ...EDITORIAL_BOOKING_PAGE_SIDE,
    layout: recipe.layout,
    sectionOrder: [...recipe.sectionOrder],
    sectionVariants: { ...recipe.sectionVariants },
    hiddenSections: [...recipe.hiddenSections],
  };
}

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
    // The second (observer) argument is passed only to satisfy
    // IntersectionObserverCallback's signature — the component's callback
    // never reads it. Deliberately NOT `new MockIntersectionObserver(...)`
    // here: that constructor's whole job is capturing whatever callback it
    // is given into the shared `observerCallback` variable above, so
    // passing one as an argument here would silently overwrite
    // `observerCallback` with a no-op immediately after this call reads it
    // — turning every subsequent `fireAnchorIntersection` in the same test
    // into a silent no-op. A plain stub sidesteps that entirely.
    observerCallback?.(
      [{ boundingClientRect: { top } } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

// jsdom also has no ResizeObserver. Same capture-and-invoke pattern as
// MockIntersectionObserver above, used by the mount-time geometry race
// regression tests below (PR6 fix round: the ResizeObserver must now be
// attached unconditionally, and re-trigger the reachability check whenever
// it fires — not just once at mount).
let resizeObserverCallback: ResizeObserverCallback | null = null;

class MockResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback;
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

function fireResizeObserverCallback() {
  act(() => {
    // Plain stub, not `new MockResizeObserver(...)` — see the matching note
    // in `fireAnchorIntersection` above; the same constructor-capture
    // pattern would silently turn a second call in the same test into a
    // no-op.
    resizeObserverCallback?.([], {} as ResizeObserver);
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

const chromeAddOn = {
  id: 'addon-chrome',
  name: 'Chrome Finish',
  descriptionItems: ['Mirror shine'],
  category: 'nail_art' as const,
  pricingType: 'fixed' as const,
  unitLabel: null,
  maxQuantity: 1,
  durationMinutes: 10,
  priceCents: 1500,
  priceDisplayText: null,
  isActive: true,
};

const chromeAddOnRule = {
  id: 'rule-chrome',
  serviceId: service.id,
  addOnId: chromeAddOn.id,
  selectionMode: 'optional' as const,
  defaultQuantity: null,
  maxQuantityOverride: null,
  displayOrder: 1,
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
    resizeObserverCallback = null;
    navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a');
    salonContextMock.bookingPage = EDITORIAL_BOOKING_PAGE_SIDE;
    salonContextMock.salonContent = buildContent();
    salonContextMock.bookingExperience = null;
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('attests the completed canonical renderer movable order from Stage 2 and placement truth', () => {
    salonContextMock.bookingPage = {
      ...EDITORIAL_BOOKING_PAGE_SIDE,
      sectionOrder: [
        'salonProfile',
        'featuredServices',
        'technicianProfile',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    };
    salonContextMock.salonContent = buildContent({
      people: { technicians: [TECHNICIAN_DANIELA] },
      place: {
        ...EMPTY_SALON_CONTENT.place,
        address: {
          address: '100 King Street',
          city: 'Toronto',
          state: 'ON',
          zipCode: 'M5H 1J9',
        },
      },
      policies: {
        ...EMPTY_SALON_CONTENT.policies,
        policy: {
          ...EMPTY_SALON_CONTENT.policies.policy,
          enabled: true,
          text: '24h cancellation notice required.',
        },
      },
      social: {
        instagram: 'https://instagram.com/isla',
        facebook: null,
        tiktok: null,
      },
    });

    const embedded = render(
      <BookServiceClient
        services={[service]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
        isEmbeddedBuilderPreview
      />,
    );

    const attestation = embedded.container.querySelector(
      '[data-builder-reorderable-section-order]',
    );

    expect(attestation).toHaveAttribute(
      'data-builder-reorderable-section-order',
      'technicianProfile hoursLocation policies',
    );
    expect(attestation).toHaveAttribute('hidden');
    expect(attestation).toHaveAttribute('aria-hidden', 'true');

    embedded.unmount();

    const ordinary = render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(ordinary.container.querySelector('[data-builder-reorderable-section-order]'))
      .not.toBeInTheDocument();
  });

  it('renders structurally different identity variants from the same immutable canonical content', () => {
    const canonicalContent = buildContent({
      identity: {
        ...EMPTY_SALON_CONTENT.identity,
        name: 'Isla Nail Studio',
        heroImageUrl: 'https://example.com/hero.jpg',
        specialtyLine: 'Russian manicure & BIAB · Toronto',
      },
    });
    const snapshot = structuredClone(canonicalContent);
    salonContextMock.salonContent = canonicalContent;

    const first = render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.getByTestId('editorial-hero')).toBeInTheDocument();
    expect(screen.queryByTestId('booking-step-header')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search services...')).toBeInTheDocument();

    first.unmount();

    salonContextMock.bookingPage = {
      ...EDITORIAL_BOOKING_PAGE_SIDE,
      sectionVariants: { salonProfile: 'compact' },
    };
    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.queryByTestId('editorial-hero')).not.toBeInTheDocument();
    expect(screen.getByTestId('booking-step-header')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search services...')).toBeInTheDocument();
    expect(canonicalContent).toEqual(snapshot);
  });

  it('routes signature and carousel presentations of the same featured service through the shared renderer', () => {
    const canonicalFeaturedService = {
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
    };
    const canonicalContent = buildContent({
      catalog: {
        ...EMPTY_SALON_CONTENT.catalog,
        services: [canonicalFeaturedService],
        featuredServices: [canonicalFeaturedService],
      },
    });
    const snapshot = structuredClone(canonicalContent);
    salonContextMock.salonContent = canonicalContent;

    const first = render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.getByTestId('editorial-featured-services')).toBeInTheDocument();
    expect(screen.queryByTestId('featured-services-scroll')).not.toBeInTheDocument();

    first.unmount();

    salonContextMock.bookingPage = {
      ...EDITORIAL_BOOKING_PAGE_SIDE,
      sectionVariants: { featuredServices: 'carousel' },
    };
    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.queryByTestId('editorial-featured-services')).not.toBeInTheDocument();
    expect(screen.getByTestId('featured-services-scroll')).toBeInTheDocument();
    expect(screen.getByTestId(`featured-service-card-${service.id}`)).toHaveTextContent(service.name);
    expect(canonicalContent).toEqual(snapshot);
  });

  it('groups the same canonical services under semantic category headings without changing selection', () => {
    const pedicureService = {
      ...service,
      id: 'svc-pedicure',
      name: 'Spa Pedicure',
      descriptionItems: ['Restorative foot care'],
      durationMinutes: 60,
      priceCents: 6500,
      category: 'pedicure' as const,
      bookingCategory: 'pedicure' as const,
      featuredOrder: null,
    };
    const comboService = {
      ...service,
      id: 'svc-combo',
      name: 'Hands and Feet',
      descriptionItems: ['Coordinated manicure and pedicure'],
      durationMinutes: 120,
      priceCents: 14000,
      category: 'combo' as const,
      bookingCategory: 'combo' as const,
      featuredOrder: null,
    };
    const richServices = [service, pedicureService, comboService];
    const canonicalContent = buildContent({
      catalog: {
        ...EMPTY_SALON_CONTENT.catalog,
        services: richServices.map(item => ({
          id: item.id,
          name: item.name,
          description: item.description,
          durationMinutes: item.durationMinutes,
          priceCents: item.priceCents,
          priceDisplayText: item.priceDisplayText,
          category: item.category,
          bookingCategory: item.bookingCategory,
          imageUrl: item.imageUrl,
          featuredOrder: item.featuredOrder,
        })),
        featuredServices: [],
      },
    });
    const snapshot = structuredClone(canonicalContent);
    salonContextMock.salonContent = canonicalContent;
    salonContextMock.bookingPage = {
      ...EDITORIAL_BOOKING_PAGE_SIDE,
      serviceMenuLayout: 'category_menu',
      sectionVariants: { serviceMenu: 'grouped_categories' },
    };

    render(
      <BookServiceClient services={richServices} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Services' })).toBeInTheDocument();

    for (const [heading, id] of [
      ['Manicure', service.id],
      ['Pedicure', pedicureService.id],
      ['Combos', comboService.id],
    ] as const) {
      const group = screen.getByRole('group', { name: heading });

      expect(within(group).getByRole('heading', { level: 3, name: heading })).toBeInTheDocument();
      expect(within(group).getByTestId(`service-card-${id}`)).toBeInTheDocument();
    }

    expect(screen.queryByTestId('service-category-scroll')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`service-card-${pedicureService.id}`));

    expect(screen.getByTestId(`service-card-${pedicureService.id}`)).toHaveAttribute('aria-pressed', 'true');

    fireEvent.change(screen.getByPlaceholderText('Search services...'), {
      target: { value: 'Spa Pedicure' },
    });

    expect(screen.getByRole('group', { name: 'Pedicure' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Manicure' })).not.toBeInTheDocument();
    expect(canonicalContent).toEqual(snapshot);
  });

  it('renders full and card technician structures from the same public projection only', () => {
    const secondTechnician = {
      ...TECHNICIAN_DANIELA,
      id: 'tech-maya',
      name: 'Maya',
      bio: 'Known for precise natural-nail finishes.',
      avatarUrl: null,
      specialties: ['Natural nails'],
      languages: ['English'],
    };
    const canonicalContent = buildContent({
      people: {
        technicians: [
          { ...TECHNICIAN_DANIELA, email: 'private@example.test' },
          secondTechnician,
        ],
      },
    } as Partial<SalonContent>);
    const snapshot = structuredClone(canonicalContent);
    salonContextMock.salonContent = canonicalContent;

    const full = render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.getByTestId('editorial-about')).toHaveTextContent('Daniela');
    expect(screen.queryByTestId('technician-profile-cards')).not.toBeInTheDocument();

    full.unmount();

    salonContextMock.bookingPage = {
      ...EDITORIAL_BOOKING_PAGE_SIDE,
      sectionVariants: { technicianProfile: 'cards' },
    };
    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    const cards = screen.getByTestId('technician-profile-cards');

    expect(within(cards).getAllByRole('listitem')).toHaveLength(2);
    expect(within(cards).getByRole('heading', { level: 3, name: 'Daniela' })).toBeInTheDocument();
    expect(within(cards).getByRole('heading', { level: 3, name: 'Maya' })).toBeInTheDocument();
    expect(screen.queryByText('private@example.test')).not.toBeInTheDocument();
    expect(canonicalContent).toEqual(snapshot);
  });

  it('renders privacy-preserving location cards from the same canonical visit content', () => {
    const canonicalContent = buildContent({
      place: {
        ...EMPTY_SALON_CONTENT.place,
        locations: [{
          id: 'location-downtown',
          name: 'Downtown studio',
          address: '100 King Street',
          city: 'Toronto',
          state: 'ON',
          zipCode: 'M5H 1J9',
          phone: '+1 416 555 0100',
          isPrimary: true,
          hours: null,
        }],
        address: {
          address: '100 King Street',
          city: 'Toronto',
          state: 'ON',
          zipCode: 'M5H 1J9',
        },
        entranceInstructions: 'Use the east entrance.',
      },
    });
    const snapshot = structuredClone(canonicalContent);
    salonContextMock.salonContent = canonicalContent;
    salonContextMock.bookingPage = {
      ...EDITORIAL_BOOKING_PAGE_SIDE,
      sectionVariants: { hoursLocation: 'location_cards' },
    };

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    const cards = screen.getByTestId('location-cards');

    expect(within(cards).getByRole('listitem')).toHaveTextContent('Downtown studio');
    expect(within(cards).getByRole('listitem')).toHaveTextContent('100 King Street · Toronto · ON');
    expect(cards).toHaveTextContent('Use the east entrance.');
    expect(cards).not.toHaveTextContent('+1 416 555 0100');
    expect(cards).not.toHaveTextContent('M5H 1J9');
    expect(canonicalContent).toEqual(snapshot);
  });

  it('preserves canonical social destinations while switching from icons to labeled links', () => {
    const canonicalContent = buildContent({
      social: {
        instagram: 'https://instagram.com/isla',
        facebook: 'https://facebook.com/isla',
        tiktok: null,
      },
    });
    const snapshot = structuredClone(canonicalContent);
    salonContextMock.salonContent = canonicalContent;
    salonContextMock.bookingPage = {
      ...EDITORIAL_BOOKING_PAGE_SIDE,
      sectionOrder: [...EDITORIAL_BOOKING_PAGE_SIDE.sectionOrder, 'socialLinks'],
      sectionVariants: { socialLinks: 'labeled' },
    };

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    const social = screen.getByRole('navigation', { name: 'Salon social links' });

    expect(within(social).getByRole('link', { name: 'Visit Isla Nail Studio on Instagram' }))
      .toHaveAttribute('href', canonicalContent.social.instagram);
    expect(within(social).getByRole('link', { name: 'Visit Isla Nail Studio on Facebook' }))
      .toHaveAttribute('href', canonicalContent.social.facebook);
    expect(within(social).getByText('Instagram')).toBeVisible();
    expect(within(social).getByText('Facebook')).toBeVisible();
    expect(canonicalContent).toEqual(snapshot);
  });

  it('falls back to same-section Editorial defaults for unknown and wrong-section stored values', () => {
    salonContextMock.salonContent = buildContent({
      identity: {
        ...EMPTY_SALON_CONTENT.identity,
        name: 'Isla Nail Studio',
        heroImageUrl: 'https://example.com/hero.jpg',
      },
    });
    salonContextMock.bookingPage = {
      ...EDITORIAL_BOOKING_PAGE_SIDE,
      sectionVariants: {
        salonProfile: 'signature',
        serviceMenu: 'future_menu',
      } as BookingPageConfigSide['sectionVariants'],
    };

    render(
      <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
    );

    expect(screen.getByTestId('editorial-hero')).toBeInTheDocument();
    expect(document.getElementById('services')).toContainElement(screen.getByPlaceholderText('Search services...'));
  });

  it.each(['tech_profile', 'portfolio', 'catalogue'] as const)(
    'preserves Quick Book public behavior for the historical %s layout',
    (layout) => {
      salonContextMock.bookingPage = {
        ...EDITORIAL_BOOKING_PAGE_SIDE,
        layout,
        sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'],
      };

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.getByTestId('booking-step-header')).toBeInTheDocument();
      expect(screen.queryByTestId('editorial-hero')).not.toBeInTheDocument();
      expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText('Search services...')).toBeInTheDocument();
    },
  );

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
    expect(screen.getByTestId('editorial-hero-image')).toHaveAttribute('alt', 'Isla Nail Studio salon');
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

  // Post-launch fix regression coverage: the Visit section's guard used to
  // be a three-way AND (`!hasAddress && !hours && !entranceInstructions`)
  // even though the section body never rendered `hours` anywhere — a salon
  // with hours set but no address published `<h2>Visit</h2>` with nothing
  // beneath it. These six cases are the full matrix the repair's contract
  // calls for: hours+address, hours only, address only, neither, city_only,
  // full_address. None may ever leave an `<h2>Visit</h2>` frame with no
  // address/entrance paragraph under it.
  describe('Visit section (hoursLocation) — no empty frame across the hours/address matrix', () => {
    it('hours + address: renders the address paragraph', () => {
      salonContextMock.salonContent = buildContent({
        place: {
          locations: [],
          address: { address: '123 Queen St W', city: 'Toronto', state: 'ON', zipCode: 'M5V 1A1' },
          hours: { monday: { open: '10:00', close: '18:00' } },
          entranceInstructions: null,
        },
      });

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.getByTestId('editorial-visit')).toBeInTheDocument();
      expect(screen.getByTestId('editorial-visit-address')).toHaveTextContent('123 Queen St W · Toronto');
    });

    it('hours only, no address, no entrance instructions: omits the section entirely — never an empty <h2>Visit</h2> frame', () => {
      salonContextMock.salonContent = buildContent({
        place: {
          locations: [],
          address: null,
          hours: { monday: { open: '10:00', close: '18:00' } },
          entranceInstructions: null,
        },
      });

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      // The regression: this used to render `editorial-visit` with an <h2>
      // and nothing else, because `hours` alone satisfied the old guard.
      expect(screen.queryByTestId('editorial-visit')).not.toBeInTheDocument();
      expect(screen.queryByText('Visit')).not.toBeInTheDocument();
    });

    it('address only, no hours: renders the address paragraph', () => {
      salonContextMock.salonContent = buildContent({
        place: {
          locations: [],
          address: { address: '123 Queen St W', city: 'Toronto', state: 'ON', zipCode: 'M5V 1A1' },
          hours: null,
          entranceInstructions: null,
        },
      });

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.getByTestId('editorial-visit')).toBeInTheDocument();
      expect(screen.getByTestId('editorial-visit-address')).toHaveTextContent('123 Queen St W · Toronto');
    });

    it('neither address, hours, nor entrance instructions: omits the section entirely', () => {
      salonContextMock.salonContent = buildContent({
        place: { locations: [], address: null, hours: null, entranceInstructions: null },
      });

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.queryByTestId('editorial-visit')).not.toBeInTheDocument();
    });

    it('city_only: street address nulled but city survives — still renders (home/private studios stay coherent)', () => {
      salonContextMock.salonContent = buildContent({
        place: {
          locations: [],
          // Mirrors applyLocationDisplayMode's city_only projection
          // (@/libs/salonContent): address/zipCode nulled, city untouched.
          address: { address: null, city: 'Toronto', state: 'ON', zipCode: null },
          hours: { monday: { open: '10:00', close: '18:00' } },
          entranceInstructions: null,
        },
      });

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.getByTestId('editorial-visit')).toBeInTheDocument();
      expect(screen.getByTestId('editorial-visit-address')).toHaveTextContent('Toronto');
      expect(screen.getByTestId('editorial-visit-address')).not.toHaveTextContent('123 Queen St W');
    });

    it('full_address: street, city, state, and zip all present — renders the full address text', () => {
      salonContextMock.salonContent = buildContent({
        place: {
          locations: [],
          address: { address: '123 Queen St W', city: 'Toronto', state: 'ON', zipCode: 'M5V 1A1' },
          hours: null,
          entranceInstructions: null,
        },
      });

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.getByTestId('editorial-visit')).toBeInTheDocument();
      expect(screen.getByTestId('editorial-visit-address')).toHaveTextContent('123 Queen St W · Toronto');
    });
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

  // Post-launch fix regression coverage: `hiddenSections` used to be written
  // by the admin surface and validated, but nothing in the render path ever
  // read it — every fixture above uses the default `hiddenSections: []` on
  // EDITORIAL_BOOKING_PAGE_SIDE, which is exactly why this shipped broken.
  // Editorial is where the bug bit hardest: it has dedicated renderers for
  // all four of these ids.
  describe('hiddenSections (post-launch fix)', () => {
    it('hides the Visit section (hoursLocation) when hidden, even with real address/hours data', () => {
      salonContextMock.bookingPage = { ...EDITORIAL_BOOKING_PAGE_SIDE, hiddenSections: ['hoursLocation'] };
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

      expect(screen.queryByTestId('editorial-visit')).not.toBeInTheDocument();
      expect(screen.queryByTestId('editorial-visit-address')).not.toBeInTheDocument();
    });

    it('hides the Policies section when hidden, even with policy enabled and text present', () => {
      salonContextMock.bookingPage = { ...EDITORIAL_BOOKING_PAGE_SIDE, hiddenSections: ['policies'] };
      salonContextMock.salonContent = buildContent({
        policies: {
          ...EMPTY_SALON_CONTENT.policies,
          policy: { ...EMPTY_SALON_CONTENT.policies.policy, enabled: true, text: '24h cancellation notice required.' },
        },
      });

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.queryByTestId('editorial-policies')).not.toBeInTheDocument();
      expect(screen.queryByText('24h cancellation notice required.')).not.toBeInTheDocument();
    });

    it('hides the Signature services section (featuredServices) when hidden, even with featured services present', () => {
      salonContextMock.bookingPage = { ...EDITORIAL_BOOKING_PAGE_SIDE, hiddenSections: ['featuredServices'] };
      salonContextMock.salonContent = buildContent({
        catalog: {
          ...EMPTY_SALON_CONTENT.catalog,
          featuredServices: [{ id: 'svc-1', name: 'Signature Gel-X', description: null, durationMinutes: 90, priceCents: 9000, priceDisplayText: null, category: 'extensions', bookingCategory: 'manicure', imageUrl: null, featuredOrder: 1 }],
        },
      });

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.queryByTestId('editorial-featured-services')).not.toBeInTheDocument();
      expect(screen.queryByText('Signature services')).not.toBeInTheDocument();
    });

    it('hides the About section (technicianProfile) when hidden, even with a technician bio present', () => {
      salonContextMock.bookingPage = { ...EDITORIAL_BOOKING_PAGE_SIDE, hiddenSections: ['technicianProfile'] };
      salonContextMock.salonContent = buildContent({
        people: { technicians: [TECHNICIAN_DANIELA] },
      });

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.queryByTestId('editorial-about')).not.toBeInTheDocument();
      expect(screen.queryByText('Daniela')).not.toBeInTheDocument();
    });

    // Repair A4 regression coverage: `salonProfile` hosts the page's only
    // <h1> on both layouts. The actual "cannot be hidden by a crafted PATCH
    // / stale hiddenSections" proof lives in bookingPageConfig.test.ts's
    // full-pipeline describe block — `salonProfile` is stripped from
    // hiddenSections and repaired into sectionOrder by `validateSectionOrder`
    // (@/libs/bookingPageConfig) before a real `bookingPage` ever reaches
    // this component, exactly like `serviceMenu`/`bookingCta` already were.
    // Mirroring that existing test's own architecture note (this
    // component/`resolveVisibleSectionOrder` deliberately does NOT
    // re-implement that floor as a second rule), these two tests instead
    // confirm the two Editorial `salonProfile` renderer paths (hero,
    // no-hero fallback) each still produce exactly one page-level <h1> when
    // OTHER sections are hidden around it — the defense-in-depth shape the
    // existing "serviceMenu ... is never suppressed even if hiddenSections
    // is malformed" test in BookServiceClient.hiddenSections.test.tsx uses.
    it('salonProfile (hero path) still renders — and is the page\'s only <h1> — while other sections are hidden', () => {
      salonContextMock.bookingPage = {
        ...EDITORIAL_BOOKING_PAGE_SIDE,
        hiddenSections: ['featuredServices', 'technicianProfile', 'hoursLocation', 'policies'],
      };
      salonContextMock.salonContent = buildContent({
        identity: {
          ...EMPTY_SALON_CONTENT.identity,
          name: 'Isla Nail Studio',
          heroImageUrl: 'https://example.com/hero.jpg',
        },
      });

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.getByTestId('editorial-hero')).toBeInTheDocument();
      expect(document.querySelectorAll('h1')).toHaveLength(1);
    });

    it('salonProfile (no-hero fallback path) still renders — and is the page\'s only <h1> — while other sections are hidden', () => {
      salonContextMock.bookingPage = {
        ...EDITORIAL_BOOKING_PAGE_SIDE,
        hiddenSections: ['featuredServices', 'technicianProfile', 'hoursLocation', 'policies'],
      };
      salonContextMock.salonContent = buildContent({
        identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Isla Nail Studio', heroImageUrl: null },
      });

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.queryByTestId('editorial-hero')).not.toBeInTheDocument();
      // BookingStepHeader (the fallback's actual <h1> host) is mocked in
      // this file — its presence is the observable proxy that salonProfile
      // still rendered.
      expect(screen.getByTestId('booking-step-header')).toBeInTheDocument();
    });

    it('un-hiding restores the section — hiding is not a permanent content loss', () => {
      salonContextMock.bookingPage = { ...EDITORIAL_BOOKING_PAGE_SIDE, hiddenSections: ['policies'] };
      salonContextMock.salonContent = buildContent({
        policies: {
          ...EMPTY_SALON_CONTENT.policies,
          policy: { ...EMPTY_SALON_CONTENT.policies.policy, enabled: true, text: '24h cancellation notice required.' },
        },
      });

      const { rerender } = render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.queryByTestId('editorial-policies')).not.toBeInTheDocument();

      salonContextMock.bookingPage = { ...EDITORIAL_BOOKING_PAGE_SIDE, hiddenSections: [] };
      rerender(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.getByTestId('editorial-policies')).toHaveTextContent('24h cancellation notice required.');
    });

    it('never renders portfolio/reviews UI regardless of hiddenSections — canRender already omits them independently', () => {
      salonContextMock.bookingPage = { ...EDITORIAL_BOOKING_PAGE_SIDE, hiddenSections: [] };

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.queryByTestId('editorial-portfolio')).not.toBeInTheDocument();
      expect(screen.queryByTestId('editorial-reviews')).not.toBeInTheDocument();
    });
  });

  describe('sticky CTA handoff', () => {
    it.each(EDITORIAL_PRESET_IDS)(
      '%s replaces discovery with the selected-service summary and preserves add-ons through Continue',
      async (presetId) => {
        salonContextMock.bookingPage = bookingPageSideForPreset(presetId);

        render(
          <BookServiceClient
            services={[service]}
            addOns={[chromeAddOn]}
            serviceAddOnRules={[chromeAddOnRule]}
            bookingFlow={['service', 'tech', 'time', 'confirm']}
            locations={[]}
          />,
        );

        expect(screen.getByTestId('editorial-sticky-cta')).toHaveTextContent('Book appointment');
        expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();

        // Selection happens while the services anchor is still below the
        // handoff threshold: no observer callback has fired in this test.
        fireEvent.click(screen.getByTestId(`service-card-${service.id}`));

        const selectedSummary = screen.getByTestId('service-sticky-bar');

        expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();
        expect(within(selectedSummary).getByText('1 service')).toBeInTheDocument();
        expect(within(selectedSummary).getByText('$90')).toBeInTheDocument();
        expect(within(selectedSummary).getByText('1h 30m')).toBeInTheDocument();
        expect(within(selectedSummary).getByRole('button', { name: /Continue/i })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Add Chrome Finish' }));

        await waitFor(() => {
          expect(within(selectedSummary).getByText('1 service + 1 add-on')).toBeInTheDocument();
          expect(within(selectedSummary).getByText('$105')).toBeInTheDocument();
          expect(within(selectedSummary).getByText('1h 40m')).toBeInTheDocument();
        });

        fireEvent.click(within(selectedSummary).getByRole('button', { name: /Continue/i }));

        const nextUrl = new URL(
          navigationMock.routerPush.mock.calls.at(-1)?.[0] as string,
          'https://example.test',
        );

        expect(nextUrl.pathname).toBe('/en/salon-a/book/tech');
        expect(nextUrl.searchParams.get('baseServiceId')).toBe(service.id);
        expect(JSON.parse(nextUrl.searchParams.get('selectedAddOns') ?? 'null')).toEqual([
          { addOnId: chromeAddOn.id, quantity: 1 },
        ]);
      },
    );

    it('shows the selected-service summary immediately for URL-restored state and keeps it while scrolling', () => {
      navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a&baseServiceId=svc-1');

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();
      expect(screen.getByTestId('service-sticky-bar')).toBeInTheDocument();

      fireAnchorIntersection(-10);

      expect(screen.getByTestId('service-sticky-bar')).toBeInTheDocument();
      expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();

      fireAnchorIntersection(300);

      expect(screen.getByTestId('service-sticky-bar')).toBeInTheDocument();
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

      it('shows the selected-service summary immediately when the anchor can never geometrically reach the threshold', () => {
        const restore = stubShortPageGeometry();
        navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a&baseServiceId=svc-1');

        try {
          render(
            <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
          );

          // No `fireAnchorIntersection` call anywhere in this test: active
          // selection alone must take precedence over the jump-link CTA.
          expect(screen.getByTestId('service-sticky-bar')).toBeInTheDocument();
          expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();
        } finally {
          restore();
        }
      });

      // Review finding (PR6, High, fixed): reproduced against a real
      // disposable Postgres + real Chromium (Playwright) on the seeded
      // fixture salon at 375x812 — on fresh page load (scrollY 0) and again
      // after scrolling to #services, BOTH `editorial-sticky-cta` and
      // `service-sticky-bar` were null. Root cause: the geometry-unreachable
      // fallback used to force `hasReachedServicesAnchor` true unconditionally,
      // which hid the jump-link CTA, but the Continue bar it was supposed to
      // hand off to is separately gated on `selectedService` — and every
      // first-time visitor starts with no service selected. Unlike the test
      // above, this one deliberately omits `baseServiceId` from the URL, so
      // `selectedService` is null throughout — the exact "nothing to tap"
      // path the invariant promises a fallback for.
      it('keeps the editorial jump CTA visible (never zero sticky CTAs) when the anchor is geometrically unreachable and no service is selected yet', () => {
        const restore = stubShortPageGeometry();

        try {
          render(
            <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
          );

          // The Continue bar has nothing to continue — no service is
          // selected — so it must not render, but the jump-link CTA must
          // fill in rather than leaving zero sticky CTAs visible.
          expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
          expect(screen.getByTestId('editorial-sticky-cta')).toBeInTheDocument();

          // Even a stale/absent intersection reading must not clear it —
          // there is still no selection, so the jump link must persist.
          fireAnchorIntersection(215.75);

          expect(screen.getByTestId('editorial-sticky-cta')).toBeInTheDocument();
          expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
        } finally {
          restore();
        }
      });

      it('keeps the observer subscribed on an unreachable page without letting a stale entry replace the selected summary', () => {
        const restore = stubShortPageGeometry();
        navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a&baseServiceId=svc-1');

        try {
          render(
            <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
          );

          expect(screen.getByTestId('service-sticky-bar')).toBeInTheDocument();

          // Fixed behaviour (PR6 High finding): the IntersectionObserver is
          // now ALWAYS attached, even when the very first geometry
          // measurement says "unreachable" — attaching it independently of
          // that first measurement is exactly what lets a later geometry
          // change (the page growing enough to become reachable) still be
          // observed, instead of a one-way flag permanently skipping
          // observer setup the moment the first read comes back negative.
          expect(observerCallback).not.toBeNull();

          // Selection presentation is independent of the stale geometry
          // reading, so the summary never flips back to the jump link.
          fireAnchorIntersection(215.75);

          expect(screen.getByTestId('service-sticky-bar')).toBeInTheDocument();
          expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();
        } finally {
          restore();
        }
      });

      it('keeps discovery visible on a reachable page until the services anchor is actually reached', () => {
        // window.innerHeight/scrollY are left at jsdom defaults (0) here —
        // only scrollHeight/getBoundingClientRect are stubbed, to a page
        // whose anchor top-at-max-scroll comfortably clears the threshold.
        const scrollHeightSpy = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(2000);
        const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 10 } as DOMRect);
        try {
          render(
            <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
          );

          // Reachability alone does not imply that the visitor has reached
          // the service controls, so discovery remains available.
          expect(screen.getByTestId('editorial-sticky-cta')).toBeInTheDocument();
          expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();

          fireAnchorIntersection(-10);

          // There is no selected service to summarize after the discovery
          // CTA hands off at the actual anchor.
          expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();
          expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
        } finally {
          scrollHeightSpy.mockRestore();
          rectSpy.mockRestore();
        }
      });
    });

    // PR6 fix round regression: the live, 3-times-reproduced High bug. Real
    // Playwright numbers — a page measured 1773px tall at mount (before its
    // hero image had finished loading) and 1849px once the layout settled.
    // The bug was not the geometry formula itself (already covered above);
    // it was that the FIRST measurement, taken before layout settles, used
    // to set a one-way `unreachable` flag that skipped observer setup
    // entirely, so the later 1849px measurement was never taken at all.
    describe('mount-time geometry race and post-mount recalculation (PR6 fix round regression)', () => {
      const VIEWPORT_INNER_HEIGHT = 812;

      function stubGeometry({
        scrollHeight,
        rectTop,
        innerHeight = VIEWPORT_INNER_HEIGHT,
        scrollY = 0,
      }: {
        scrollHeight: number;
        rectTop: number;
        innerHeight?: number;
        scrollY?: number;
      }) {
        const scrollHeightSpy = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
        const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: rectTop } as DOMRect);
        const originalInnerHeight = window.innerHeight;
        const originalScrollY = window.scrollY;
        Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true, writable: true });
        Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true, writable: true });

        return {
          setScrollHeight: (value: number) => scrollHeightSpy.mockReturnValue(value),
          setInnerHeight: (value: number) => {
            Object.defineProperty(window, 'innerHeight', { value, configurable: true, writable: true });
          },
          restore: () => {
            scrollHeightSpy.mockRestore();
            rectSpy.mockRestore();
            Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true, writable: true });
            Object.defineProperty(window, 'scrollY', { value: originalScrollY, configurable: true, writable: true });
          },
        };
      }

      const assertSelectedSummaryIsOnlyStickyCta = () => {
        const editorialCta = screen.queryByTestId('editorial-sticky-cta');
        const continueBar = screen.queryByTestId('service-sticky-bar');

        expect(continueBar).toBeInTheDocument();
        expect(editorialCta).not.toBeInTheDocument();
        expect([editorialCta, continueBar].filter(Boolean)).toHaveLength(1);
      };

      it('recovers from a false-negative mount measurement once the page grows enough (real repro: 1773px -> 1849px)', () => {
        const geometry = stubGeometry({ scrollHeight: 1773, rectTop: 1000 });

        try {
          render(
            <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
          );

          // With no selection, discovery remains visible even when the
          // mount-time geometry says the anchor is unreachable.
          expect(screen.getByTestId('editorial-sticky-cta')).toBeInTheDocument();
          expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();

          // The ResizeObserver must already be attached at this point — the
          // fix requirement is that it is attached independently of the
          // first measurement's result, not only when that first
          // measurement happens to succeed.
          expect(resizeObserverCallback).not.toBeNull();

          // The page settles (hero image finishes loading / fonts swap in /
          // content reflows) and grows to the real repro's 1849px. The
          // ResizeObserver callback is triggered explicitly here, not just
          // the underlying value changed silently.
          geometry.setScrollHeight(1849);
          fireResizeObserverCallback();

          // The anchor is now reachable, but discovery remains until a real
          // intersection says that the visitor reached the controls.
          expect(screen.getByTestId('editorial-sticky-cta')).toBeInTheDocument();
          expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();

          // And the ordinary intersection-driven handoff resumes correctly
          // from there, exactly as on any normal-length page.
          fireAnchorIntersection(-10);

          expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();
          expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
        } finally {
          geometry.restore();
        }
      });

      it('keeps the selected-service summary when a resize-triggered recheck still finds the page too short', () => {
        navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a&baseServiceId=svc-1');
        const geometry = stubGeometry({ scrollHeight: 1773, rectTop: 1200 });

        try {
          render(
            <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
          );

          expect(screen.getByTestId('service-sticky-bar')).toBeInTheDocument();
          expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();

          // Modest growth, still nowhere near enough to make the anchor
          // reachable — presentation must not flip just because a recheck
          // happened.
          geometry.setScrollHeight(1800);
          fireResizeObserverCallback();

          expect(screen.getByTestId('service-sticky-bar')).toBeInTheDocument();
          expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();
        } finally {
          geometry.restore();
        }
      });

      it('recalculates on a viewport resize occurring after mount (window "resize" event, not just content growth)', () => {
        // A short page (700px) that already fits within a tall 812px
        // viewport — there is no room to scroll at all, so the anchor
        // (100px down) is genuinely unreachable.
        const geometry = stubGeometry({ scrollHeight: 700, rectTop: 100, innerHeight: 812 });

        try {
          render(
            <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
          );

          expect(screen.getByTestId('editorial-sticky-cta')).toBeInTheDocument();
          expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();

          // Even an intersection reading at the threshold cannot clear the
          // discovery fallback while geometry still says it is unreachable.
          fireAnchorIntersection(-5);

          expect(screen.getByTestId('editorial-sticky-cta')).toBeInTheDocument();

          // The viewport shrinks after mount (on-screen keyboard opening,
          // browser chrome changing, or an actual window resize) — the page
          // now has scrollable room below the anchor, so it becomes
          // reachable. Driven through `window.addEventListener('resize', ...)`
          // specifically, not the ResizeObserver.
          geometry.setInnerHeight(400);
          act(() => {
            window.dispatchEvent(new Event('resize'));
          });

          expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();
          expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
        } finally {
          geometry.restore();
        }
      });

      it('never shows both sticky elements at once, and never shows neither while a service is selected, across the full mount -> grow -> scroll sequence', () => {
        navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a&baseServiceId=svc-1');
        const geometry = stubGeometry({ scrollHeight: 1773, rectTop: 1000 });

        try {
          render(
            <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
          );

          assertSelectedSummaryIsOnlyStickyCta();

          geometry.setScrollHeight(1849);
          fireResizeObserverCallback();
          assertSelectedSummaryIsOnlyStickyCta();

          fireAnchorIntersection(-10);
          assertSelectedSummaryIsOnlyStickyCta();
        } finally {
          geometry.restore();
        }
      });

      // Real-Chromium finding from this fix round's own verification pass
      // (not reproducible with a synthetic entry alone, so documented here
      // as the reasoning + the piece that IS unit-testable): a plain
      // `threshold: [0, 1]` IntersectionObserver only notifies at the
      // anchor's full enter/exit of the viewport. #services is frequently
      // SHORTER than the viewport (a search bar plus a handful of cards),
      // so once fully visible it can keep scrolling — top edge moving from
      // e.g. 135px to 16px — without ever crossing another threshold,
      // silently skipping the exact crossing this feature needs to detect.
      // The fix uses a `rootMargin`-shrunk observer instead (verified live
      // against a real Chromium render); what a jsdom unit test CAN verify
      // is the arithmetic this relies on once a reading arrives: `<=
      // SERVICES_ANCHOR_SCROLL_MARGIN_PX`, not `isIntersecting`, is what
      // keeps "reached" correctly persisting after scrolling further past
      // the anchor (its top only gets more negative) while still correctly
      // reverting if the user scrolls back up above it.
      it('keeps reporting reached after scrolling further past the anchor, and restores discovery if scrolled back above it without a selection', () => {
        render(
          <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
        );

        // Scrolled to the anchor: reached.
        fireAnchorIntersection(16);

        expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
        expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();

        // Scrolled well past it (its top is now far above the viewport,
        // deep negative) — must still read as reached, not revert.
        fireAnchorIntersection(-900);

        expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
        expect(screen.queryByTestId('editorial-sticky-cta')).not.toBeInTheDocument();

        // Scrolled back up above the anchor — correctly reverts.
        fireAnchorIntersection(300);

        expect(screen.getByTestId('editorial-sticky-cta')).toBeInTheDocument();
        expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
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

    // Post-launch fix (repair A3): Editorial's dedicated Policies renderer
    // used to check only `policy.enabled && policy.text`, ignoring
    // `showOnServicePage` — Quick Book's embedded policy card already
    // honoured it (see BookServiceClient.hiddenSections.test.tsx's positive
    // control). An owner who turned "show on service page" off was obeyed on
    // Quick Book and silently ignored on Editorial.
    it('omits the Policies section when showOnServicePage is false, even with the policy enabled and text present', () => {
      salonContextMock.bookingExperience = {
        ...BASE_BOOKING_EXPERIENCE,
        policy: {
          ...BASE_BOOKING_EXPERIENCE.policy,
          enabled: true,
          showOnServicePage: false,
          text: '24h cancellation notice required.',
        },
      };
      salonContextMock.salonContent = buildContent({
        policies: {
          ...EMPTY_SALON_CONTENT.policies,
          policy: {
            ...EMPTY_SALON_CONTENT.policies.policy,
            enabled: true,
            showOnServicePage: false,
            text: '24h cancellation notice required.',
          },
        },
      });

      render(
        <BookServiceClient services={[service]} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[]} />,
      );

      expect(screen.queryByTestId('editorial-policies')).not.toBeInTheDocument();
      expect(screen.queryByText('24h cancellation notice required.')).not.toBeInTheDocument();
    });
  });
});
