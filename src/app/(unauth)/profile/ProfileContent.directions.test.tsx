import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, routerBack, routerPush, windowOpen } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  routerBack: vi.fn(),
  routerPush: vi.fn(),
  windowOpen: vi.fn(),
}));

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={props.alt} />,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: routerBack,
    push: routerPush,
  }),
  useParams: () => ({
    locale: 'en',
  }),
}));

vi.mock('framer-motion', () => {
  const makeMotionTag = (tag: string) =>
    React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement> & Record<string, unknown>>(({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      whileTap: _whileTap,
      whileHover: _whileHover,
      whileInView: _whileInView,
      whileDrag: _whileDrag,
      layout: _layout,
      ...props
    }, ref) => React.createElement(tag, { ...props, ref }, children as React.ReactNode));

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy({}, {
      get: (_, tag: string) => makeMotionTag(tag),
    }),
  };
});

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({
    salonName: 'Salon A',
    salonSlug: 'salon-a',
  }),
}));

vi.mock('@/hooks/useClientSession', () => ({
  useClientSession: () => ({
    phone: '4165551234',
    clientName: 'Ava',
    clientEmail: 'ava@example.com',
  }),
}));

vi.mock('@/components/ConfettiPopup', () => ({
  ConfettiPopup: () => null,
}));

import ProfileContent from './ProfileContent';

describe('ProfileContent directions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { vibrate: vi.fn() });
    window.open = windowOpen;

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/client/next-appointment')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            appointment: {
              id: 'appt_1',
              startTime: '2099-03-20T15:00:00.000Z',
              endTime: '2099-03-20T16:15:00.000Z',
              status: 'confirmed',
              totalPrice: 6500,
              totalDurationMinutes: 75,
              locationId: null,
            },
            services: [{
              id: 'srv_1',
              name: 'BIAB Short',
              price: 6500,
              duration: 75,
              imageUrl: null,
            }],
            technician: null,
            location: {
              id: 'salon_salon_1',
              name: 'Salon A',
              address: '500 King St W',
              city: 'Toronto',
              state: 'ON',
              zipCode: 'M5V 1L9',
            },
          },
        }), { status: 200 }));
      }

      if (url.includes('/api/rewards')) {
        return Promise.resolve(new Response(JSON.stringify({
          meta: {
            activePoints: 1500,
            pendingPoints: 0,
            pendingAppointments: 0,
          },
        }), { status: 200 }));
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
  });

  it('shows directions for the upcoming appointment and opens Google Maps', async () => {
    render(<ProfileContent />);

    const directionsButton = await screen.findByRole('button', { name: /get directions to salon/i });
    expect(directionsButton).toBeInTheDocument();

    fireEvent.click(directionsButton);

    await waitFor(() => {
      expect(windowOpen).toHaveBeenCalledWith(
        'https://www.google.com/maps/dir/?api=1&destination=500%20King%20St%20W%2C%20Toronto%2C%20ON%2C%20M5V%201L9',
        '_blank',
        'noopener,noreferrer',
      );
    });
  });
});
