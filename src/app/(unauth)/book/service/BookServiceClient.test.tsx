import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { getBookingExperienceCssVariables } from '@/libs/bookingExperience';
import type { BookingExperience } from '@/types/salonPolicy';

import { BookServiceClient } from './BookServiceClient';

const {
  bookingStateMock,
  clientSessionMock,
  navigationMock,
  salonContextMock,
  salonProviderPropsMock,
} = vi.hoisted(() => ({
  bookingStateMock: {
    values: {
      technicianId: null as string | null,
      technicianSelectionSource: null as 'explicit' | 'auto' | null,
      baseServiceId: null as string | null,
      selectedAddOns: [] as { addOnId: string; quantity?: number }[],
      locationId: null as string | null,
      isHydrated: true,
    },
    setTechnicianId: vi.fn(),
    setBaseServiceId: vi.fn(),
    setSelectedAddOns: vi.fn(),
    setServiceIds: vi.fn(),
    setLocationId: vi.fn(),
    syncFromUrl: vi.fn(),
  },
  clientSessionMock: {
    isLoggedIn: false,
    isCheckingSession: false,
    handleLoginSuccess: vi.fn(),
  },
  navigationMock: {
    routerBack: vi.fn(),
    routerPush: vi.fn(),
    searchParams: new URLSearchParams('salonSlug=salon-a'),
  },
  salonContextMock: {
    bookingPage: {
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
        version: 1 as const,
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
    },
    bookingExperience: {
      primaryColor: null as string | null,
      bookingMessage: null as string | null,
      policy: {
        enabled: false,
        title: null as string | null,
        text: null as string | null,
        showOnServicePage: true,
        showBeforeConfirmation: true,
        showAfterConfirmation: true,
        showInConfirmationEmail: true,
      },
      quickFacts: {
        appointmentOnly: {
          enabled: false,
          label: null as string | null,
        },
        depositNotice: {
          enabled: false,
          label: null as string | null,
        },
        cancellationNotice: {
          enabled: false,
          label: null as string | null,
        },
      },
      socialLinks: {
        instagram: null as string | null,
        facebook: null as string | null,
        tiktok: null as string | null,
      },
      confirmationMessage: null as string | null,
    },
  },
  salonProviderPropsMock: {
    bookingExperience: null as unknown,
  },
}));

const DEFAULT_BOOKING_EXPERIENCE: BookingExperience = {
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
    appointmentOnly: {
      enabled: false,
      label: null,
    },
    depositNotice: {
      enabled: false,
      label: null,
    },
    cancellationNotice: {
      enabled: false,
      label: null,
    },
  },
  socialLinks: {
    instagram: null,
    facebook: null,
    tiktok: null,
  },
  confirmationMessage: null,
};

const CONFIGURED_BOOKING_EXPERIENCE: BookingExperience = {
  primaryColor: '#123456',
  bookingMessage: 'Welcome to online booking.',
  policy: {
    enabled: true,
    title: 'Before you book',
    text: 'Please arrive five minutes early.',
    showOnServicePage: true,
    showBeforeConfirmation: true,
    showAfterConfirmation: true,
    showInConfirmationEmail: true,
  },
  quickFacts: {
    appointmentOnly: {
      enabled: true,
      label: 'Appointment only',
    },
    depositNotice: {
      enabled: false,
      label: null,
    },
    cancellationNotice: {
      enabled: false,
      label: null,
    },
  },
  socialLinks: {
    instagram: 'https://instagram.com/salon-a',
    facebook: 'https://www.facebook.com/salon-a',
    tiktok: null,
  },
  confirmationMessage: 'We look forward to seeing you.',
};

vi.mock('next/image', () => ({
  default: ({
    alt,
    src,
    className,
    onError,
    'data-testid': dataTestId,
  }: React.ImgHTMLAttributes<HTMLImageElement> & { 'src'?: string; 'data-testid'?: string }) => (
    <img
      alt={alt}
      src={src}
      className={className}
      data-testid={dataTestId}
      onError={onError}
    />
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: navigationMock.routerBack,
    push: navigationMock.routerPush,
  }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => navigationMock.searchParams,
}));

vi.mock('@/components/BlockingLoginModal', () => ({
  BlockingLoginModal: () => null,
}));

vi.mock('@/components/booking/BookingStepHeader', () => ({
  BookingStepHeader: ({
    bookingFlow,
    salonNameVariant,
    announcement,
  }: {
    bookingFlow: string[];
    salonNameVariant?: string;
    announcement?: React.ReactNode;
  }) => (
    <div>
      <div data-testid="booking-step-header">{bookingFlow.join(' > ')}</div>
      {salonNameVariant && <div data-testid="booking-step-header-salon-variant">{salonNameVariant}</div>}
      {announcement && <div data-testid="booking-step-header-announcement">{announcement}</div>}
    </div>
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
    isLoggedIn: clientSessionMock.isLoggedIn,
    isCheckingSession: clientSessionMock.isCheckingSession,
    handleLoginSuccess: clientSessionMock.handleLoginSuccess,
  }),
}));

vi.mock('@/hooks/useBookingState', () => ({
  useBookingState: () => ({
    technicianId: bookingStateMock.values.technicianId,
    technicianSelectionSource: bookingStateMock.values.technicianSelectionSource,
    baseServiceId: bookingStateMock.values.baseServiceId,
    selectedAddOns: bookingStateMock.values.selectedAddOns,
    locationId: bookingStateMock.values.locationId,
    isHydrated: bookingStateMock.values.isHydrated,
    setTechnicianId: bookingStateMock.setTechnicianId,
    setBaseServiceId: bookingStateMock.setBaseServiceId,
    setSelectedAddOns: bookingStateMock.setSelectedAddOns,
    setServiceIds: bookingStateMock.setServiceIds,
    setLocationId: bookingStateMock.setLocationId,
    syncFromUrl: bookingStateMock.syncFromUrl,
  }),
}));

vi.mock('@/libs/haptics', () => ({
  triggerHaptic: vi.fn(),
}));

// This file renders the REAL `PublicSalonPageShell`, which now resolves
// `bookingPageContent` itself (post-launch privacy fix). That module starts
// with `import 'server-only'` (transitively `@/libs/DB`) — mocked here for
// the same reason `book/service/page.test.tsx` mocks it, so this
// component-level test never touches the real DB module. The mocked
// `SalonProvider` below discards `salonContent` entirely (its own `useSalon`
// stub never exposes it), so the exact return value here is inert for every
// assertion in this file — only its presence (preventing the real,
// DB-importing module from loading) matters.
vi.mock('@/libs/bookingPageContent', () => ({
  resolveBookingPageContent: vi.fn(() => ({
    version: 1,
    draft: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' },
    live: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' },
  })),
}));

vi.mock('@/providers/SalonProvider', () => ({
  SalonProvider: ({
    bookingExperience,
    children,
  }: {
    bookingExperience: unknown;
    children: React.ReactNode;
  }) => {
    salonProviderPropsMock.bookingExperience = bookingExperience;
    salonContextMock.bookingExperience = bookingExperience as BookingExperience;
    return children;
  },
  useSalon: () => ({
    bookingExperience: salonContextMock.bookingExperience,
    bookingPage: salonContextMock.bookingPage,
    salonName: 'Salon A',
    salonSlug: 'salon-a',
  }),
}));

function resetBookingExperienceMock() {
  salonProviderPropsMock.bookingExperience = null;
  salonContextMock.bookingExperience = {
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
      appointmentOnly: {
        enabled: false,
        label: null,
      },
      depositNotice: {
        enabled: false,
        label: null,
      },
      cancellationNotice: {
        enabled: false,
        label: null,
      },
    },
    socialLinks: {
      instagram: null,
      facebook: null,
      tiktok: null,
    },
    confirmationMessage: null,
  };
  salonContextMock.bookingPage.layout = 'quick_book';
  salonContextMock.bookingPage.serviceMenuLayout = 'visual_grid';
  delete (salonContextMock.bookingPage as { sitePalettePreset?: string }).sitePalettePreset;
  delete (salonContextMock.bookingPage as { siteStylePreset?: string }).siteStylePreset;
  salonContextMock.bookingPage.sectionOrder = [
    'salonProfile',
    'serviceMenu',
    'featuredServices',
    'policies',
    'socialLinks',
    'bookingCta',
  ];
  salonContextMock.bookingPage.sectionVariants = {};
  salonContextMock.bookingPage.hiddenSections = [];
  salonContextMock.bookingPage.quickBookProfile.version = 1;
}

function getRenderedBookingSteps(): string[] {
  return screen.getAllByTestId(/^booking-step-marker-/).map(element => (
    element.getAttribute('data-testid')?.replace('booking-step-marker-', '') ?? ''
  ));
}

function buildPublicShellSalon(
  settings: unknown,
  options: {
    features?: unknown;
    includePlan?: boolean;
    plan?: unknown;
  } = {},
) {
  return {
    id: 'salon-a-id',
    name: 'Salon A',
    slug: 'salon-a',
    themeKey: null,
    status: 'active',
    settings,
    features: options.features ?? null,
    ...(options.includePlan === false
      ? {}
      : { plan: options.plan ?? 'single_salon' }),
  } as React.ComponentProps<typeof PublicSalonPageShell>['salon'];
}

const services = [
  {
    id: 'svc-1',
    name: 'Colour Change',
    description: null,
    descriptionItems: ['Fresh colour application'],
    durationMinutes: 30,
    priceCents: 4000,
    priceDisplayText: null,
    category: 'manicure' as const,
    bookingCategory: 'manicure' as const,
    templateKey: null,
    featuredOrder: null,
    imageUrl: '/service-1.jpg',
    resolvedIntroPriceLabel: null,
  },
  {
    id: 'svc-2',
    name: 'Gel X',
    description: null,
    descriptionItems: ['Full set extensions'],
    durationMinutes: 75,
    priceCents: 6500,
    priceDisplayText: null,
    category: 'extensions' as const,
    bookingCategory: 'manicure' as const,
    templateKey: null,
    featuredOrder: null,
    imageUrl: '/service-2.jpg',
    resolvedIntroPriceLabel: null,
  },
];

const noAddOnService = {
  id: 'svc-3',
  name: 'Classic Manicure',
  description: null,
  descriptionItems: ['Shape and polish refresh'],
  durationMinutes: 45,
  priceCents: 4500,
  priceDisplayText: null,
  category: 'manicure' as const,
  bookingCategory: 'manicure' as const,
  templateKey: null,
  featuredOrder: null,
  imageUrl: '/service-3.jpg',
  resolvedIntroPriceLabel: null,
};

const addOns = [
  {
    id: 'addon-1',
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
  },
  {
    id: 'addon-2',
    name: 'French Tip',
    descriptionItems: ['Classic white tip'],
    category: 'nail_art' as const,
    pricingType: 'fixed' as const,
    unitLabel: null,
    maxQuantity: 1,
    durationMinutes: 15,
    priceCents: 1000,
    priceDisplayText: null,
    isActive: true,
  },
];

const serviceAddOnRules = [
  {
    id: 'rule-1',
    serviceId: 'svc-2',
    addOnId: 'addon-1',
    selectionMode: 'optional' as const,
    defaultQuantity: null,
    maxQuantityOverride: null,
    displayOrder: 1,
  },
  {
    id: 'rule-2',
    serviceId: 'svc-1',
    addOnId: 'addon-2',
    selectionMode: 'optional' as const,
    defaultQuantity: null,
    maxQuantityOverride: null,
    displayOrder: 1,
  },
];

const locations = [
  {
    id: 'loc-1',
    name: 'Downtown',
    address: '1 Main St',
    city: 'Toronto',
    state: 'ON',
    zipCode: 'M5V 1A1',
    phone: null,
    isPrimary: true,
  },
  {
    id: 'loc-2',
    name: 'Yorkville',
    address: '2 Bay St',
    city: 'Toronto',
    state: 'ON',
    zipCode: 'M5R 1A1',
    phone: null,
    isPrimary: false,
  },
];

const technicians = [
  {
    id: 'tech-1',
    name: 'Mila',
    imageUrl: null,
    specialties: ['Fresh colour application'],
    rating: 4.9,
    reviewCount: 42,
    enabledServiceIds: ['svc-1'],
    serviceIds: ['svc-1'],
    primaryLocationId: 'loc-1',
  },
  {
    id: 'tech-2',
    name: 'Taylor',
    imageUrl: null,
    specialties: ['Full set extensions'],
    rating: null,
    reviewCount: 0,
    enabledServiceIds: ['svc-2'],
    serviceIds: ['svc-2'],
    primaryLocationId: null,
  },
  {
    id: 'tech-3',
    name: 'Avery',
    imageUrl: null,
    specialties: ['Gel X'],
    rating: 4.8,
    reviewCount: 18,
    enabledServiceIds: ['svc-2'],
    serviceIds: ['svc-2'],
    primaryLocationId: null,
  },
];

describe('BookServiceClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBookingExperienceMock();
    navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a');
    clientSessionMock.isLoggedIn = false;
    clientSessionMock.isCheckingSession = false;
    bookingStateMock.values = {
      technicianId: null,
      technicianSelectionSource: null,
      baseServiceId: null,
      selectedAddOns: [],
      locationId: null,
      isHydrated: true,
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a clear empty state when the salon has no active services', () => {
    render(
      <BookServiceClient
        services={[]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    expect(screen.getByText('Online booking is not ready yet')).toBeInTheDocument();
    expect(screen.getByText(/does not have any active services available to book right now/i)).toBeInTheDocument();
  });

  it.each([
    'visual_grid',
    'clean_list',
    'editorial_cards',
    'category_menu',
    'editorial_price_list',
  ] as const)('renders the %s catalogue with the shared service-selection behavior', (layout) => {
    salonContextMock.bookingPage.serviceMenuLayout = layout;

    render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={locations}
      />,
    );

    const menu = layout === 'category_menu'
      ? screen.getByTestId('service-menu-grouped-categories')
      : screen.getByTestId('service-menu-list');
    const serviceCard = screen.getByTestId('service-card-svc-1');

    expect(menu).toHaveAttribute('data-booking-menu-layout', layout);
    expect(screen.getByTestId(`service-menu-presentation-${layout}`)).toBeInTheDocument();

    if (layout === 'visual_grid') {
      expect(serviceCard).toHaveClass('flex-col', 'rounded-2xl');
      expect(screen.getByTestId('service-card-image-svc-1')).toHaveClass('h-[68px]');
    } else if (layout === 'clean_list') {
      expect(serviceCard).toHaveClass('flex-row', 'rounded-xl');
      expect(screen.getByTestId('service-card-image-svc-1')).toHaveClass('w-24');
    } else if (layout === 'editorial_cards') {
      expect(serviceCard).toHaveClass('flex-col', 'rounded-[24px]');
      expect(screen.getByTestId('service-card-image-svc-1')).toHaveClass('h-[148px]');
    } else if (layout === 'category_menu') {
      expect(screen.getByTestId('service-category-group-manicure')).toBeInTheDocument();
      expect(screen.queryByTestId('service-category-scroll')).not.toBeInTheDocument();
    } else {
      expect(serviceCard).toHaveClass('rounded-none', 'border-x-0', 'border-t-0');
      expect(screen.queryByTestId('service-card-image-svc-1')).not.toBeInTheDocument();
    }

    fireEvent.click(serviceCard);

    expect(serviceCard).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('service-inline-addons-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add French Tip' })).toBeInTheDocument();
  });

  it('applies the saved free site style and palette only to the customer booking surface', () => {
    Object.assign(salonContextMock.bookingPage, {
      sitePalettePreset: 'black_champagne',
      siteStylePreset: 'luxury',
    });

    const { container } = render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={locations}
      />,
    );

    const viewport = container.querySelector('main.service-page-viewport');

    expect(viewport).toHaveAttribute('data-customer-site-palette', 'black_champagne');
    expect(viewport).toHaveAttribute('data-customer-site-style', 'luxury');
    expect(viewport).toHaveStyle({
      '--booking-brand-foreground': '#211a16',
      '--booking-brand-primary': '#e1c27e',
      '--customer-site-card-radius': '10px',
      '--theme-background': '#151315',
    });
  });

  it('renders the salon profile only for Quick Book and preserves the existing Editorial renderer', () => {
    const profile = {
      identity: {
        salonName: 'Isla Nail Studio',
        logoUrl: '/isla-logo.png',
        technicianName: 'Daniela',
        technicianPhotoUrl: '/daniela.jpg',
      },
      location: null,
      hours: null,
      contact: null,
      policies: [],
      reviews: null,
      instagram: null,
      bio: null,
    };
    const { rerender } = render(
      <BookServiceClient
        services={[services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
        quickBookProfile={profile}
      />,
    );

    expect(screen.getByTestId('quick-book-profile')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Isla Nail Studio' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Book an appointment' })).toBeInTheDocument();

    salonContextMock.bookingPage.layout = 'editorial';
    rerender(
      <BookServiceClient
        services={[services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
        quickBookProfile={profile}
      />,
    );

    expect(screen.queryByTestId('quick-book-profile')).not.toBeInTheDocument();
    expect(screen.getByTestId('booking-step-header-salon-variant')).toHaveTextContent('editorial');
  });

  it('server-renders opaque real content for the authorized script-blocked builder preview only', () => {
    const renderBeforeHydration = (isEmbeddedBuilderPreview: boolean) => {
      const root = document.createElement('div');

      root.innerHTML = renderToStaticMarkup(
        <BookServiceClient
          services={[services[0]!]}
          bookingFlow={['service', 'tech', 'time', 'confirm']}
          locations={[]}
          isEmbeddedBuilderPreview={isEmbeddedBuilderPreview}
        />,
      );

      return root;
    };

    const embeddedPreview = renderBeforeHydration(true);
    const embeddedControls = embeddedPreview.querySelector<HTMLElement>(
      '[data-public-surface="serviceSelectionControls"]',
    );
    const embeddedCard = embeddedPreview.querySelector<HTMLElement>(
      '[data-testid="service-card-svc-1"]',
    );

    expect(embeddedControls).toHaveStyle({ opacity: '1', transform: 'translateY(0)' });
    expect(embeddedCard).toHaveStyle({ opacity: '1', transform: 'translateY(0)' });

    const ordinaryPage = renderBeforeHydration(false);
    const ordinaryControls = ordinaryPage.querySelector<HTMLElement>(
      '[data-public-surface="serviceSelectionControls"]',
    );
    const ordinaryCard = ordinaryPage.querySelector<HTMLElement>(
      '[data-testid="service-card-svc-1"]',
    );

    expect(ordinaryControls).toHaveStyle({ opacity: '0', transform: 'translateY(10px)' });
    expect(ordinaryCard).toHaveStyle({ opacity: '0', transform: 'translateY(15px)' });
  });

  it('keeps the existing service-page experience unchanged when customization is unconfigured', () => {
    const { container } = render(
      <BookServiceClient
        services={[services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    expect(screen.queryByTestId('booking-experience-intro')).not.toBeInTheDocument();
    expect(screen.queryByTestId('booking-policy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('booking-social-links')).not.toBeInTheDocument();

    const activeCategory = within(screen.getByTestId('service-category-track'))
      .getByRole('button', { name: /manicure/i });

    expect(activeCategory).not.toHaveClass('bg-[var(--booking-brand-primary)]');
    expect(activeCategory).toHaveStyle({ color: 'rgb(255, 255, 255)' });
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(container.querySelector('main main')).toBeNull();
  });

  it('renders the configured booking content as plain text with safe social links above the sticky clearance', () => {
    Reflect.deleteProperty(salonContextMock.bookingPage.quickBookProfile, 'version');
    salonContextMock.bookingPage.sectionVariants = { policies: 'card' };
    salonContextMock.bookingExperience = {
      primaryColor: '#112233',
      bookingMessage: '<strong>Welcome</strong>\nSee https://example.com before booking.',
      policy: {
        enabled: true,
        title: 'Before your visit',
        text: 'Please arrive five minutes early.\nCall us if you need help.',
        showOnServicePage: true,
        showBeforeConfirmation: true,
        showAfterConfirmation: true,
        showInConfirmationEmail: true,
      },
      quickFacts: {
        appointmentOnly: {
          enabled: true,
          label: 'Appointment only',
        },
        depositNotice: {
          enabled: false,
          label: null,
        },
        cancellationNotice: {
          enabled: false,
          label: null,
        },
      },
      socialLinks: {
        instagram: 'https://www.instagram.com/salon-a',
        facebook: null,
        tiktok: 'https://www.tiktok.com/@salon-a',
      },
      confirmationMessage: null,
    };

    render(
      <BookServiceClient
        services={[services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    const intro = screen.getByTestId('booking-experience-intro');
    const message = screen.getByTestId('booking-message');

    expect(screen.getByTestId('booking-step-header').compareDocumentPosition(intro)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const appointmentOnlyBadge = screen.getByTestId('booking-appointment-only');

    expect(appointmentOnlyBadge).toHaveTextContent('Appointment only');
    expect(appointmentOnlyBadge).toHaveClass('rounded-full', 'text-xs', 'font-medium');
    expect(appointmentOnlyBadge).not.toHaveClass('uppercase', 'tracking-[0.12em]');
    expect(message).toHaveTextContent(
      '<strong>Welcome</strong> See https://example.com before booking.',
    );
    expect(message).toHaveClass('break-words', 'whitespace-pre-line');
    expect(message.querySelector('strong')).toBeNull();
    expect(message.querySelector('a')).toBeNull();
    expect(screen.getByTestId('booking-message-card')).toHaveClass(
      'rounded-xl',
      'border',
    );
    expect(screen.getByTestId('booking-message-card')).not.toHaveClass(
      'shadow-[0_4px_16px_rgba(0,0,0,0.04)]',
    );

    const policy = screen.getByTestId('booking-policy');

    expect(policy).toHaveClass('rounded-xl', 'border');
    expect(policy).not.toHaveClass(
      'shadow-[0_4px_16px_rgba(0,0,0,0.04)]',
    );
    expect(policy).toHaveTextContent('Before your visit');
    expect(policy).toHaveTextContent(
      'Please arrive five minutes early. Call us if you need help.',
    );
    expect(within(policy).getByText(/Please arrive five minutes early/)).toHaveClass(
      'break-words',
      'whitespace-pre-line',
    );

    const instagram = screen.getByRole('link', {
      name: 'Visit Salon A on Instagram',
    });
    const tiktok = screen.getByRole('link', {
      name: 'Visit Salon A on TikTok',
    });

    expect(instagram).toHaveAttribute(
      'href',
      'https://www.instagram.com/salon-a',
    );
    expect(instagram).toHaveAttribute('target', '_blank');
    expect(instagram).toHaveAttribute('rel', 'noopener noreferrer');
    expect(tiktok).toHaveAttribute('target', '_blank');
    expect(tiktok).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      screen.queryByRole('link', { name: /facebook/i }),
    ).not.toBeInTheDocument();

    const activeCategory = within(screen.getByTestId('service-category-track'))
      .getByRole('button', { name: /manicure/i });

    expect(activeCategory).toHaveClass(
      'bg-[var(--booking-brand-primary)]',
      'text-[var(--booking-brand-foreground)]',
    );
    expect(activeCategory).toHaveStyle({
      borderColor: 'var(--booking-brand-state-border)',
      borderWidth: '2px',
    });

    const serviceCard = screen.getByTestId('service-card-svc-1');
    fireEvent.click(serviceCard);

    const socialLinks = screen.getByTestId('booking-social-links');
    const stickySpacer = screen.getByTestId('service-sticky-spacer');

    expect(serviceCard.compareDocumentPosition(policy)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(policy.compareDocumentPosition(socialLinks)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(socialLinks.compareDocumentPosition(stickySpacer)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('service-continue-button')).toHaveClass(
      'text-[var(--booking-brand-foreground)]',
    );
  });

  it('uses the compact profile as the only Quick Book owner of profile policy and social content', () => {
    salonContextMock.bookingExperience = {
      primaryColor: null,
      bookingMessage: null,
      policy: {
        enabled: true,
        title: 'Before your visit',
        text: 'Please provide 24 hours notice.',
        showOnServicePage: true,
        showBeforeConfirmation: true,
        showAfterConfirmation: true,
        showInConfirmationEmail: true,
      },
      quickFacts: {
        appointmentOnly: { enabled: true, label: 'Appointment only' },
        depositNotice: { enabled: true, label: '$15 deposit required' },
        cancellationNotice: { enabled: true, label: '24 hours notice' },
      },
      socialLinks: {
        instagram: 'https://www.instagram.com/salon-a',
        facebook: null,
        tiktok: null,
      },
      confirmationMessage: null,
    };

    render(
      <BookServiceClient
        services={[services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
        quickBookProfile={{
          identity: {
            salonName: 'Salon A',
            logoUrl: null,
            technicianName: null,
            technicianPhotoUrl: null,
          },
          location: null,
          hours: null,
          contact: null,
          policies: [],
          reviews: null,
          instagram: null,
          bio: null,
        }}
      />,
    );

    expect(screen.getByTestId('quick-book-profile')).toBeInTheDocument();
    expect(screen.queryByTestId('booking-policy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('booking-social-links')).not.toBeInTheDocument();
    expect(screen.queryByTestId('booking-quick-facts')).not.toBeInTheDocument();
    expect(screen.queryByText('Appointment only')).not.toBeInTheDocument();
    expect(screen.queryByText('$15 deposit required')).not.toBeInTheDocument();
    expect(screen.queryByText('24 hours notice')).not.toBeInTheDocument();
  });

  it('places one public-safe map below the unchanged Quick Book service menu and compacts when hidden', () => {
    const profile = {
      identity: { salonName: 'Salon A', logoUrl: null, technicianName: null, technicianPhotoUrl: null },
      location: {
        name: null,
        addressLine: null,
        localityLine: 'Toronto, ON',
        directionsUrl: 'https://www.google.com/maps/search/?api=1&query=Toronto%2C%20ON',
        instructionLines: [],
      },
      hours: null,
      contact: null,
      policies: [],
      reviews: null,
      instagram: null,
      bio: null,
    };
    const props = {
      services: [services[0]!],
      bookingFlow: ['service', 'tech', 'time', 'confirm'] as ('service' | 'tech' | 'time' | 'confirm')[],
      locations: [],
      quickBookProfile: profile,
    };
    const { container, rerender } = render(<BookServiceClient {...props} />);
    const map = screen.getByTestId('quick-book-location-map');
    const service = screen.getByTestId('service-card-svc-1');

    expect(service).toBeEnabled();
    expect(service.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(screen.getAllByText('Toronto, ON')).toHaveLength(1);
    expect(screen.queryByTestId('editorial-visit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('location-cards')).not.toBeInTheDocument();
    expect(screen.getByTitle('Map of Toronto, ON')).toHaveAttribute('src', 'https://www.google.com/maps?q=Toronto%2C%20ON&output=embed');

    rerender(<BookServiceClient {...props} quickBookProfile={{ ...profile, location: null }} />);

    expect(screen.queryByTestId('quick-book-location-map')).not.toBeInTheDocument();
    expect(screen.getByTestId('service-card-svc-1')).toBeEnabled();

    salonContextMock.bookingPage.layout = 'editorial';
    rerender(<BookServiceClient {...props} />);

    expect(screen.queryByTestId('quick-book-location-map')).not.toBeInTheDocument();

    salonContextMock.bookingPage.layout = 'quick_book';
    Reflect.set(salonContextMock.bookingPage.quickBookProfile, 'version', 0);
    rerender(<BookServiceClient {...props} />);

    expect(screen.queryByTestId('quick-book-location-map')).not.toBeInTheDocument();
  });

  it('preserves the legacy Quick Book header and public sections without an adoption marker', () => {
    Reflect.set(salonContextMock.bookingPage.quickBookProfile, 'version', 0);
    salonContextMock.bookingExperience = {
      primaryColor: null,
      bookingMessage: null,
      policy: {
        enabled: true,
        title: 'Before your visit',
        text: 'Please provide 24 hours notice.',
        showOnServicePage: true,
        showBeforeConfirmation: true,
        showAfterConfirmation: true,
        showInConfirmationEmail: true,
      },
      quickFacts: {
        appointmentOnly: { enabled: true, label: 'Appointment only' },
        depositNotice: { enabled: false, label: null },
        cancellationNotice: { enabled: false, label: null },
      },
      socialLinks: {
        instagram: 'https://www.instagram.com/salon-a',
        facebook: null,
        tiktok: null,
      },
      confirmationMessage: null,
    };

    render(
      <BookServiceClient
        services={[services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    expect(screen.queryByTestId('quick-book-profile')).not.toBeInTheDocument();
    expect(screen.getByTestId('booking-step-header-salon-variant')).toHaveTextContent('editorial');
    expect(screen.getByTestId('booking-quick-facts')).toHaveTextContent('Appointment only');
    expect(screen.getByTestId('booking-policy')).toHaveTextContent('Please provide 24 hours notice.');
    expect(screen.getByRole('link', { name: 'Visit Salon A on Instagram' }))
      .toHaveAttribute('href', 'https://www.instagram.com/salon-a');
  });

  it('renders the legacy Appointment Only setting through the resolved provider quick fact', () => {
    salonContextMock.bookingPage.layout = 'editorial';
    const salon = buildPublicShellSalon({
      bookingExperience: {
        primaryColor: null,
        bookingMessage: null,
        policy: {
          enabled: false,
          title: null,
          text: null,
        },
        appointmentOnly: true,
        socialLinks: {
          instagram: null,
          facebook: null,
          tiktok: null,
        },
        confirmationMessage: null,
      },
    });

    render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-service"
        salon={salon}
      >
        <BookServiceClient
          services={[services[0]!]}
          bookingFlow={['service', 'tech', 'time', 'confirm']}
          locations={[]}
        />
      </PublicSalonPageShell>,
    );

    const quickFacts = screen.getByTestId('booking-quick-facts');
    const appointmentOnlyLabel = within(quickFacts).getByText('Appointment only');
    const appointmentOnlyBadge = appointmentOnlyLabel.closest('li');

    expect(appointmentOnlyBadge).toHaveClass('rounded-full', 'text-xs');
    expect(appointmentOnlyLabel).toHaveClass('min-w-0', 'break-words');
    expect(within(quickFacts).getAllByRole('listitem')).toHaveLength(1);
  });

  it('shows only explicitly enabled quick facts and uses their configured labels', () => {
    salonContextMock.bookingPage.layout = 'editorial';
    salonContextMock.bookingExperience = {
      ...DEFAULT_BOOKING_EXPERIENCE,
      policy: {
        ...DEFAULT_BOOKING_EXPERIENCE.policy,
        enabled: true,
        text: 'A $15 deposit may apply. Please cancel 24 hours in advance.',
      },
      quickFacts: {
        appointmentOnly: {
          enabled: true,
          label: 'By appointment',
        },
        depositNotice: {
          enabled: false,
          label: '$15 deposit required',
        },
        cancellationNotice: {
          enabled: true,
          label: '24-hour cancellation policy',
        },
      },
    };

    render(
      <BookServiceClient
        services={[services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    const quickFacts = screen.getByTestId('booking-quick-facts');

    expect(within(quickFacts).getAllByRole('listitem')).toHaveLength(2);
    expect(within(quickFacts).getByText('By appointment')).toBeInTheDocument();
    expect(
      within(quickFacts).getByText('24-hour cancellation policy'),
    ).toBeInTheDocument();
    expect(
      within(quickFacts).queryByText('$15 deposit required'),
    ).not.toBeInTheDocument();
  });

  it('wraps uninterrupted quick-fact labels and policy titles without horizontal overflow classes', () => {
    salonContextMock.bookingPage.layout = 'editorial';
    salonContextMock.bookingPage.sectionVariants = { policies: 'card' };
    const longBadgeLabel = 'D'.repeat(40);
    const longPolicyTitle = 'P'.repeat(60);
    salonContextMock.bookingExperience = {
      ...DEFAULT_BOOKING_EXPERIENCE,
      policy: {
        ...DEFAULT_BOOKING_EXPERIENCE.policy,
        enabled: true,
        title: longPolicyTitle,
        text: 'Please review this policy before booking.',
      },
      quickFacts: {
        ...DEFAULT_BOOKING_EXPERIENCE.quickFacts,
        depositNotice: {
          enabled: true,
          label: longBadgeLabel,
        },
      },
    };

    render(
      <BookServiceClient
        services={[services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    const quickFacts = screen.getByTestId('booking-quick-facts');
    const badgeLabel = within(quickFacts).getByText(longBadgeLabel);
    const badge = badgeLabel.closest('li');
    const policyTitle = within(screen.getByTestId('booking-policy')).getByRole(
      'heading',
      { name: longPolicyTitle },
    );

    expect(badge).toHaveClass('max-w-full', 'min-w-0');
    expect(badge).not.toHaveClass('whitespace-nowrap');
    expect(badgeLabel).toHaveClass('min-w-0', 'break-words');
    expect(badgeLabel).not.toHaveClass('whitespace-nowrap');
    expect(policyTitle).toHaveClass('min-w-0', 'break-words');
    expect(policyTitle).not.toHaveClass('whitespace-nowrap');
  });

  it('honours the service-page policy placement flag', () => {
    salonContextMock.bookingExperience = {
      ...DEFAULT_BOOKING_EXPERIENCE,
      policy: {
        enabled: true,
        title: 'Booking policy',
        text: 'Please provide 24 hours notice.',
        showOnServicePage: false,
        showBeforeConfirmation: true,
        showAfterConfirmation: true,
        showInConfirmationEmail: true,
      },
    };

    render(
      <BookServiceClient
        services={[services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    expect(screen.queryByTestId('booking-policy')).not.toBeInTheDocument();
    expect(screen.queryByText('Please provide 24 hours notice.')).not.toBeInTheDocument();
  });

  it('keeps a disabled policy unpublished and displays only configured social platforms', () => {
    salonContextMock.bookingPage.layout = 'editorial';
    salonContextMock.bookingExperience = {
      primaryColor: null,
      bookingMessage: null,
      policy: {
        enabled: false,
        title: 'Draft policy',
        text: 'This draft must remain private.',
        showOnServicePage: true,
        showBeforeConfirmation: true,
        showAfterConfirmation: true,
        showInConfirmationEmail: true,
      },
      quickFacts: {
        appointmentOnly: {
          enabled: false,
          label: null,
        },
        depositNotice: {
          enabled: false,
          label: null,
        },
        cancellationNotice: {
          enabled: false,
          label: null,
        },
      },
      socialLinks: {
        instagram: null,
        facebook: 'https://www.facebook.com/salon-a',
        tiktok: null,
      },
      confirmationMessage: null,
    };

    render(
      <BookServiceClient
        services={[services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    expect(screen.queryByTestId('booking-policy')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft policy')).not.toBeInTheDocument();
    expect(screen.queryByText('This draft must remain private.')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Visit Salon A on Facebook' }),
    ).toHaveAttribute('href', 'https://www.facebook.com/salon-a');
    expect(
      screen.queryByRole('link', { name: /instagram|tiktok/i }),
    ).not.toBeInTheDocument();
  });

  it('uses black or white branded foregrounds for light and dark primary colours', () => {
    expect(getBookingExperienceCssVariables('#FFFFFF')).toMatchObject({
      '--booking-brand-primary': '#FFFFFF',
      '--booking-brand-foreground': '#000000',
    });
    expect(getBookingExperienceCssVariables('#000000')).toMatchObject({
      '--booking-brand-primary': '#000000',
      '--booking-brand-foreground': '#FFFFFF',
    });
    expect(getBookingExperienceCssVariables(null)).toEqual({});
  });

  it('applies resolved brand variables after page theming on booking pages only', () => {
    const salon = buildPublicShellSalon({
      bookingExperience: {
        primaryColor: '#ffffff',
        bookingMessage: null,
        policy: {
          enabled: false,
          title: null,
          text: null,
        },
        appointmentOnly: false,
        socialLinks: {
          instagram: null,
          facebook: null,
          tiktok: null,
        },
        confirmationMessage: null,
      },
    });
    const { container, rerender } = render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-service"
        salon={salon}
      >
        <div>Booking content</div>
      </PublicSalonPageShell>,
    );

    const bookingTheme = container.querySelector<HTMLElement>(
      '[data-booking-experience-theme="book-service"]',
    );

    expect(bookingTheme).not.toBeNull();
    expect(bookingTheme?.style.getPropertyValue('--booking-brand-primary')).toBe(
      '#FFFFFF',
    );
    expect(bookingTheme?.style.getPropertyValue('--booking-brand-foreground')).toBe(
      '#000000',
    );
    expect(salonProviderPropsMock.bookingExperience).toMatchObject({
      primaryColor: '#FFFFFF',
    });

    rerender(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="profile"
        salon={salon}
      >
        <div>Profile content</div>
      </PublicSalonPageShell>,
    );

    expect(
      container.querySelector('[data-booking-experience-theme]'),
    ).toBeNull();
  });

  /**
   * S1 (Stage 1) — BEHAVIOUR CHANGE, deliberately replacing five previously
   * green assertions.
   *
   * These cases asserted that `PublicSalonPageShell` fell back to
   * `BOOKING_EXPERIENCE_DEFAULTS` whenever the plan was free, unknown, missing,
   * or entitlement resolution threw — i.e. that owner-authored booking message,
   * policy, social links, quick facts, confirmation message and accent colour
   * were suppressed on the public page.
   *
   * Under UX-OD-02 all six are UNIVERSAL owner content, so the shell no longer
   * consults `booking_experience_customization` at all. What it still does — and
   * what these rewrites now pin — is resolve defensively: a salon that authored
   * nothing, or whose persisted blob is malformed, still gets the canonical
   * defaults and nothing is fabricated. That last property is covered by the
   * malformed-blob case immediately below, which is unchanged and still green.
   */
  it.each([
    ['a missing plan', { includePlan: false }],
    ['an unknown plan', { plan: 'legacy_unknown' }],
    ['a free plan', { plan: 'free' }],
  ])('renders authored customization regardless of plan — %s', (_label, options) => {
    const salon = buildPublicShellSalon(
      { bookingExperience: CONFIGURED_BOOKING_EXPERIENCE },
      options,
    );

    render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-service"
        salon={salon}
      >
        <div>Booking content</div>
      </PublicSalonPageShell>,
    );

    expect(salonProviderPropsMock.bookingExperience).toMatchObject(
      CONFIGURED_BOOKING_EXPERIENCE,
    );
  });

  it('passes authored content to public booking and confirmation consumers on a FREE plan', () => {
    const salon = buildPublicShellSalon(
      { bookingExperience: CONFIGURED_BOOKING_EXPERIENCE },
      { plan: 'free' },
    );

    render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-confirm"
        salon={salon}
      >
        <div>Confirmation content</div>
      </PublicSalonPageShell>,
    );

    expect(salonProviderPropsMock.bookingExperience).toMatchObject(
      CONFIGURED_BOOKING_EXPERIENCE,
    );
    expect(
      (salonProviderPropsMock.bookingExperience as BookingExperience)
        .confirmationMessage,
    ).toBe(CONFIGURED_BOOKING_EXPERIENCE.confirmationMessage);
  });

  it('renders identically across a plan change — the plan no longer decides this', () => {
    const settings = {
      bookingExperience: CONFIGURED_BOOKING_EXPERIENCE,
    };
    const { rerender } = render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-confirm"
        salon={buildPublicShellSalon(settings, { plan: 'free' })}
      >
        <div>Confirmation content</div>
      </PublicSalonPageShell>,
    );

    expect(salonProviderPropsMock.bookingExperience).toMatchObject(
      CONFIGURED_BOOKING_EXPERIENCE,
    );

    rerender(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-confirm"
        salon={buildPublicShellSalon(settings, { plan: 'single_salon' })}
      >
        <div>Confirmation content</div>
      </PublicSalonPageShell>,
    );

    expect(salonProviderPropsMock.bookingExperience).toMatchObject(
      CONFIGURED_BOOKING_EXPERIENCE,
    );
  });

  it('a hostile `features` object no longer suppresses content, because features are not read', () => {
    const features = Object.defineProperty({}, 'booking', {
      get() {
        throw new Error('unexpected entitlement failure');
      },
    });
    const salon = buildPublicShellSalon(
      { bookingExperience: CONFIGURED_BOOKING_EXPERIENCE },
      { features },
    );

    // The page still renders — that invariant is unchanged. What changed is
    // that a throwing `features` getter is never touched.
    expect(() => render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-service"
        salon={salon}
      >
        <div>Booking content</div>
      </PublicSalonPageShell>,
    )).not.toThrow();
    expect(salonProviderPropsMock.bookingExperience).toMatchObject(
      CONFIGURED_BOOKING_EXPERIENCE,
    );
  });

  it('falls back safely when persisted booking customization is malformed', () => {
    const salon = buildPublicShellSalon({
      bookingExperience: {
        primaryColor: 'red',
        bookingMessage: `Unsafe${String.fromCharCode(0)}message`,
        policy: {
          enabled: true,
          title: null,
          text: null,
        },
        appointmentOnly: 'yes',
        socialLinks: {
          instagram: 'https://instagram.com',
          facebook: 'javascript:alert(1)',
          tiktok: 'https://example.com/profile',
        },
        confirmationMessage: null,
      },
    });
    const { container } = render(
      <PublicSalonPageShell
        appearance={{ mode: 'custom', themeKey: null }}
        pageName="book-service"
        salon={salon}
      >
        <div>Booking content</div>
      </PublicSalonPageShell>,
    );

    expect(
      container.querySelector('[data-booking-experience-theme]'),
    ).toBeNull();
    expect(salonProviderPropsMock.bookingExperience).toMatchObject({
      primaryColor: null,
      bookingMessage: null,
      policy: {
        enabled: false,
        text: null,
      },
      quickFacts: {
        appointmentOnly: {
          enabled: false,
          label: null,
        },
        depositNotice: {
          enabled: false,
          label: null,
        },
        cancellationNotice: {
          enabled: false,
          label: null,
        },
      },
      socialLinks: {
        instagram: null,
        facebook: null,
        tiktok: null,
      },
    });
  });

  it('renders the new-client promo in the branded header slot instead of the old generic offer card', () => {
    render(
      <BookServiceClient
        services={[services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
        showNewClientPromo
      />,
    );

    expect(screen.getByTestId('quick-book-profile')).toBeInTheDocument();
    expect(screen.getByTestId('booking-step-header-announcement')).toHaveTextContent('25% off for new clients — until April 30');
    expect(screen.queryByText('First-visit offer')).not.toBeInTheDocument();
    expect(screen.queryByText('New clients may be eligible for 25% off their first appointment')).not.toBeInTheDocument();
  });

  it('loads and displays a valid retention offer from the campaign link', async () => {
    const token = 'campaign_token_123456789012345678901234';
    navigationMock.searchParams = new URLSearchParams(`salonSlug=salon-a&campaign=${token}`);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: {
        campaign: {
          displayOffer: '20% off',
          promotion: {
            name: 'Welcome back',
            code: 'BACK20',
          },
        },
      },
    }), { status: 200 }));

    render(
      <BookServiceClient
        services={[services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
        showNewClientPromo
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('booking-step-header-announcement')).toHaveTextContent('Welcome back · 20% off · BACK20');
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/public/retention-campaigns/${token}?salonSlug=salon-a`,
      { cache: 'no-store' },
    );
    expect(screen.queryByText('25% off for new clients — until April 30')).not.toBeInTheDocument();
  });

  it('waits for booking-state hydration before accepting a service selection', () => {
    bookingStateMock.values.isHydrated = false;

    const props: React.ComponentProps<typeof BookServiceClient> = {
      services: [services[0]!],
      bookingFlow: ['service', 'tech', 'time', 'confirm'],
      locations: [],
    };
    const { rerender } = render(<BookServiceClient {...props} />);

    expect(screen.getByTestId('service-card-svc-1')).toBeDisabled();

    bookingStateMock.values.isHydrated = true;
    rerender(<BookServiceClient {...props} />);

    const serviceCard = screen.getByTestId('service-card-svc-1');

    expect(serviceCard).toBeEnabled();

    fireEvent.click(serviceCard);

    expect(screen.getByTestId('service-continue-button')).toBeVisible();
  });

  it('renders exactly the Manicure, Pedicure, and Combos chips in a horizontal mobile scroll track', () => {
    render(
      <BookServiceClient
        services={[
          {
            id: 'svc-3',
            name: 'Russian Manicure',
            description: null,
            descriptionItems: [],
            durationMinutes: 45,
            priceCents: 3500,
            priceDisplayText: null,
            category: 'manicure',
            bookingCategory: 'manicure',
            templateKey: null,
            featuredOrder: null,
            imageUrl: '/service-3.jpg',
            resolvedIntroPriceLabel: null,
          },
          {
            id: 'svc-4',
            name: 'Builder Gel',
            description: null,
            descriptionItems: [],
            durationMinutes: 75,
            priceCents: 5000,
            priceDisplayText: null,
            category: 'builder_gel',
            bookingCategory: 'manicure',
            templateKey: null,
            featuredOrder: null,
            imageUrl: '/service-4.jpg',
            resolvedIntroPriceLabel: null,
          },
          {
            id: 'svc-5',
            name: 'Pedicure',
            description: null,
            descriptionItems: [],
            durationMinutes: 60,
            priceCents: 4000,
            priceDisplayText: null,
            category: 'pedicure',
            bookingCategory: 'pedicure',
            templateKey: null,
            featuredOrder: null,
            imageUrl: '/service-5.jpg',
            resolvedIntroPriceLabel: null,
          },
          {
            id: 'svc-6',
            name: 'BIAB + Classic Pedicure',
            description: null,
            descriptionItems: [],
            durationMinutes: 110,
            priceCents: 8500,
            priceDisplayText: null,
            category: 'combo',
            bookingCategory: 'combo',
            templateKey: null,
            featuredOrder: null,
            imageUrl: '/service-6.jpg',
            resolvedIntroPriceLabel: null,
          },
        ]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    expect(screen.getByTestId('service-category-scroll')).toHaveClass(
      '-mx-4',
      'w-[calc(100%+2rem)]',
      'overflow-x-auto',
      'overflow-y-hidden',
      'scrollbar-hide',
      'md:mx-0',
      'md:w-full',
      'md:overflow-visible',
      'md:px-0',
    );
    expect(screen.getByTestId('service-category-track')).toHaveClass(
      'flex',
      'min-w-max',
      'flex-nowrap',
      'md:min-w-0',
      'md:flex-wrap',
      'md:justify-center',
    );

    const track = screen.getByTestId('service-category-track');
    const chipNames = within(track)
      .getAllByRole('button')
      .map(button => button.textContent?.trim());

    expect(chipNames).toEqual([
      '💅Manicure',
      '🦶Pedicure',
      '✨Combos',
    ]);
    // Builder Gel is no longer a top-level chip; those services live under Manicure.
    expect(within(track).queryByRole('button', { name: /builder gel/i })).not.toBeInTheDocument();
    expect(within(track).getByRole('button', { name: /manicure/i })).toHaveClass(
      'shrink-0',
      'whitespace-nowrap',
    );
    expect(within(track).getByRole('button', { name: /combos/i })).toHaveClass(
      'shrink-0',
      'whitespace-nowrap',
    );
    // Manicure is the default tab, so the builder_gel service shows under it.
    expect(within(track).getByRole('button', { name: /manicure/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('service-card-svc-4')).toBeInTheDocument();
    expect(screen.getByText('Featured services')).toBeInTheDocument();
    expect(screen.getByText('Popular premium sets and combo appointments')).toBeInTheDocument();

    fireEvent.click(within(track).getByRole('button', { name: /combos/i }));

    expect(screen.getByTestId('service-card-svc-6')).toHaveClass('col-span-full');
  });

  it('filters the list by booking category and shows an empty state for empty tabs', () => {
    render(
      <BookServiceClient
        services={[
          {
            id: 'svc-bg',
            name: 'Builder Gel Overlay',
            description: null,
            descriptionItems: [],
            durationMinutes: 75,
            priceCents: 5000,
            priceDisplayText: null,
            category: 'builder_gel',
            bookingCategory: 'manicure',
            templateKey: null,
            featuredOrder: null,
            imageUrl: '/service-bg.jpg',
            resolvedIntroPriceLabel: null,
          },
        ]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    const track = screen.getByTestId('service-category-track');

    expect(screen.getByTestId('service-card-svc-bg')).toBeInTheDocument();

    fireEvent.click(within(track).getByRole('button', { name: /pedicure/i }));

    expect(screen.queryByTestId('service-card-svc-bg')).not.toBeInTheDocument();
    expect(screen.getByTestId('service-category-empty')).toHaveTextContent(
      'No pedicure services available yet.',
    );
  });

  it('lands on the first non-empty tab when the salon offers no manicure services', () => {
    render(
      <BookServiceClient
        services={[
          {
            id: 'svc-pedi-only',
            name: 'Spa Pedicure',
            description: null,
            descriptionItems: [],
            durationMinutes: 60,
            priceCents: 6000,
            priceDisplayText: null,
            category: 'pedicure',
            bookingCategory: 'pedicure',
            templateKey: null,
            featuredOrder: null,
            imageUrl: '/service-pedi.jpg',
            resolvedIntroPriceLabel: null,
          },
        ]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    const track = screen.getByTestId('service-category-track');

    expect(within(track).getByRole('button', { name: /pedicure/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('service-card-svc-pedi-only')).toBeInTheDocument();
    expect(screen.queryByTestId('service-category-empty')).not.toBeInTheDocument();
  });

  it('surfaces search matches from any category regardless of the selected chip', () => {
    render(
      <BookServiceClient
        services={services}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    const track = screen.getByTestId('service-category-track');
    fireEvent.click(within(track).getByRole('button', { name: /pedicure/i }));
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: 'gel x' },
    });

    expect(screen.getByTestId('service-card-svc-2')).toBeInTheDocument();
    expect(screen.queryByTestId('service-category-empty')).not.toBeInTheDocument();
  });

  it('hides the Featured carousel and category chips during an active search so matches sit under the search bar', () => {
    render(
      <BookServiceClient
        services={services}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    // Default view: featured carousel (Gel X is featured via the extensions
    // fallback) and the category chips are both visible.
    expect(screen.getByTestId('featured-services-scroll')).toBeInTheDocument();
    expect(screen.getByTestId('service-category-scroll')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: 'colour' },
    });

    // As soon as there is a query, the featured carousel and the chips collapse.
    expect(screen.queryByTestId('featured-services-scroll')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-category-scroll')).not.toBeInTheDocument();

    // Only the matching result remains, rendered directly beneath the search bar.
    expect(screen.getByTestId('service-card-svc-1')).toBeInTheDocument();
    expect(screen.queryByTestId('service-card-svc-2')).not.toBeInTheDocument();
  });

  it('matches on description and description items, case-insensitively, not just the name', () => {
    const descriptionService = {
      id: 'svc-desc',
      name: 'Spa Ritual',
      description: 'Relaxing hot stone massage',
      descriptionItems: [],
      durationMinutes: 50,
      priceCents: 7000,
      priceDisplayText: null,
      category: 'manicure' as const,
      bookingCategory: 'manicure' as const,
      templateKey: null,
      featuredOrder: null,
      imageUrl: '/service-desc.jpg',
      resolvedIntroPriceLabel: null,
    };

    render(
      <BookServiceClient
        services={[descriptionService, ...services]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    const searchInput = screen.getByPlaceholderText(/search/i);

    // "massage" only appears in the description field (name is "Spa Ritual"),
    // and the query is upper-cased to prove case-insensitive matching.
    fireEvent.change(searchInput, { target: { value: 'MASSAGE' } });

    expect(screen.getByTestId('service-card-svc-desc')).toBeInTheDocument();
    expect(screen.queryByTestId('service-card-svc-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-card-svc-2')).not.toBeInTheDocument();

    // "extensions" only appears in Gel X's descriptionItems, not its name.
    fireEvent.change(searchInput, { target: { value: 'extensions' } });

    expect(screen.getByTestId('service-card-svc-2')).toBeInTheDocument();
    expect(screen.queryByTestId('service-card-svc-desc')).not.toBeInTheDocument();
  });

  it('shows a clear "No services found" state when the search matches nothing', () => {
    render(
      <BookServiceClient
        services={services}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: 'zzzznotathing' },
    });

    const emptyState = screen.getByTestId('service-search-empty');

    expect(emptyState).toBeInTheDocument();
    expect(emptyState).toHaveTextContent('No services found');
    // The category-tab empty state must not double up during a search.
    expect(screen.queryByTestId('service-category-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-card-svc-1')).not.toBeInTheDocument();
  });

  it('restores the Featured carousel, category chips, and full menu when the search is cleared with the X', () => {
    render(
      <BookServiceClient
        services={services}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: 'colour' },
    });

    expect(screen.queryByTestId('featured-services-scroll')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-category-scroll')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-card-svc-2')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));

    // Clearing brings back the whole default browse experience.
    expect(screen.getByTestId('featured-services-scroll')).toBeInTheDocument();
    expect(screen.getByTestId('service-category-scroll')).toBeInTheDocument();
    expect(screen.getByTestId('service-card-svc-1')).toBeInTheDocument();
    expect(screen.getByTestId('service-card-svc-2')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search/i)).toHaveValue('');
  });

  it('puts the active Luster Manicure first in the featured row when enabled', () => {
    const lusterService = {
      id: 'svc-luster',
      name: 'Luster Manicure',
      description: null,
      descriptionItems: ['Premium structured manicure'],
      durationMinutes: 60,
      priceCents: 4500,
      priceDisplayText: null,
      category: 'manicure' as const,
      bookingCategory: 'manicure' as const,
      templateKey: 'luster_manicure',
      featuredOrder: null,
      imageUrl: '/service-luster.jpg',
      resolvedIntroPriceLabel: null,
    };

    const { unmount } = render(
      <BookServiceClient
        services={[...services, lusterService]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
        lusterFeaturingEnabled
      />,
    );

    const featuredRegion = screen.getByRole('region', { name: 'Featured services' });
    const featuredCards = within(featuredRegion)
      .getAllByRole('button')
      .map(button => button.getAttribute('data-testid'));

    expect(featuredCards[0]).toBe('featured-service-card-svc-luster');
    // Exactly one Luster card — never duplicated.
    expect(
      featuredCards.filter(id => id === 'featured-service-card-svc-luster'),
    ).toHaveLength(1);

    unmount();

    // Disabled: Luster is not forced first and (with no manual position) is not featured.
    render(
      <BookServiceClient
        services={[...services, lusterService]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
        lusterFeaturingEnabled={false}
      />,
    );

    expect(screen.queryByTestId('featured-service-card-svc-luster')).not.toBeInTheDocument();
    // The service itself remains bookable in its category.
    expect(screen.getByTestId('service-card-svc-luster')).toBeInTheDocument();
  });

  it('uses stable border-and-shadow emphasis for selected featured cards without image scaling', () => {
    render(
      <BookServiceClient
        services={[
          {
            id: 'svc-combo',
            name: 'BIAB + Classic Pedicure',
            description: null,
            descriptionItems: ['Builder gel overlay with a classic pedicure pairing'],
            durationMinutes: 110,
            priceCents: 8500,
            priceDisplayText: null,
            category: 'combo',
            bookingCategory: 'combo',
            templateKey: null,
            featuredOrder: null,
            imageUrl: '/service-combo.jpg',
            resolvedIntroPriceLabel: null,
          },
          ...services,
        ]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    const featuredCard = screen.getByTestId('featured-service-card-svc-combo');
    fireEvent.click(featuredCard);

    expect(featuredCard).toHaveStyle('box-shadow: 0 14px 28px rgba(0,0,0,0.14)');
    expect(featuredCard).toHaveStyle('border-width: 1px');
    expect(featuredCard).not.toHaveAttribute('style', expect.stringContaining('outline'));
    expect(screen.getByTestId('featured-service-card-image-svc-combo')).not.toHaveClass('scale-105');
  });

  it('defaults images on and renders image-free cards without losing badges, layout, or selection behavior', () => {
    const comboService = {
      id: 'svc-combo-images',
      name: 'BIAB + Classic Pedicure',
      description: null,
      descriptionItems: ['Builder gel overlay with a classic pedicure pairing'],
      durationMinutes: 110,
      priceCents: 8500,
      priceDisplayText: null,
      category: 'combo' as const,
      bookingCategory: 'combo' as const,
      templateKey: null,
      featuredOrder: null,
      imageUrl: '/service-combo.jpg',
      resolvedIntroPriceLabel: null,
    };
    const introService = {
      ...services[0]!,
      resolvedIntroPriceLabel: 'New guest introductory price with extra detail',
    };
    const renderProps = {
      services: [comboService, introService, services[1]!],
      addOns,
      serviceAddOnRules,
      bookingFlow: ['service', 'tech', 'time', 'confirm'] as React.ComponentProps<
        typeof BookServiceClient
      >['bookingFlow'],
      locations: [locations[0]!],
      technicians: [technicians[0]!],
    };

    const defaultView = render(<BookServiceClient {...renderProps} />);

    expect(screen.getByTestId('featured-service-card-image-container-svc-combo-images')).toHaveClass(
      'h-[80px]',
      'sm:h-[96px]',
    );
    expect(screen.getByTestId('service-card-image-svc-1')).toHaveClass('h-[68px]');

    defaultView.unmount();

    render(<BookServiceClient {...renderProps} showServiceImages={false} />);

    const featuredCombo = screen.getByTestId('featured-service-card-svc-combo-images');
    const featuredManicure = screen.getByTestId('featured-service-card-svc-2');
    const regularCard = screen.getByTestId('service-card-svc-1');

    expect(screen.queryByTestId('featured-service-card-image-container-svc-combo-images')).not.toBeInTheDocument();
    expect(screen.queryByTestId('featured-service-card-image-svc-combo-images')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-card-image-svc-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-card-image-element-svc-1')).not.toBeInTheDocument();

    expect(within(featuredCombo).getByText('Best value')).toBeInTheDocument();
    expect(within(featuredManicure).getByText('Manicure')).toBeInTheDocument();

    const introBadge = screen.getByTestId('service-card-intro-badge-svc-1');

    expect(introBadge).toHaveTextContent('New guest introductory price with extra detail');
    expect(introBadge).toHaveClass('max-w-full', 'whitespace-normal', 'break-words');
    expect(screen.getByTestId('service-card-content-svc-1')).toContainElement(introBadge);

    expect(featuredCombo).toHaveClass(
      'w-[min(272px,calc(100vw-4rem))]',
      'sm:w-[320px]',
    );
    expect(regularCard.parentElement).toHaveClass('grid', 'grid-cols-2');

    fireEvent.click(regularCard);

    expect(screen.getByTestId('service-inline-addons-panel')).toBeInTheDocument();
    expect(screen.getByTestId('service-sticky-bar')).toBeInTheDocument();

    const technicianPreview = screen.getByTestId('service-auto-technician-preview');

    expect(technicianPreview).toBeInTheDocument();
    expect(within(technicianPreview).getByText('M')).toBeInTheDocument();
    expect(within(technicianPreview).getByText('Mila')).toBeInTheDocument();
  });

  it('starts with no selected service, add-on panel, or sticky CTA on a fresh visit', () => {
    render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    expect(screen.getByTestId('service-card-svc-1')).toHaveAttribute('data-selected', 'false');
    expect(getRenderedBookingSteps()).toEqual(['service', 'tech', 'time', 'confirm']);
    expect(screen.queryByTestId('service-inline-addons-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-sticky-spacer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-card-addon-cue-svc-1')).not.toBeInTheDocument();
  });

  it('starts with a three-step header on a fresh visit when the salon has exactly one location-compatible technician', () => {
    render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={locations}
        technicians={[technicians[0]!]}
      />,
    );

    expect(screen.getByTestId('service-card-svc-1')).toHaveAttribute('data-selected', 'false');
    expect(getRenderedBookingSteps()).toEqual(['service', 'time', 'confirm']);
    expect(screen.queryByTestId('service-inline-addons-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
  });

  it('renders a compact one-tech preview, collapses to three steps, and skips directly to time when exactly one technician is compatible', () => {
    clientSessionMock.isLoggedIn = true;

    render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={locations}
        technicians={technicians}
      />,
    );

    fireEvent.click(screen.getByTestId('service-card-svc-1'));

    expect(screen.getByTestId('service-auto-technician-preview')).toBeInTheDocument();
    expect(screen.getByText('Mila')).toBeInTheDocument();
    expect(screen.getByText('42 reviews')).toBeInTheDocument();
    expect(getRenderedBookingSteps()).toEqual(['service', 'time', 'confirm']);

    fireEvent.click(screen.getByTestId('service-continue-button'));

    expect(navigationMock.routerPush).toHaveBeenCalledWith(
      '/en/salon-a/book/time?baseServiceId=svc-1&locationId=loc-1&techId=tech-1',
    );
    expect(bookingStateMock.setTechnicianId).toHaveBeenCalledWith('tech-1', 'auto');
  });

  it('restores the normal artist step when the selection changes from one-tech to multi-tech', async () => {
    render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={locations}
        technicians={technicians}
      />,
    );

    fireEvent.click(screen.getByTestId('service-card-svc-1'));

    expect(screen.getByTestId('service-auto-technician-preview')).toBeInTheDocument();
    expect(getRenderedBookingSteps()).toEqual(['service', 'time', 'confirm']);

    fireEvent.click(screen.getByTestId('service-card-svc-2'));

    await waitFor(() => {
      expect(screen.queryByTestId('service-auto-technician-preview')).not.toBeInTheDocument();
    });

    expect(getRenderedBookingSteps()).toEqual(['service', 'tech', 'time', 'confirm']);
  });

  it('does not auto-skip when no compatible technician exists for the selected service', () => {
    render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={locations}
        technicians={technicians.filter(technician => technician.id !== 'tech-1')}
      />,
    );

    fireEvent.click(screen.getByTestId('service-card-svc-1'));

    expect(screen.queryByTestId('service-auto-technician-preview')).not.toBeInTheDocument();
    expect(getRenderedBookingSteps()).toEqual(['service', 'tech', 'time', 'confirm']);
    expect(bookingStateMock.setTechnicianId).not.toHaveBeenCalledWith('tech-1', 'auto');
  });

  it('shows the add-on cue, inline panel, and sticky note when the user selects a service with add-ons', () => {
    render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    fireEvent.click(screen.getByTestId('service-card-svc-1'));

    const panel = screen.getByTestId('service-inline-addons-panel');
    const stickyBar = screen.getByTestId('service-sticky-bar');
    const selectedCard = screen.getByTestId('service-card-svc-1');

    expect(screen.getByTestId('service-card-addon-cue-svc-1')).toBeInTheDocument();
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveClass(
      'w-full',
      'rounded-[24px]',
      'bg-white',
      'px-3.5',
      'py-3',
      'shadow-[0_8px_22px_rgba(0,0,0,0.04)]',
      'sm:px-4',
      'sm:py-3.5',
    );
    expect(panel).not.toHaveClass('col-span-2');
    expect(within(panel).getByText('Customize your service')).toBeInTheDocument();
    expect(within(panel).getByText(/Optional add-ons for Colour Change/i)).toBeInTheDocument();
    expect(within(panel).queryByText(/Add extra time or upgrades without changing your main service/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('service-addon-row-addon-2')).toHaveClass('px-3', 'py-2', 'rounded-[18px]');
    expect(stickyBar).toHaveClass(
      'fixed',
      'bottom-0',
      'inset-x-0',
      'z-[60]',
      'border-t',
      'border-white/40',
      'bg-white/85',
      'shadow-[0_-8px_30px_rgba(0,0,0,0.08)]',
      'backdrop-blur-lg',
      'supports-[backdrop-filter]:bg-white/82',
    );
    expect(screen.getByTestId('service-sticky-spacer')).toBeInTheDocument();
    expect(document.documentElement).toHaveStyle({
      '--service-sticky-footer-clearance': 'calc(4.75rem + env(safe-area-inset-bottom, 0px) + var(--ios-chrome-viewport-bottom, 0px))',
    });
    expect(screen.getByTestId('service-sticky-spacer')).toHaveStyle({
      height: 'calc(4.75rem + env(safe-area-inset-bottom, 0px) + var(--ios-chrome-viewport-bottom, 0px))',
    });
    expect(stickyBar).toHaveStyle({
      bottom: 'var(--ios-chrome-viewport-bottom, 0px)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    });
    expect(screen.getByTestId('service-sticky-addon-note')).toHaveTextContent('Optional add-ons available');
    expect(screen.getByTestId('service-sticky-addon-note')).toHaveClass('text-[9px]');
    expect(screen.getByTestId('service-card-image-svc-1')).toHaveClass('h-[68px]');
    expect(screen.getByTestId('service-card-content-svc-1')).toHaveClass('flex', 'flex-1', 'flex-col', 'min-h-[104px]', 'p-2.5');
    expect(screen.getByTestId('service-card-meta-row-svc-1')).toHaveClass('mt-auto', 'flex', 'items-end', 'justify-between', 'pt-2.5');
    expect(screen.getByTestId('service-card-price-svc-1')).toHaveClass('shrink-0', 'text-lg', 'font-bold', 'leading-none', 'text-right');
    expect(selectedCard.querySelector('svg')).toBeNull();
    expect(selectedCard.getAttribute('style')).not.toContain('outline');
    expect(screen.queryByTestId('service-card-addon-cue-svc-2')).not.toBeInTheDocument();
  });

  it('describes required-only and mixed add-on groups without calling required choices optional', () => {
    const requiredRule = {
      id: 'rule-required',
      serviceId: 'svc-1',
      addOnId: 'addon-1',
      selectionMode: 'required' as const,
      defaultQuantity: 1,
      maxQuantityOverride: null,
      displayOrder: 1,
    };
    const optionalRule = {
      id: 'rule-optional',
      serviceId: 'svc-1',
      addOnId: 'addon-2',
      selectionMode: 'optional' as const,
      defaultQuantity: null,
      maxQuantityOverride: null,
      displayOrder: 2,
    };
    const { rerender } = render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={[requiredRule]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    fireEvent.click(screen.getByTestId('service-card-svc-1'));

    const requiredOnlyPanel = screen.getByTestId('service-inline-addons-panel');

    expect(within(requiredOnlyPanel).getByText('Required add-ons for Colour Change')).toBeInTheDocument();
    expect(within(requiredOnlyPanel).queryByText(/Optional add-ons for/i)).not.toBeInTheDocument();
    expect(within(requiredOnlyPanel).getByText('Required')).toBeInTheDocument();
    expect(screen.getByTestId('service-sticky-addon-note')).toHaveTextContent('Required add-ons included');

    rerender(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={[requiredRule, optionalRule]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    const mixedPanel = screen.getByTestId('service-inline-addons-panel');

    expect(within(mixedPanel).getByText('Required and optional add-ons for Colour Change')).toBeInTheDocument();
    expect(screen.getByTestId('service-sticky-addon-note')).toHaveTextContent('Required and optional add-ons');
  });

  it('announces canonical price and duration totals after named add-on quantity changes without initial chatter', async () => {
    const accessibleAddOns = [
      {
        id: 'addon-price-only',
        name: 'Luster Product Upgrade',
        descriptionItems: ['Premium product'],
        category: 'nail_art' as const,
        pricingType: 'fixed' as const,
        unitLabel: null,
        maxQuantity: 1,
        durationMinutes: 0,
        priceCents: 500,
        priceDisplayText: null,
        isActive: true,
      },
      {
        id: 'addon-duration-only',
        name: 'Base Coat',
        descriptionItems: ['Extra preparation'],
        category: 'nail_art' as const,
        pricingType: 'fixed' as const,
        unitLabel: null,
        maxQuantity: 1,
        durationMinutes: 5,
        priceCents: 0,
        priceDisplayText: null,
        isActive: true,
      },
      {
        id: 'addon-combined',
        name: 'Nail Repair',
        descriptionItems: ['Per nail'],
        category: 'repair' as const,
        pricingType: 'per_unit' as const,
        unitLabel: 'nail',
        maxQuantity: 2,
        durationMinutes: 10,
        priceCents: 500,
        priceDisplayText: null,
        isActive: true,
      },
    ];
    const accessibleRules = accessibleAddOns.map((addOn, index) => ({
      id: `rule-accessible-${index}`,
      serviceId: 'svc-1',
      addOnId: addOn.id,
      selectionMode: 'optional' as const,
      defaultQuantity: null,
      maxQuantityOverride: null,
      displayOrder: index,
    }));

    render(
      <BookServiceClient
        services={services}
        addOns={accessibleAddOns}
        serviceAddOnRules={accessibleRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    const announcement = screen.getByTestId('service-addon-announcement');

    expect(announcement).toHaveAttribute('role', 'status');
    expect(announcement).toHaveAttribute('aria-live', 'polite');
    expect(announcement).toHaveAttribute('aria-atomic', 'true');
    expect(announcement).toBeEmptyDOMElement();

    fireEvent.click(screen.getByTestId('service-card-svc-1'));

    expect(announcement).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('button', { name: 'Add Luster Product Upgrade' }));
    await waitFor(() => expect(announcement).toHaveTextContent(
      'Booking total updated. Price $45. Duration 30 min.',
    ));

    expect(within(screen.getByTestId('service-sticky-bar')).getByText('$45')).toBeInTheDocument();
    expect(within(screen.getByTestId('service-sticky-bar')).getByText('30 min')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Base Coat' }));
    await waitFor(() => expect(announcement).toHaveTextContent(
      'Booking total updated. Price $45. Duration 35 min.',
    ));

    const decreaseRepair = screen.getByRole('button', { name: 'Decrease Nail Repair quantity' });
    const increaseRepair = screen.getByRole('button', { name: 'Increase Nail Repair quantity' });

    expect(decreaseRepair).toBeDisabled();

    fireEvent.click(increaseRepair);
    await waitFor(() => expect(announcement).toHaveTextContent(
      'Booking total updated. Price $50. Duration 45 min.',
    ));

    expect(decreaseRepair).toBeEnabled();

    fireEvent.click(increaseRepair);
    await waitFor(() => expect(announcement).toHaveTextContent(
      'Booking total updated. Price $55. Duration 55 min.',
    ));

    expect(increaseRepair).toBeDisabled();

    fireEvent.click(decreaseRepair);
    await waitFor(() => expect(announcement).toHaveTextContent(
      'Booking total updated. Price $50. Duration 45 min.',
    ));

    fireEvent.click(decreaseRepair);
    await waitFor(() => expect(announcement).toHaveTextContent(
      'Booking total updated. Price $45. Duration 35 min.',
    ));

    expect(decreaseRepair).toBeDisabled();
  });

  it('keeps footer clearance aligned with the changing iPhone Chrome visual viewport', () => {
    const originalInnerHeight = window.innerHeight;
    const originalInnerWidth = window.innerWidth;
    const listeners = new Map<string, EventListener>();
    const visualViewport = {
      height: 700,
      offsetTop: 0,
      addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
      removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    };

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone) CriOS/126.0 Mobile/15E148 Safari/604.1',
    });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });

    const { unmount } = render(
      <BookServiceClient
        services={services}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    fireEvent.click(screen.getByTestId('service-card-svc-1'));

    expect(document.documentElement).toHaveStyle('--ios-chrome-viewport-bottom: 144px');
    expect(screen.getByTestId('service-sticky-spacer')).toHaveStyle({
      height: 'calc(4.75rem + env(safe-area-inset-bottom, 0px) + var(--ios-chrome-viewport-bottom, 0px))',
    });

    visualViewport.height = 780;
    listeners.get('resize')?.(new Event('resize'));

    expect(document.documentElement).toHaveStyle('--ios-chrome-viewport-bottom: 64px');

    unmount();

    expect(document.documentElement.style.getPropertyValue('--ios-chrome-viewport-bottom')).toBe('');

    Reflect.deleteProperty(window.navigator, 'userAgent');
    Reflect.deleteProperty(window, 'visualViewport');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
  });

  it('keeps iPhone Safari on safe-area spacing without applying the Chrome toolbar offset', () => {
    const originalInnerWidth = window.innerWidth;
    const visualViewport = {
      height: 700,
      offsetTop: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });

    const { unmount } = render(
      <BookServiceClient
        services={services}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    fireEvent.click(screen.getByTestId('service-card-svc-1'));

    expect(document.documentElement.style.getPropertyValue('--ios-chrome-viewport-bottom')).toBe('');
    expect(visualViewport.addEventListener).not.toHaveBeenCalled();
    expect(screen.getByTestId('service-sticky-spacer')).toHaveStyle({
      height: 'calc(4.75rem + env(safe-area-inset-bottom, 0px) + var(--ios-chrome-viewport-bottom, 0px))',
    });
    expect(screen.getByTestId('service-sticky-bar')).toHaveStyle({
      bottom: 'var(--ios-chrome-viewport-bottom, 0px)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    });

    unmount();
    Reflect.deleteProperty(window.navigator, 'userAgent');
    Reflect.deleteProperty(window, 'visualViewport');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  });

  it('clears the selection and hides service-dependent UI when the selected service is tapped again', async () => {
    render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    const selectedCard = screen.getByTestId('service-card-svc-1');

    fireEvent.click(selectedCard);
    await waitFor(() => {
      expect(screen.getByTestId('service-sticky-bar')).toBeInTheDocument();
    });

    fireEvent.click(selectedCard);

    await waitFor(() => {
      expect(screen.getByTestId('service-card-svc-1')).toHaveAttribute('data-selected', 'false');
    });

    expect(screen.queryByTestId('service-inline-addons-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-sticky-spacer')).not.toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue('--service-sticky-footer-clearance')).toBe('');
    expect(screen.queryByTestId('service-card-addon-cue-svc-1')).not.toBeInTheDocument();
  });

  it('renders the fallback service image when the provided URL is blank', () => {
    render(
      <BookServiceClient
        services={[
          {
            ...services[0]!,
            id: 'svc-blank',
            imageUrl: '   ',
          },
        ]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    expect(screen.getByTestId('service-card-image-element-svc-blank')).toHaveAttribute(
      'src',
      '/assets/images/biab-short.webp',
    );
  });

  it('swaps to the fallback image on first load failure and then to a placeholder on fallback failure', async () => {
    render(
      <BookServiceClient
        services={[
          {
            ...services[0]!,
            id: 'svc-broken',
            imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/services/broken.jpg',
          },
        ]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    const image = screen.getByTestId('service-card-image-element-svc-broken');
    fireEvent.error(image);

    await waitFor(() => {
      expect(screen.getByTestId('service-card-image-element-svc-broken')).toHaveAttribute(
        'src',
        '/assets/images/biab-short.webp',
      );
    });

    fireEvent.error(screen.getByTestId('service-card-image-element-svc-broken'));

    await waitFor(() => {
      expect(screen.getByTestId('service-card-image-placeholder-svc-broken')).toBeInTheDocument();
    });
  });

  it('does not render the add-on cue, panel, or sticky note when the selected service has no allowed add-ons', () => {
    render(
      <BookServiceClient
        services={[noAddOnService]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    fireEvent.click(screen.getByTestId('service-card-svc-3'));

    expect(screen.queryByTestId('service-card-addon-cue-svc-3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-inline-addons-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-sticky-addon-note')).not.toBeInTheDocument();
    expect(screen.getByTestId('service-sticky-bar')).toBeInTheDocument();
    expect(screen.queryByText(/Optional add-ons for/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No add-ons available for this service yet/i)).not.toBeInTheDocument();
  });

  it('moves or removes the inline add-on affordance when the selection changes', async () => {
    render(
      <BookServiceClient
        services={[...services, noAddOnService]}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    fireEvent.click(screen.getByTestId('service-card-svc-1'));

    expect(screen.getByTestId('service-card-addon-cue-svc-1')).toBeInTheDocument();
    expect(screen.getByText(/Optional add-ons for Colour Change/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('service-card-svc-3'));

    await waitFor(() => {
      expect(screen.queryByTestId('service-card-addon-cue-svc-1')).not.toBeInTheDocument();
    });

    expect(screen.queryByTestId('service-inline-addons-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-sticky-addon-note')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('service-card-svc-2'));

    await waitFor(() => {
      expect(screen.getByTestId('service-card-addon-cue-svc-2')).toBeInTheDocument();
    });

    expect(screen.getByText(/Optional add-ons for Gel X/i)).toBeInTheDocument();
    expect(screen.getByTestId('service-sticky-addon-note')).toHaveTextContent('Optional add-ons available');
  });

  it('applies only the persisted location after hydration, never the persisted service', async () => {
    bookingStateMock.values = {
      technicianId: null,
      technicianSelectionSource: null,
      baseServiceId: 'svc-2',
      selectedAddOns: [{ addOnId: 'addon-1' }],
      locationId: 'loc-2',
      isHydrated: false,
    };

    const { rerender } = render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={locations}
      />,
    );

    expect(screen.getByTestId('service-card-svc-2')).toHaveAttribute('data-selected', 'false');
    expect(screen.queryByText(/Optional add-ons for Gel X/i)).not.toBeInTheDocument();

    bookingStateMock.values = {
      ...bookingStateMock.values,
      isHydrated: true,
    };

    rerender(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={locations}
      />,
    );

    // The persisted location still applies...
    await waitFor(() => {
      expect(bookingStateMock.setLocationId).toHaveBeenCalledWith('loc-2');
    });

    // ...but the persisted service never presses a card or opens the panel.
    expect(screen.getByTestId('service-card-svc-2')).toHaveAttribute('data-selected', 'false');
    expect(screen.queryByTestId('service-inline-addons-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
    expect(screen.queryByText(/1 service \+ 1 add-on/i)).not.toBeInTheDocument();
  });

  it('lands on a blank menu when a finished booking left a service persisted', async () => {
    bookingStateMock.values = {
      technicianId: null,
      technicianSelectionSource: null,
      baseServiceId: 'svc-2',
      selectedAddOns: [{ addOnId: 'addon-1' }],
      locationId: 'loc-2',
      isHydrated: true,
    };

    render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={locations}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('service-card-svc-2')).toHaveAttribute('data-selected', 'false');
    });

    expect(screen.getByTestId('service-card-svc-1')).toHaveAttribute('data-selected', 'false');
    expect(screen.queryByTestId('service-inline-addons-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-card-addon-cue-svc-2')).not.toBeInTheDocument();
  });

  it('mirrors a picked service into the URL so browser back can restore it', async () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});

    render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    // A blank landing must not touch the URL.
    expect(replaceStateSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('service-card-svc-1'));

    await waitFor(() => {
      expect(replaceStateSpy).toHaveBeenCalled();
    });

    const selectedUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;

    expect(selectedUrl).toContain('baseServiceId=svc-1');
    expect(selectedUrl).toContain('salonSlug=salon-a');

    replaceStateSpy.mockRestore();
  });

  it('drops the mirrored params from the URL when the service is unselected', async () => {
    navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a&baseServiceId=svc-1');
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});

    render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    expect(screen.getByTestId('service-card-svc-1')).toHaveAttribute('data-selected', 'true');

    fireEvent.click(screen.getByTestId('service-card-svc-1'));

    await waitFor(() => {
      expect(replaceStateSpy).toHaveBeenCalled();
    });

    const clearedUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;

    // Left in place, these would resurrect the pick on the next reload.
    expect(clearedUrl).not.toContain('baseServiceId');
    expect(clearedUrl).not.toContain('selectedAddOns');
    expect(clearedUrl).toContain('salonSlug=salon-a');

    replaceStateSpy.mockRestore();
  });

  it('still pre-selects from the URL so browser back restores the pick', () => {
    navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a&baseServiceId=svc-1');

    render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    expect(screen.getByTestId('service-card-svc-1')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('service-sticky-bar')).toBeInTheDocument();
  });

  it('keeps URL service, add-ons, and location ahead of persisted state', async () => {
    navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a&baseServiceId=svc-1&locationId=loc-1');
    navigationMock.searchParams.set('selectedAddOns', JSON.stringify([{ addOnId: 'addon-2' }]));
    bookingStateMock.values = {
      technicianId: null,
      technicianSelectionSource: null,
      baseServiceId: 'svc-2',
      selectedAddOns: [{ addOnId: 'addon-1' }],
      locationId: 'loc-2',
      isHydrated: true,
    };

    render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={locations}
      />,
    );

    expect(screen.getByTestId('service-inline-addons-panel')).toBeInTheDocument();
    expect(screen.getByText(/Optional add-ons for Colour Change/i)).toBeInTheDocument();
    expect(screen.getByTestId('service-card-addon-cue-svc-1')).toBeInTheDocument();
    expect(screen.getByTestId('service-sticky-addon-note')).toHaveTextContent('Optional add-ons available');
    expect(screen.queryByText(/Optional add-ons for Gel X/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('service-addon-announcement')).toBeEmptyDOMElement();

    await waitFor(() => {
      expect(bookingStateMock.syncFromUrl).toHaveBeenCalledWith(expect.objectContaining({
        baseServiceId: 'svc-1',
        selectedAddOns: [{ addOnId: 'addon-2', quantity: undefined }],
        serviceIds: [],
        locationId: 'loc-1',
        techId: null,
        technicianSelectionSource: null,
      }));
    });
  });

  it('keeps the invalid location fallback stable instead of switching to persisted location after hydration', async () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a&baseServiceId=svc-1&locationId=missing');
    bookingStateMock.values = {
      technicianId: null,
      technicianSelectionSource: null,
      baseServiceId: 'svc-2',
      selectedAddOns: [{ addOnId: 'addon-1' }],
      locationId: 'loc-2',
      isHydrated: true,
    };

    render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={locations}
      />,
    );

    expect(screen.getByText(/Location not found, defaulted to Downtown\./i)).toBeInTheDocument();

    await waitFor(() => {
      expect(bookingStateMock.syncFromUrl).toHaveBeenCalledWith(expect.objectContaining({
        baseServiceId: 'svc-1',
        selectedAddOns: [],
        serviceIds: [],
        locationId: 'loc-1',
        techId: null,
        technicianSelectionSource: null,
      }));
    });

    expect(replaceStateSpy).toHaveBeenCalled();

    replaceStateSpy.mockRestore();
  });
});

describe('BookServiceClient — Luster Manicure price consistency', () => {
  const lusterService = {
    id: 'svc-luster',
    name: 'Luster Manicure',
    description: null,
    descriptionItems: ['A premium structured manicure'],
    durationMinutes: 60,
    priceCents: 5500,
    priceDisplayText: null,
    category: 'manicure' as const,
    bookingCategory: 'manicure' as const,
    templateKey: 'luster_manicure',
    featuredOrder: null,
    imageUrl: '/service-luster.jpg',
    resolvedIntroPriceLabel: 'Intro price',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetBookingExperienceMock();
    navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a');
    clientSessionMock.isLoggedIn = false;
    clientSessionMock.isCheckingSession = false;
    bookingStateMock.values = {
      technicianId: null,
      technicianSelectionSource: null,
      baseServiceId: null,
      selectedAddOns: [],
      locationId: null,
      isHydrated: true,
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows $55 on the featured card, the regular card, and the sticky footer', () => {
    render(
      <BookServiceClient
        services={[lusterService, services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
        lusterFeaturingEnabled
      />,
    );

    const featuredCard = screen.getByTestId('featured-service-card-svc-luster');

    expect(within(featuredCard).getByText('$55')).toBeInTheDocument();

    const regularPrice = screen.getByTestId('service-card-price-svc-luster');

    expect(regularPrice).toHaveTextContent('$55');

    // The intro badge is a label, never a price substitute.
    const regularCard = screen.getByTestId('service-card-svc-luster');

    expect(within(regularCard).getByText('Intro price')).toBeInTheDocument();

    fireEvent.click(regularCard);

    const stickyBar = screen.getByTestId('service-sticky-bar');

    expect(within(stickyBar).getByText('$55')).toBeInTheDocument();
  });

  it('documents the display contract: cards render priceDisplayText but the footer always charges priceCents', () => {
    // The incident shape: a stale $45 bookable price masked by a "$75+"
    // display override. The override changes card text only — the charged
    // total (footer, POST, snapshot) always follows priceCents.
    const staleService = {
      ...lusterService,
      id: 'svc-stale',
      priceCents: 4500,
      priceDisplayText: '$75+',
      resolvedIntroPriceLabel: '$55',
    };

    render(
      <BookServiceClient
        services={[staleService, services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
        lusterFeaturingEnabled
      />,
    );

    const featuredCard = screen.getByTestId('featured-service-card-svc-stale');

    expect(within(featuredCard).getByText('$75+')).toBeInTheDocument();
    expect(screen.getByTestId('service-card-price-svc-stale')).toHaveTextContent('$75+');

    fireEvent.click(screen.getByTestId('service-card-svc-stale'));

    const stickyBar = screen.getByTestId('service-sticky-bar');

    expect(within(stickyBar).getByText('$45')).toBeInTheDocument();
    expect(within(stickyBar).queryByText('$75+')).not.toBeInTheDocument();
  });

  it('keeps featured cards inside narrow viewports and wraps long names intentionally', () => {
    render(
      <BookServiceClient
        services={[lusterService, services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
        lusterFeaturingEnabled
      />,
    );

    const featuredCard = screen.getByTestId('featured-service-card-svc-luster');

    // Viewport-aware width: 272px cap shrinks with the viewport at ≤320px
    // while the sm: overrides keep tablet/desktop unchanged.
    expect(featuredCard).toHaveClass(
      'w-[min(272px,calc(100vw-4rem))]',
      'shrink-0',
      'sm:w-[280px]',
    );
    expect(within(featuredCard).getByText('Luster Manicure')).toHaveClass('line-clamp-2', 'break-words');

    const regularCard = screen.getByTestId('service-card-svc-luster');

    expect(within(regularCard).getByText('Luster Manicure')).toHaveClass('break-words');
  });

  it('keeps the sticky footer a single stable-height row so the reserved clearance always covers it', () => {
    render(
      <BookServiceClient
        services={[lusterService, services[0]!]}
        addOns={addOns}
        serviceAddOnRules={[{
          id: 'rule-luster',
          serviceId: 'svc-luster',
          addOnId: 'addon-1',
          selectionMode: 'optional' as const,
          defaultQuantity: null,
          maxQuantityOverride: null,
          displayOrder: 1,
        }]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
        lusterFeaturingEnabled
      />,
    );

    fireEvent.click(screen.getByTestId('service-card-svc-luster'));

    const stickyBar = screen.getByTestId('service-sticky-bar');
    const innerRow = stickyBar.querySelector('.mx-auto');

    expect(innerRow).toHaveClass('flex-nowrap');
    expect(within(stickyBar).getByText('1 service')).toHaveClass('truncate');
    expect(screen.getByTestId('service-sticky-addon-note')).toHaveClass('truncate', 'text-[9px]');
  });
});
