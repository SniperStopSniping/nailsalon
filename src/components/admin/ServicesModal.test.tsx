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

  it('shows add actions for an empty salon and creates combo services against the active admin salon slug', async () => {
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
            name: 'BIAB + Classic Pedicure',
            description: 'Builder gel overlay paired with a classic pedicure',
            price: 8500,
            durationMinutes: 110,
            category: 'combo',
            imageUrl: null,
            isActive: true,
          },
        },
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          services: [{
            id: 'svc_new',
            name: 'BIAB + Classic Pedicure',
            description: 'Builder gel overlay paired with a classic pedicure',
            price: 8500,
            durationMinutes: 110,
            category: 'combo',
            imageUrl: null,
            isActive: true,
          }],
        },
      }), { status: 200 }));

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    expect(await screen.findByRole('button', { name: 'Add Service' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Service' }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'BIAB + Classic Pedicure' } });
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '85' } });
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '110' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'combo' } });
    fireEvent.change(screen.getByLabelText('Description items'), { target: { value: 'Builder gel overlay paired with a classic pedicure' } });
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
      name: 'BIAB + Classic Pedicure',
      description: 'Builder gel overlay paired with a classic pedicure',
      descriptionItems: ['Builder gel overlay paired with a classic pedicure'],
      price: 8500,
      priceDisplayText: null,
      durationMinutes: 110,
      category: 'combo',
      isIntroPrice: false,
      introPriceLabel: null,
    });

    expect(await screen.findByText('BIAB + Classic Pedicure')).toBeInTheDocument();
  });

  it('keeps combo available as a filter category and shows combo services when selected', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        services: [
          {
            id: 'svc_combo',
            name: 'Gel X / Hard Gel Extensions + Classic Pedicure',
            description: null,
            price: 10500,
            durationMinutes: 155,
            category: 'combo',
            imageUrl: null,
            isActive: true,
          },
          {
            id: 'svc_mani',
            name: 'Gel Manicure',
            description: null,
            price: 4000,
            durationMinutes: 60,
            category: 'manicure',
            imageUrl: null,
            isActive: true,
          },
        ],
      },
    }), { status: 200 }));

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    expect(await screen.findByText('Gel X / Hard Gel Extensions + Classic Pedicure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /combo 1/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /combo 1/i }));

    expect(screen.getByText('Gel X / Hard Gel Extensions + Classic Pedicure')).toBeInTheDocument();
    expect(screen.queryByText('Gel Manicure')).not.toBeInTheDocument();
  });
});
