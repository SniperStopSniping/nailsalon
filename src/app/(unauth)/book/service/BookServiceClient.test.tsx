import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BookServiceClient } from './BookServiceClient';

const {
  bookingStateMock,
  clientSessionMock,
  navigationMock,
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
}));

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

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({
    salonName: 'Salon A',
    salonSlug: 'salon-a',
  }),
}));

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

  it('renders the new-client promo in the branded header slot instead of the old generic offer card', () => {
    render(
      <BookServiceClient
        services={[services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
        showNewClientPromo
      />,
    );

    expect(screen.getByTestId('booking-step-header-salon-variant')).toHaveTextContent('editorial');
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
    expect(screen.getByTestId('booking-step-header')).toHaveTextContent('service > tech > time > confirm');
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
    expect(screen.getByTestId('booking-step-header')).toHaveTextContent('service > time > confirm');
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
    expect(screen.getByTestId('booking-step-header')).toHaveTextContent('service > time > confirm');

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
    expect(screen.getByTestId('booking-step-header')).toHaveTextContent('service > time > confirm');

    fireEvent.click(screen.getByTestId('service-card-svc-2'));

    await waitFor(() => {
      expect(screen.queryByTestId('service-auto-technician-preview')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('booking-step-header')).toHaveTextContent('service > tech > time > confirm');
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
    expect(screen.getByTestId('booking-step-header')).toHaveTextContent('service > tech > time > confirm');
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

  it('applies persisted booking state only after hydration when no URL selection exists', async () => {
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

    expect(screen.queryByText(/Optional add-ons for Gel X/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1 service \+ 1 add-on/i)).not.toBeInTheDocument();

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

    await waitFor(() => {
      expect(screen.getByTestId('service-inline-addons-panel')).toBeInTheDocument();
    });

    expect(screen.getByText(/Optional add-ons for Gel X/i)).toBeInTheDocument();
    expect(screen.getByTestId('service-card-addon-cue-svc-2')).toBeInTheDocument();
    expect(screen.getByTestId('service-sticky-addon-note')).toHaveTextContent('Optional add-ons available');
    expect(screen.getByText(/1 service \+ 1 add-on/i)).toBeInTheDocument();
  });

  it('keeps a manually unselected restored service cleared for the current page session', async () => {
    bookingStateMock.values = {
      technicianId: null,
      technicianSelectionSource: null,
      baseServiceId: 'svc-2',
      selectedAddOns: [{ addOnId: 'addon-1' }],
      locationId: 'loc-2',
      isHydrated: true,
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

    await waitFor(() => {
      expect(screen.getByTestId('service-card-svc-2')).toHaveAttribute('data-selected', 'true');
    });

    fireEvent.click(screen.getByTestId('service-card-svc-2'));

    await waitFor(() => {
      expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
    });

    rerender(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={locations}
      />,
    );

    expect(screen.getByTestId('service-card-svc-2')).toHaveAttribute('data-selected', 'false');
    expect(screen.queryByTestId('service-inline-addons-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-sticky-bar')).not.toBeInTheDocument();
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
