import React from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchMock,
  routerBack,
  routerPush,
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  routerBack: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={props.alt} />,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: routerBack,
    push: routerPush,
  }),
  useParams: () => ({ locale: 'en' }),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({
    salonName: 'Salon A',
    salonSlug: 'salon-a',
  }),
}));

import { ChangeAppointmentClient } from './ChangeAppointmentContent';

describe('ChangeAppointmentClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.setSystemTime(new Date('2026-03-14T10:00:00Z'));
    vi.stubGlobal('fetch', fetchMock);
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

  it('does not refetch availability when the already-selected date is tapped again', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      visibleSlots: ['09:00', '09:30'],
      bookedSlots: [],
    }), { status: 200 })));

    render(
      <ChangeAppointmentClient
        services={[{ id: 'srv_1', name: 'Gel', price: 65, duration: 60 }]}
        technician={{ id: 'tech_1', name: 'Taylor', imageUrl: '/tech.jpg' }}
        dateStr="2026-03-16"
        timeStr="09:00"
        originalAppointmentId="appt_1"
      />,
    );

    await screen.findByRole('button', { name: '9:00 AM' });

    const initialCallCount = fetchMock.mock.calls.length;
    expect(initialCallCount).toBeGreaterThan(0);

    const selectedDateButton = screen.getByRole('button', { name: '16' });

    await act(async () => {
      fireEvent.click(selectedDateButton);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(initialCallCount);
  });
});
