import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BookTimeClient } from './BookTimeClient';

const {
  fetchMock,
  routerBack,
  routerPush,
  syncFromUrl,
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  routerBack: vi.fn(),
  routerPush: vi.fn(),
  syncFromUrl: vi.fn(),
}));

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement('img', {
    alt: props.alt,
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: routerBack,
    push: routerPush,
  }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams('serviceIds=srv_1&techId=tech_1'),
}));

vi.mock('@/components/booking/BookingStepHeader', () => ({
  BookingStepHeader: () => <div data-testid="booking-step-header" />,
}));

vi.mock('@/components/booking/BookingSummaryCard', () => ({
  BookingSummaryCard: () => <div data-testid="booking-summary-card" />,
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
    technicianId: 'stale_tech',
    syncFromUrl,
  }),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({
    salonName: 'Salon A',
    salonSlug: 'salon-a',
  }),
}));

describe('BookTimeClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.setSystemTime(new Date('2026-03-14T11:00:00Z'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not loop availability fetches after the initial render settles', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      visibleSlots: ['09:00', '09:30'],
      bookedSlots: [],
    }), { status: 200 })));

    render(
      <BookTimeClient
        services={[{ id: 'srv_1', name: 'Gel', price: 65, duration: 60 }]}
        totalPrice={65}
        totalDuration={60}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    await screen.findByRole('button', { name: '9:00 AM' });

    const initialCallCount = fetchMock.mock.calls.length;

    expect(initialCallCount).toBeGreaterThan(0);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    expect(fetchMock).toHaveBeenCalledTimes(initialCallCount);
  });

  it('prefers the URL technician when fetching availability for a specific artist', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      visibleSlots: ['09:00'],
      bookedSlots: [],
    }), { status: 200 })));

    render(
      <BookTimeClient
        services={[{ id: 'srv_1', name: 'Gel', price: 65, duration: 60 }]}
        totalPrice={65}
        totalDuration={60}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    await screen.findByRole('button', { name: '9:00 AM' });

    expect(fetchMock).toHaveBeenCalled();

    const [url] = fetchMock.mock.calls[0] ?? [];

    expect(String(url)).toContain('technicianId=tech_1');
    expect(String(url)).not.toContain('technicianId=stale_tech');
  });

  it('shows the backend availability error instead of a fake no-slots state', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      error: {
        message: 'Technician schedule is unavailable for this day.',
      },
    }), { status: 400 })));

    render(
      <BookTimeClient
        services={[{ id: 'srv_1', name: 'Gel', price: 65, duration: 60 }]}
        totalPrice={65}
        totalDuration={60}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    expect(await screen.findByText('Availability could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('Technician schedule is unavailable for this day.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('preserves the service selection when an unsupported technician must be reselected', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: {
        kind: 'unsupported_technician',
        message: 'This service is not available with the selected technician. Please choose another technician.',
        canRetry: false,
        canReselectTechnician: true,
      },
    }), { status: 400 }));

    render(
      <BookTimeClient
        services={[{ id: 'srv_1', name: 'Builder Gel Overlay', price: 65, duration: 90 }]}
        totalPrice={65}
        totalDuration={90}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    const chooseButton = await screen.findByRole('button', { name: 'Choose another technician' });

    expect(screen.queryByText('TECHNICIAN_SERVICE_UNSUPPORTED')).not.toBeInTheDocument();

    fireEvent.click(chooseButton);

    expect(routerPush).toHaveBeenCalledWith(expect.stringContaining('/en/salon-a/book/tech'));
    expect(routerPush).toHaveBeenCalledWith(expect.stringContaining('serviceIds=srv_1'));
  });

  it('retries temporary availability failures', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: {
        kind: 'temporary_failure',
        message: 'Unable to evaluate availability for the selected day.',
        canRetry: true,
        canReselectTechnician: false,
      },
    }), { status: 500 }));

    render(
      <BookTimeClient
        services={[{ id: 'srv_1', name: 'Gel', price: 65, duration: 60 }]}
        totalPrice={65}
        totalDuration={60}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        bookingFlow={['service', 'tech', 'time', 'confirm']}
      />,
    );

    const retryButton = await screen.findByRole('button', { name: 'Retry' });
    const callsBeforeRetry = fetchMock.mock.calls.length;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      visibleSlots: ['09:00'],
      bookedSlots: [],
    }), { status: 200 }));
    fireEvent.click(retryButton);

    expect(await screen.findByRole('button', { name: '9:00 AM' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeRetry + 1);
  });
});
