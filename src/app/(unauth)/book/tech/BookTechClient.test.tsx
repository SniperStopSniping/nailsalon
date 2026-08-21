import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BookTechClient } from './BookTechClient';

const {
  routerBack,
  routerPush,
  setTechnicianId,
  syncFromUrl,
  bookingFloatingDockRender,
  blockingLoginModalRender,
  bookingPhoneLoginRender,
  legacyAuthFetch,
} = vi.hoisted(() => ({
  routerBack: vi.fn(),
  routerPush: vi.fn(),
  setTechnicianId: vi.fn(),
  syncFromUrl: vi.fn(),
  bookingFloatingDockRender: vi.fn(),
  blockingLoginModalRender: vi.fn(),
  bookingPhoneLoginRender: vi.fn(),
  legacyAuthFetch: vi.fn(),
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
  BlockingLoginModal: () => {
    blockingLoginModalRender();
    return (
      <div role="dialog" aria-label="Legacy customer login modal">
        <button type="button">Verify</button>
      </div>
    );
  },
}));

vi.mock('@/components/booking/BookingStepHeader', () => ({
  BookingStepHeader: () => <div>Header</div>,
}));

vi.mock('@/components/booking/BookingFloatingDock', () => ({
  BookingFloatingDock: () => {
    bookingFloatingDockRender();
    return <nav aria-label="Legacy customer account dock">Account dock</nav>;
  },
}));

vi.mock('@/components/booking/BookingPhoneLogin', () => ({
  BookingPhoneLogin: () => {
    bookingPhoneLoginRender();
    return (
      <section aria-label="Legacy customer login card">
        <label htmlFor="legacy-customer-phone">Phone number</label>
        <input id="legacy-customer-phone" type="tel" />
        <button type="button">Send code</button>
      </section>
    );
  },
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

describe('BookTechClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', legacyAuthFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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
    expect(legacyAuthFetch).not.toHaveBeenCalled();
  });

  it('renders unsupported technicians as disabled and does not navigate on click', () => {
    vi.useFakeTimers();

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
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(routerPush).not.toHaveBeenCalled();
    expect(setTechnicianId).not.toHaveBeenCalled();
    expect(legacyAuthFetch).not.toHaveBeenCalled();
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
    expect(screen.getByTestId('booking-summary-duration')).toHaveTextContent('30 min');
    expect(screen.getByTestId('booking-summary-price')).toHaveTextContent('$25');
    expect(screen.getByText('No reviews yet')).toBeInTheDocument();
    expect(screen.queryByText(/\(0\)/)).not.toBeInTheDocument();
    expect(legacyAuthFetch).not.toHaveBeenCalled();
  });

  it('removes legacy login UI and lets a signed-out guest continue from a tech-first flow', () => {
    vi.useFakeTimers();

    const { container } = render(
      <BookTechClient
        technicians={[{
          id: 'tech_1',
          name: 'Taylor',
          imageUrl: null,
          specialties: ['Gel Manicure'],
          rating: 4.8,
          reviewCount: 9,
          bookable: true,
          unavailableReason: null,
        }]}
        services={[{ id: 'svc_1', name: 'Gel Manicure', price: 45, duration: 45 }]}
        totalPrice={45}
        totalDuration={45}
        locationName="Isla Nail Studio"
        bookingFlow={['tech', 'service', 'time', 'confirm']}
      />,
    );

    expect(bookingPhoneLoginRender).not.toHaveBeenCalled();
    expect(blockingLoginModalRender).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/phone number/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /legacy customer login/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send code/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /verify/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/log in|sign in|customer login/i)).not.toBeInTheDocument();
    expect(bookingFloatingDockRender).not.toHaveBeenCalled();
    expect(screen.queryByRole('navigation', { name: /legacy customer account dock/i })).not.toBeInTheDocument();
    expect(container.querySelector('.h-16')).not.toBeInTheDocument();
    expect(legacyAuthFetch).not.toHaveBeenCalled();

    const anyArtistButton = screen.getByRole('button', {
      name: 'Any eligible technician — maximum availability',
    });

    expect(anyArtistButton).toBeInTheDocument();
    expect(screen.queryByText(/surprise me|🎲/iu)).not.toBeInTheDocument();

    fireEvent.mouseEnter(anyArtistButton);
    fireEvent.mouseLeave(anyArtistButton);

    expect(legacyAuthFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Taylor/i }));

    expect(setTechnicianId).toHaveBeenNthCalledWith(1, 'tech_1', 'explicit');
    expect(routerPush).not.toHaveBeenCalled();
    expect(legacyAuthFetch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(299);
    });

    expect(routerPush).not.toHaveBeenCalled();
    expect(legacyAuthFetch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(setTechnicianId).toHaveBeenNthCalledWith(2, 'tech_1', 'explicit');
    expect(routerPush).toHaveBeenCalledWith(expect.stringContaining('/book/service'));
    expect(routerPush).toHaveBeenCalledWith(expect.stringContaining('techId=tech_1'));
    expect(legacyAuthFetch).not.toHaveBeenCalled();
  });

  it('keeps any-technician selection working without customer-auth traffic', () => {
    vi.useFakeTimers();

    render(
      <BookTechClient
        technicians={[{
          id: 'tech_1',
          name: 'Taylor',
          imageUrl: null,
          specialties: ['Gel Manicure'],
          rating: 4.8,
          reviewCount: 9,
          bookable: true,
          unavailableReason: null,
        }]}
        services={[{ id: 'svc_1', name: 'Gel Manicure', price: 45, duration: 45 }]}
        totalPrice={45}
        totalDuration={45}
        locationName="Isla Nail Studio"
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    fireEvent.click(screen.getByRole('button', {
      name: 'Any eligible technician — maximum availability',
    }));

    expect(setTechnicianId).toHaveBeenNthCalledWith(1, null, null);
    expect(routerPush).not.toHaveBeenCalled();
    expect(legacyAuthFetch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(setTechnicianId).toHaveBeenNthCalledWith(2, null, null);
    expect(routerPush).toHaveBeenCalledWith(expect.stringContaining('/book/time'));
    expect(routerPush).toHaveBeenCalledWith(expect.stringContaining('techId=any'));
    expect(legacyAuthFetch).not.toHaveBeenCalled();
  });

  it('provides one non-nested main landmark for the technician step', () => {
    const { container } = render(
      <BookTechClient
        technicians={[]}
        services={[{ id: 'svc_1', name: 'Gel Manicure', price: 45, duration: 45 }]}
        totalPrice={45}
        totalDuration={45}
        locationName="Isla Nail Studio"
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(container.querySelector('main main')).toBeNull();
  });
});
