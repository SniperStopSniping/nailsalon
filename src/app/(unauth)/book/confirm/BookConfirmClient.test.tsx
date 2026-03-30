import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { routerBack, routerPush, syncFromUrl, fetchMock, windowOpen } = vi.hoisted(() => ({
  routerBack: vi.fn(),
  routerPush: vi.fn(),
  syncFromUrl: vi.fn(),
  fetchMock: vi.fn(),
  windowOpen: vi.fn(),
}));

vi.mock('canvas-confetti', () => ({
  default: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: routerBack,
    push: routerPush,
  }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams('techId=tech_1'),
}));

vi.mock('@/hooks/useBookingState', () => ({
  useBookingState: () => ({
    syncFromUrl,
  }),
}));

vi.mock('@/hooks/useClientSession', () => ({
  useClientSession: () => ({
    isLoggedIn: true,
    isCheckingSession: false,
    handleLoginSuccess: vi.fn(),
    validateSession: vi.fn(),
    clientName: 'Ava',
  }),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({
    salonName: 'Salon A',
    salonSlug: 'salon-a',
  }),
}));

vi.mock('framer-motion', () => {
  const makeMotionTag = (tag: string) =>
    React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ children, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children),
    );

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy({}, {
      get: (_, tag: string) => makeMotionTag(tag),
    }),
    useMotionValue: () => ({ set: vi.fn() }),
    useReducedMotion: () => true,
    useTransform: () => 0,
  };
});

import { BookConfirmClient } from './BookConfirmClient';

describe('BookConfirmClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.open = windowOpen;
  });

  it('does not create a booking on initial page load', () => {
    render(
      <BookConfirmClient
        services={[{ id: 'srv_1', name: 'Gel Manicure', price: 65, duration: 75 }]}
        subtotalBeforeDiscount={65}
        discountAmount={0}
        totalPrice={65}
        totalDuration={75}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        salonSlug="salon-a"
        dateStr="2026-03-20"
        timeStr="10:00"
        bookingFlow={[]}
        location={null}
      />,
    );

    expect(screen.getByText('Review your appointment')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm appointment/i })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(syncFromUrl).toHaveBeenCalledWith(expect.objectContaining({ techId: 'tech_1' }));
  });

  it('routes the confirmed booking to payment methods instead of a missing payment page', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        appointment: {
          id: 'appt_123',
        },
      },
    }), { status: 200 }));

    render(
      <BookConfirmClient
        services={[{ id: 'srv_1', name: 'Gel Manicure', price: 65, duration: 75 }]}
        subtotalBeforeDiscount={65}
        discountAmount={0}
        totalPrice={65}
        totalDuration={75}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        salonSlug="salon-a"
        dateStr="2026-03-20"
        timeStr="10:00"
        bookingFlow={[]}
        location={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /manage payment methods/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /manage payment methods/i }));

    expect(routerPush).toHaveBeenCalledWith('/en/salon-a/payment-methods');
  });

  it('does not imply visit points are already in the rewards balance after booking', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        appointment: {
          id: 'appt_123',
        },
      },
    }), { status: 200 }));

    render(
      <BookConfirmClient
        services={[{ id: 'srv_1', name: 'Gel Manicure', price: 65, duration: 75 }]}
        subtotalBeforeDiscount={65}
        discountAmount={0}
        totalPrice={65}
        totalDuration={75}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        salonSlug="salon-a"
        dateStr="2026-03-20"
        timeStr="10:00"
        bookingFlow={[]}
        location={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^view rewards & pending points$/i })).toBeInTheDocument();
    });

    expect(screen.queryByText(/view rewards balance \(\+/i)).not.toBeInTheDocument();
    expect(screen.getByText(/estimated reward after completion:/i)).toBeInTheDocument();
  });

  it('opens Google Maps directions from the confirmed screen when location details exist', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        appointment: {
          id: 'appt_123',
        },
      },
    }), { status: 200 }));

    render(
      <BookConfirmClient
        services={[{ id: 'srv_1', name: 'Gel Manicure', price: 65, duration: 75 }]}
        subtotalBeforeDiscount={65}
        discountAmount={0}
        totalPrice={65}
        totalDuration={75}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        salonSlug="salon-a"
        dateStr="2026-03-20"
        timeStr="10:00"
        bookingFlow={[]}
        location={{
          id: 'loc_1',
          name: 'Queen West',
          address: '123 Queen St W',
          city: 'Toronto',
          state: 'ON',
          zipCode: 'M5H 2M9',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm appointment/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^directions$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^directions$/i }));

    expect(windowOpen).toHaveBeenCalledWith(
      'https://www.google.com/maps/dir/?api=1&destination=123%20Queen%20St%20W%2C%20Toronto%2C%20ON%2C%20M5H%202M9',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
