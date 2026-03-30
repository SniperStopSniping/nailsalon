import React from 'react';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  bookingStateMock,
  navigationMock,
} = vi.hoisted(() => ({
  bookingStateMock: {
    values: {
      technicianId: null as string | null,
      baseServiceId: null as string | null,
      selectedAddOns: [] as { addOnId: string; quantity?: number }[],
      locationId: null as string | null,
      isHydrated: true,
    },
    setBaseServiceId: vi.fn(),
    setSelectedAddOns: vi.fn(),
    setServiceIds: vi.fn(),
    syncFromUrl: vi.fn(),
  },
  navigationMock: {
    routerBack: vi.fn(),
    routerPush: vi.fn(),
    searchParams: new URLSearchParams('salonSlug=salon-a'),
  },
}));

vi.mock('next/image', () => ({
  default: ({ alt }: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={alt} />,
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
  BookingStepHeader: () => null,
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
    technicianId: bookingStateMock.values.technicianId,
    baseServiceId: bookingStateMock.values.baseServiceId,
    selectedAddOns: bookingStateMock.values.selectedAddOns,
    locationId: bookingStateMock.values.locationId,
    isHydrated: bookingStateMock.values.isHydrated,
    setBaseServiceId: bookingStateMock.setBaseServiceId,
    setSelectedAddOns: bookingStateMock.setSelectedAddOns,
    setServiceIds: bookingStateMock.setServiceIds,
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

describe('BookServiceClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a');
    bookingStateMock.values = {
      technicianId: null,
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
    );
    expect(screen.getByTestId('service-category-track')).toHaveClass(
      'flex',
      'min-w-max',
      'flex-nowrap',
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

  it('shows the add-on cue, inline panel, and sticky note when the selected service has add-ons', () => {
    render(
      <BookServiceClient
        services={services}
        addOns={addOns}
        serviceAddOnRules={serviceAddOnRules}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    const panel = screen.getByTestId('service-inline-addons-panel');
    expect(screen.getByTestId('service-card-addon-cue-svc-1')).toBeInTheDocument();
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveClass('w-full');
    expect(panel).not.toHaveClass('col-span-2');
    expect(within(panel).getByText('Customize your service')).toBeInTheDocument();
    expect(within(panel).getByText(/Optional add-ons for Colour Change/i)).toBeInTheDocument();
    expect(screen.getByTestId('service-sticky-addon-note')).toHaveTextContent('Optional add-ons available');
    expect(screen.queryByTestId('service-card-addon-cue-svc-2')).not.toBeInTheDocument();
  });

  it('does not render the add-on cue, panel, or sticky note when the selected service has no allowed add-ons', () => {
    render(
      <BookServiceClient
        services={[noAddOnService]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    expect(screen.queryByTestId('service-card-addon-cue-svc-3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-inline-addons-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-sticky-addon-note')).not.toBeInTheDocument();
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

  it('keeps URL service, add-ons, and location ahead of persisted state', async () => {
    navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a&baseServiceId=svc-1&locationId=loc-1');
    navigationMock.searchParams.set('selectedAddOns', JSON.stringify([{ addOnId: 'addon-2' }]));
    bookingStateMock.values = {
      technicianId: null,
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
      expect(bookingStateMock.syncFromUrl).toHaveBeenCalledWith({
        baseServiceId: 'svc-1',
        selectedAddOns: [{ addOnId: 'addon-2' }],
        serviceIds: [],
        locationId: 'loc-1',
      });
    });
  });

  it('keeps the invalid location fallback stable instead of switching to persisted location after hydration', async () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    navigationMock.searchParams = new URLSearchParams('salonSlug=salon-a&baseServiceId=svc-1&locationId=missing');
    bookingStateMock.values = {
      technicianId: null,
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
      expect(bookingStateMock.syncFromUrl).toHaveBeenCalledWith({
        baseServiceId: 'svc-1',
        selectedAddOns: [],
        serviceIds: [],
        locationId: 'loc-1',
      });
    });

    expect(replaceStateSpy).toHaveBeenCalled();
    replaceStateSpy.mockRestore();
  });
});
