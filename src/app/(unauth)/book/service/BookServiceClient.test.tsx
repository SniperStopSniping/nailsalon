import React from 'react';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  }: React.ImgHTMLAttributes<HTMLImageElement> & { src?: string; 'data-testid'?: string }) => (
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
  }: {
    bookingFlow: string[];
  }) => <div data-testid="booking-step-header">{bookingFlow.join(' > ')}</div>,
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

import { BookServiceClient } from './BookServiceClient';

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

  it('shows the subtle first-visit offer note when enabled for the salon', () => {
    render(
      <BookServiceClient
        services={[services[0]!]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
        showFirstVisitOffer
      />,
    );

    expect(screen.getByText('First-visit offer')).toBeInTheDocument();
    expect(screen.getByText('New clients may be eligible for 25% off their first appointment')).toBeInTheDocument();
  });

  it('renders category chips inside a horizontal mobile scroll track in canonical order, including combo', () => {
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
      '✨Builder Gel',
      '🦶Pedicure',
      '✨Combo',
    ]);
    expect(within(track).getByRole('button', { name: /builder gel/i })).toHaveClass(
      'shrink-0',
      'whitespace-nowrap',
    );
    expect(within(track).getByRole('button', { name: /combo/i })).toHaveClass(
      'shrink-0',
      'whitespace-nowrap',
    );
    expect(screen.getByText('Featured services')).toBeInTheDocument();
    expect(screen.getByText('Popular premium sets and combo appointments')).toBeInTheDocument();
    fireEvent.click(within(track).getByRole('button', { name: /combo/i }));
    expect(screen.getByTestId('service-card-svc-6')).toHaveClass('col-span-full');
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

    expect(featuredCard.getAttribute('style')).toContain('0 14px 28px rgba(0,0,0,0.14)');
    expect(featuredCard.getAttribute('style')).toContain('border-width: 1px');
    expect(featuredCard.getAttribute('style')).not.toContain('outline');
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

    fireEvent.click(within(screen.getByTestId('service-category-track')).getByRole('button', { name: /extensions/i }));
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
    expect(panel).toHaveClass('w-full', 'rounded-[24px]', 'px-3.5', 'py-3', 'shadow-[0_8px_22px_rgba(0,0,0,0.04)]');
    expect(panel).not.toHaveClass('col-span-2');
    expect(within(panel).getByText('Customize your service')).toBeInTheDocument();
    expect(within(panel).getByText(/Optional add-ons for Colour Change/i)).toBeInTheDocument();
    expect(within(panel).queryByText(/Add extra time or upgrades without changing your main service/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('service-addon-row-addon-2')).toHaveClass('px-3', 'py-2', 'rounded-[18px]');
    expect(stickyBar).toHaveClass(
      'fixed',
      'bottom-0',
      'left-0',
      'right-0',
      'z-[60]',
      'bg-white/85',
      'supports-[backdrop-filter]:bg-white/82',
      'backdrop-blur-lg',
      'border-white/40',
      'shadow-[0_-8px_30px_rgba(0,0,0,0.08)]',
    );
    expect(screen.getByTestId('service-sticky-spacer')).toBeInTheDocument();
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

    fireEvent.click(within(screen.getByTestId('service-category-track')).getByRole('button', { name: /extensions/i }));
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

    fireEvent.click(within(screen.getByTestId('service-category-track')).getByRole('button', { name: /extensions/i }));
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
