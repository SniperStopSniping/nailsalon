import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('framer-motion', () => {
  const makeMotionTag = (tag: string) =>
    React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ children, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children),
    );

  return {
    motion: new Proxy({}, {
      get: (_, tag: string) => makeMotionTag(tag),
    }),
  };
});

import { DirectionsLocationSection } from './SettingsModal';

describe('DirectionsLocationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('loads and saves the salon admin directions location fields', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          salon: {
            id: 'salon_1',
            slug: 'salon-a',
            name: 'Salon A',
            locationCount: 1,
          },
          location: {
            id: 'loc_1',
            name: 'Main Studio',
            address: '123 Queen St W',
            city: 'Toronto',
            state: 'ON',
            zipCode: 'M5H 2M9',
            isPrimary: true,
          },
          isPrimaryFallback: false,
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          location: {
            id: 'loc_1',
            name: 'Main Studio',
            address: '456 King St W',
            city: 'Toronto',
            state: 'ON',
            zipCode: 'M5V 1L7',
            isPrimary: true,
          },
          locationCount: 1,
          created: false,
        },
      }), { status: 200 }));

    render(<DirectionsLocationSection salonSlug="salon-a" />);

    const addressInput = await screen.findByDisplayValue('123 Queen St W');
    fireEvent.change(addressInput, { target: { value: '456 King St W' } });
    fireEvent.change(screen.getByDisplayValue('M5H 2M9'), { target: { value: 'M5V 1L7' } });
    fireEvent.click(screen.getByRole('button', { name: /save location/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/admin/location?salonSlug=salon-a',
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Main Studio',
            address: '456 King St W',
            city: 'Toronto',
            state: 'ON',
            zipCode: 'M5V 1L7',
          }),
        }),
      );
    });

    expect(await screen.findByText('Location saved.')).toBeInTheDocument();
  });
});
