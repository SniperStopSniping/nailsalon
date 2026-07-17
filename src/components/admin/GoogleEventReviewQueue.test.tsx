import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleEventReviewQueue } from './GoogleEventReviewQueue';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock('framer-motion', () => {
  // Cache per tag: a fresh component type on every property access would make
  // React remount the subtree on each render, wiping typed form state.
  const motionCache = new Map<string, (props: React.HTMLAttributes<HTMLDivElement>) => React.ReactElement>();
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy({}, {
      get: (_, tag: string) => {
        if (!motionCache.has(tag)) {
          motionCache.set(tag, (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />);
        }
        return motionCache.get(tag);
      },
    }),
  };
});

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({ salonSlug: 'test-salon' }),
}));

const googleEvent = {
  id: 'google_event_1',
  title: 'Controlled fake event',
  startTime: '2026-07-20T14:00:00.000Z',
  endTime: '2026-07-20T15:00:00.000Z',
  durationMinutes: 60,
  transparency: 'busy' as const,
  isReadOnly: false,
  suggestion: {
    client: null,
    service: { id: 'service_1', name: 'Gel Manicure', price: 5500 },
    recordedDecision: null,
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GoogleEventReviewQueue conversion session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/admin/google-events') {
        return jsonResponse({ data: { events: [{ ...googleEvent }] } });
      }
      if (url.pathname === '/api/admin/technicians') {
        return jsonResponse({ data: { technicians: [{ id: 'tech_1', name: 'Test Technician', avatarUrl: null }] } });
      }
      if (url.pathname === '/api/salon/services') {
        return jsonResponse({
          data: {
            services: [{ id: 'service_1', name: 'Gel Manicure', price: 5500, durationMinutes: 60, category: 'Manicure' }],
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url.pathname}`);
    });
  });

  it('keeps typed values when the imported-event list refetches with fresh objects', async () => {
    render(<GoogleEventReviewQueue salonSlug="test-salon" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Convert to appointment' }));
    const name = await screen.findByLabelText('Client Name (optional)');
    fireEvent.change(name, { target: { value: 'Typed client' } });
    fireEvent.change(screen.getByLabelText('Phone Number *'), { target: { value: '4165550198' } });
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'typed@example.test' } });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Google events' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Client Name (optional)')).toHaveValue('Typed client');
      expect(screen.getByLabelText('Phone Number *')).toHaveValue('(416) 555-0198');
      expect(screen.getByLabelText('Email (optional)')).toHaveValue('typed@example.test');
    });
  });

  it('keeps the active conversion mounted when a refetch temporarily returns no pending events', async () => {
    let listRequestCount = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/admin/google-events') {
        listRequestCount += 1;
        return jsonResponse({ data: { events: listRequestCount === 1 ? [{ ...googleEvent }] : [] } });
      }
      if (url.pathname === '/api/admin/technicians') {
        return jsonResponse({ data: { technicians: [{ id: 'tech_1', name: 'Test Technician', avatarUrl: null }] } });
      }
      if (url.pathname === '/api/salon/services') {
        return jsonResponse({
          data: {
            services: [{ id: 'service_1', name: 'Gel Manicure', price: 5500, durationMinutes: 60, category: 'Manicure' }],
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url.pathname}`);
    });

    render(<GoogleEventReviewQueue salonSlug="test-salon" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Convert to appointment' }));
    fireEvent.change(await screen.findByLabelText('Client Name (optional)'), { target: { value: 'Still editing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Google events' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Convert Google Event' })).toBeInTheDocument();
      expect(screen.getByLabelText('Client Name (optional)')).toHaveValue('Still editing');
    });
  });

  it('shows a non-destructive warning when Google sync updates the source while typing', async () => {
    let listRequestCount = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/admin/google-events') {
        listRequestCount += 1;
        return jsonResponse({
          data: {
            events: [{
              ...googleEvent,
              startTime: listRequestCount === 1 ? googleEvent.startTime : '2026-07-20T14:30:00.000Z',
              endTime: listRequestCount === 1 ? googleEvent.endTime : '2026-07-20T16:00:00.000Z',
              durationMinutes: listRequestCount === 1 ? 60 : 90,
              sourceVersion: `sync-${listRequestCount}`,
            }],
          },
        });
      }
      if (url.pathname === '/api/admin/technicians') {
        return jsonResponse({ data: { technicians: [{ id: 'tech_1', name: 'Test Technician', avatarUrl: null }] } });
      }
      if (url.pathname === '/api/salon/services') {
        return jsonResponse({
          data: {
            services: [{ id: 'service_1', name: 'Gel Manicure', price: 5500, durationMinutes: 60, category: 'Manicure' }],
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url.pathname}`);
    });

    render(<GoogleEventReviewQueue salonSlug="test-salon" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Convert to appointment' }));
    fireEvent.change(await screen.findByLabelText('Client Name (optional)'), { target: { value: 'Sync-safe client' } });
    fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: 'Sync-safe note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Google events' }));

    expect(await screen.findByTestId('google-event-changed-warning')).toBeInTheDocument();
    expect(screen.getByLabelText('Client Name (optional)')).toHaveValue('Sync-safe client');
    expect(screen.getByLabelText('Notes (optional)')).toHaveValue('Sync-safe note');
    expect(screen.getByLabelText('Duration (minutes)')).toHaveValue(60);
  });
});
