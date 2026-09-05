import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WalkInModal } from './WalkInModal';

const { fetchMock, salonContext } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  salonContext: { salonSlug: 'test-salon' },
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy({}, {
    get: () => (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  }),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => salonContext,
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installDefaultFetch() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/admin/technicians') {
      return jsonResponse({
        data: { technicians: [{ id: 'tech_1', name: 'Daniela', avatarUrl: null }] },
      });
    }
    if (url.pathname === '/api/salon/services') {
      return jsonResponse({
        data: {
          services: [
            { id: 'service_1', name: 'Gel Manicure', price: 5500, durationMinutes: 60, category: 'Manicure' },
          ],
        },
      });
    }
    if (url.pathname === '/api/admin/appointments') {
      return jsonResponse({ data: { appointments: [] } });
    }
    throw new Error(`Unexpected fetch: ${url.pathname}`);
  });
}

describe('WalkInModal salon resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    salonContext.salonSlug = 'test-salon';
    vi.stubGlobal('fetch', fetchMock);
    installDefaultFetch();
  });

  it('explains the missing tenant instead of spinning forever when no salon resolves', async () => {
    salonContext.salonSlug = '';
    render(<WalkInModal isOpen onClose={vi.fn()} />);

    const notice = await screen.findByTestId('walk-in-error');

    expect(notice).toHaveTextContent('Choose a salon to continue');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers the dashboard salon prop over the tenant-cookie context', async () => {
    salonContext.salonSlug = '';
    render(<WalkInModal isOpen onClose={vi.fn()} salonSlug="salon-b" />);

    await screen.findByText('Gel Manicure');

    const requested = fetchMock.mock.calls.map(([input]) => String(input));

    expect(requested).toContain('/api/admin/technicians?salonSlug=salon-b&status=active');
    expect(requested).toContain('/api/salon/services?salonSlug=salon-b');
    expect(screen.queryByText('Choose a salon to continue')).not.toBeInTheDocument();
  });
});
