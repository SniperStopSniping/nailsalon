import React from 'react';

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={props.alt} />,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn(),
  }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams('salonSlug=salon-a'),
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
    technicianId: null,
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

describe('BookServiceClient', () => {
  it('shows a clear empty state when the salon has no active services', () => {
    render(
      <BookServiceClient
        services={[]}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        locations={[]}
      />,
    );

    expect(screen.getByText("Online booking is not ready yet")).toBeInTheDocument();
    expect(screen.getByText(/does not have any active services available to book right now/i)).toBeInTheDocument();
  });

  it('renders category chips inside a horizontal mobile scroll track in canonical order, including combo', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <BookServiceClient
        services={[
          {
            id: 'svc-1',
            name: 'Russian Manicure',
            description: null,
            descriptionItems: [],
            durationMinutes: 45,
            priceCents: 3500,
            priceDisplayText: null,
            category: 'manicure',
            imageUrl: '/service-1.jpg',
            resolvedIntroPriceLabel: null,
          },
          {
            id: 'svc-2',
            name: 'Builder Gel',
            description: null,
            descriptionItems: [],
            durationMinutes: 75,
            priceCents: 5000,
            priceDisplayText: null,
            category: 'builder_gel',
            imageUrl: '/service-2.jpg',
            resolvedIntroPriceLabel: null,
          },
          {
            id: 'svc-3',
            name: 'Pedicure',
            description: null,
            descriptionItems: [],
            durationMinutes: 60,
            priceCents: 4000,
            priceDisplayText: null,
            category: 'pedicure',
            imageUrl: '/service-3.jpg',
            resolvedIntroPriceLabel: null,
          },
          {
            id: 'svc-4',
            name: 'BIAB + Classic Pedicure',
            description: null,
            descriptionItems: [],
            durationMinutes: 110,
            priceCents: 8500,
            priceDisplayText: null,
            category: 'combo',
            imageUrl: '/service-4.jpg',
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
    expect(screen.getByRole('button', { name: /builder gel/i })).toHaveClass(
      'shrink-0',
      'whitespace-nowrap',
    );
    expect(screen.getByRole('button', { name: /combo/i })).toHaveClass(
      'shrink-0',
      'whitespace-nowrap',
    );
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toContain(
      'Warning: Received `%s` for a non-boolean attribute `%s`.',
    );
    expect(consoleErrorSpy.mock.calls[0]?.[1]).toBe('true');
    expect(consoleErrorSpy.mock.calls[0]?.[2]).toBe('jsx');

    consoleErrorSpy.mockRestore();
  });
});
