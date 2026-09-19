import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsModal } from './SettingsModal';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/providers/SalonProvider', () => ({ useSalon: () => ({ salonSlug: null }) }));

function LeafHarness() {
  const [open, setOpen] = useState(true);
  return open ? <SettingsModal initialView="booking-flow" leafOnly onClose={() => setOpen(false)} salonSlug="salon-a" /> : <div>Closed</div>;
}

function json(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status }));
}

describe('SettingsModal booking-flow leaf', () => {
  let putMode: 'success' | 'failure' | 'held';
  let releasePut: (() => void) | null;

  beforeEach(() => {
    putMode = 'success';
    releasePut = null;
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/admin/settings/booking-flow')) {
        if (init?.method === 'PUT') {
          if (putMode === 'failure') {
            return json({ error: 'Unavailable' }, 503);
          }
          if (putMode === 'held') {
            return new Promise<Response>((resolve) => {
              releasePut = () => resolve(new Response(JSON.stringify({ data: { bookingFlow: ['service', 'time', 'confirm'] } })));
            });
          }
          return json({ data: { bookingFlow: ['service', 'time', 'confirm'] } });
        }
        return json({ data: { bookingFlowCustomizationEnabled: true, bookingFlow: ['service', 'tech', 'time', 'confirm'] } });
      }
      if (url.includes('/api/admin/settings/visibility')) {
        return json({ data: { visibility: { staff: {} } } });
      }
      if (url.includes('/api/admin/settings/modules')) {
        return json({ data: { modules: {}, entitledModules: {} } });
      }
      if (url.includes('/api/admin/salon/settings')) {
        return json({ bookingExperience: {
          primaryColor: null,
          bookingMessage: null,
          socialLinks: { instagram: null, facebook: null, tiktok: null },
          confirmationMessage: null,
          policy: { enabled: false, title: null, text: null, showOnServicePage: true, showBeforeConfirmation: true, showAfterConfirmation: true, showInConfirmationEmail: true, acknowledgment: { required: false, text: null }, version: null },
          quickFacts: { appointmentOnly: { enabled: false, label: null }, depositNotice: { enabled: false, label: null }, cancellationNotice: { enabled: false, label: null } },
        } });
      }
      if (url.includes('/api/admin/profile')) {
        return json({ user: {} });
      }
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('discards a pending debounce without sending a flow write', async () => {
    render(<LeafHarness />);
    const toggle = await screen.findByTitle('Click to hide technician step');
    // Hold the debounce clock so a busy CI runner cannot save before Back.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.click(toggle);

      await act(async () => {});

      fireEvent.click(screen.getByRole('button', { name: 'Back' }));

      expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

      expect(screen.getByText('Closed')).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/api/admin/settings/booking-flow') && (init as RequestInit | undefined)?.method === 'PUT')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a failed flow write when Back opens the leave confirmation', async () => {
    putMode = 'failure';
    render(<LeafHarness />);
    fireEvent.click(await screen.findByTitle('Click to hide technician step'));
    await screen.findByRole('alert');

    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/api/admin/settings/booking-flow') && (init as RequestInit | undefined)?.method === 'PUT')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(await screen.findByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await new Promise(resolve => setTimeout(resolve, 600));

    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/api/admin/settings/booking-flow') && (init as RequestInit | undefined)?.method === 'PUT')).toHaveLength(1);
  });

  it('does not offer discard while a flow write is already in flight', async () => {
    putMode = 'held';
    render(<LeafHarness />);
    fireEvent.click(await screen.findByTitle('Click to hide technician step'));
    await waitFor(() => expect(releasePut).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(await screen.findByText('Booking flow is saving. Please wait before leaving.')).toBeVisible();
    expect(screen.queryByRole('alertdialog', { name: 'Unsaved changes' })).not.toBeInTheDocument();

    releasePut?.();
  });
});
