import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
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
  };
});

import { ServicesModal } from './ServicesModal';

describe('ServicesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('shows add actions for an empty salon and creates services against the active admin salon slug', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          services: [],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          service: {
            id: 'svc_new',
            name: 'BIAB Short',
            description: 'Builder gel overlay',
            price: 6500,
            durationMinutes: 75,
            category: 'hands',
            imageUrl: null,
            isActive: true,
          },
        },
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          services: [{
            id: 'svc_new',
            name: 'BIAB Short',
            description: 'Builder gel overlay',
            price: 6500,
            durationMinutes: 75,
            category: 'hands',
            imageUrl: null,
            isActive: true,
          }],
        },
      }), { status: 200 }));

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    expect(await screen.findByRole('button', { name: 'Add Service' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Service' }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'BIAB Short' } });
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '65' } });
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '75' } });
    fireEvent.change(screen.getByLabelText('Description items'), { target: { value: 'Builder gel overlay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Service' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const [url, requestInit] = fetchMock.mock.calls[1] ?? [];
    expect(url).toBe('/api/salon/services');
    expect(requestInit).toEqual(expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      salonSlug: 'isla-nail-studio',
      name: 'BIAB Short',
      description: 'Builder gel overlay',
      descriptionItems: ['Builder gel overlay'],
      price: 6500,
      priceDisplayText: null,
      durationMinutes: 75,
      category: 'manicure',
      isIntroPrice: false,
      introPriceLabel: null,
    });

    expect(await screen.findByText('BIAB Short')).toBeInTheDocument();
  });
});
