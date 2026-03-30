import React from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  routerBack,
  routerPush,
  setTechnicianId,
  syncFromUrl,
} = vi.hoisted(() => ({
  routerBack: vi.fn(),
  routerPush: vi.fn(),
  setTechnicianId: vi.fn(),
  syncFromUrl: vi.fn(),
}));

vi.mock('next/image', () => ({
  default: ({
    alt,
    src,
    onError,
  }: React.ImgHTMLAttributes<HTMLImageElement> & { src?: string }) => (
    <img alt={alt} src={src} onError={onError} />
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: routerBack,
    push: routerPush,
  }),
  useParams: () => ({ locale: 'en', slug: 'isla-nail-studio' }),
  useSearchParams: () => new URLSearchParams('baseServiceId=svc_1'),
}));

vi.mock('@/components/BlockingLoginModal', () => ({
  BlockingLoginModal: () => null,
}));

vi.mock('@/components/booking/BookingStepHeader', () => ({
  BookingStepHeader: () => <div>Header</div>,
}));

vi.mock('@/components/booking/BookingFloatingDock', () => ({
  BookingFloatingDock: () => null,
}));

vi.mock('@/components/booking/BookingPhoneLogin', () => ({
  BookingPhoneLogin: () => null,
}));

vi.mock('@/hooks/useClientSession', () => ({
  useClientSession: () => ({
    isLoggedIn: true,
    isCheckingSession: false,
    handleLoginSuccess: vi.fn(),
  }),
}));

vi.mock('@/hooks/useBookingState', () => ({
  useBookingState: () => ({
    technicianId: null,
    setTechnicianId,
    syncFromUrl,
  }),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({
    salonName: 'Isla Nail Studio',
    salonSlug: 'isla-nail-studio',
  }),
}));

import { BookTechClient } from './BookTechClient';

describe('BookTechClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows initials fallback for production-invalid local upload URLs', () => {
    vi.stubEnv('NODE_ENV', 'production');

    render(
      <BookTechClient
        technicians={[{
          id: 'tech_1',
          name: 'Daniela Ruiz',
          imageUrl: '/uploads/staff/salon_1/avatar.jpg',
          specialties: ['BIAB'],
          rating: 4.9,
          reviewCount: 12,
          bookable: true,
          unavailableReason: null,
        }]}
        services={[{ id: 'svc_1', name: 'BIAB', price: 50, duration: 75 }]}
        totalPrice={50}
        totalDuration={75}
        locationName="Yorkville"
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    expect(screen.getByText('DR')).toBeInTheDocument();
    expect(screen.queryByAltText('Daniela Ruiz')).not.toBeInTheDocument();

    vi.unstubAllEnvs();
  });

  it('renders unsupported technicians as disabled and does not navigate on click', () => {
    render(
      <BookTechClient
        technicians={[{
          id: 'tech_1',
          name: 'Daniela',
          imageUrl: null,
          specialties: [],
          rating: 5,
          reviewCount: 0,
          bookable: false,
          unavailableReason: 'Not assigned to this service yet',
        }]}
        services={[{ id: 'svc_1', name: 'BIAB + Classic Pedicure', price: 85, duration: 110 }]}
        totalPrice={85}
        totalDuration={110}
        locationName="Yorkville"
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    const techButton = screen.getByRole('button', { name: /Daniela/i });
    expect(techButton).toBeDisabled();
    expect(screen.getByText('Not assigned to this service yet')).toBeInTheDocument();

    fireEvent.click(techButton);
    expect(routerPush).not.toHaveBeenCalled();
    expect(setTechnicianId).not.toHaveBeenCalled();
  });

  it('shows service context above the technician list and uses neutral trust text for artists with no reviews', () => {
    render(
      <BookTechClient
        technicians={[{
          id: 'tech_1',
          name: 'Taylor',
          imageUrl: null,
          specialties: ['Gel Manicure'],
          rating: null,
          reviewCount: 0,
          bookable: true,
          unavailableReason: null,
        }]}
        services={[{ id: 'svc_1', name: 'Colour Change', price: 25, duration: 30 }]}
        totalPrice={25}
        totalDuration={30}
        locationName="Isla Nail Studio"
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    expect(screen.getByText('Selected service')).toBeInTheDocument();
    expect(screen.getByText('Colour Change')).toBeInTheDocument();
    expect(screen.getByText('Isla Nail Studio')).toBeInTheDocument();
    expect(screen.getByText('No reviews yet')).toBeInTheDocument();
    expect(screen.queryByText(/\(0\)/)).not.toBeInTheDocument();
  });
});
