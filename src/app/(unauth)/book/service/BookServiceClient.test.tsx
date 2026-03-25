import React from 'react';

import { render, screen } from '@testing-library/react';
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
});
