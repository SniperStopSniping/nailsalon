import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      return jsonResponse({ data: { appointments: [] }, meta: { timeZone: 'America/Toronto' } });
    }
    if (url.pathname === '/api/appointments/availability') {
      return jsonResponse({ slots: [
        { startTime: '2030-10-06T17:00:00Z', availability: 'available' },
        { startTime: '2030-10-06T18:00:00Z', availability: 'schedule_conflict' },
      ] });
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

  async function chooseService() {
    fireEvent.click(await screen.findByText('Gel Manicure'));
    fireEvent.click(screen.getByRole('button', { name: 'Choose a time' }));
  }

  it('uses authoritative slots and skips a redundant choice when there is one technician', async () => {
    render(<WalkInModal isOpen onClose={vi.fn()} salonSlug="salon-b" />);
    await chooseService();

    expect(await screen.findByRole('button', { name: '1:00 PM' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '2:00 PM' })).not.toBeInTheDocument();
    expect(screen.queryByText('Who would they like?')).not.toBeInTheDocument();

    const input = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/appointments/availability'))![0];
    const query = new URL(String(input), 'http://localhost').searchParams;

    expect(query.get('salonSlug')).toBe('salon-b');
    expect(query.get('technicianId')).toBe('tech_1');
    expect(JSON.parse(query.get('bookingBasket')!)).toEqual({ version: 2, items: [{ serviceId: 'service_1', selectedAddOns: [] }] });
  });

  it('offers useful recovery without another technician when today has no slots', async () => {
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => String(input).includes('/api/appointments/availability')
      ? Promise.resolve(jsonResponse({ slots: [] }))
      : fallback(input, init));
    render(<WalkInModal isOpen onClose={vi.fn()} />);
    await chooseService();

    expect(await screen.findByText('No bookable times today')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change services' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Book another day' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change technician' })).not.toBeInTheDocument();
  });

  it('offers selection recovery for errors that cannot be retried', async () => {
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => String(input).includes('/api/appointments/availability')
      ? Promise.resolve(jsonResponse({ error: { message: 'Choose a compatible service.', canRetry: false } }, 400))
      : fallback(input, init));
    render(<WalkInModal isOpen onClose={vi.fn()} />);
    await chooseService();

    expect(await screen.findByText('Choose a compatible service.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry availability' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Change services' }));

    expect(await screen.findByText('Gel Manicure')).toBeInTheDocument();
  });

  it('shows an availability failure with Retry instead of claiming there are no slots', async () => {
    const fallback = fetchMock.getMockImplementation()!;
    let unavailable = true;
    fetchMock.mockImplementation((input, init) => String(input).includes('/api/appointments/availability') && unavailable
      ? Promise.resolve(jsonResponse({ error: { message: 'Calendar connection is unavailable.' } }, 503))
      : fallback(input, init));
    render(<WalkInModal isOpen onClose={vi.fn()} />);
    await chooseService();

    expect(await screen.findByText('Calendar connection is unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('No bookable times today')).not.toBeInTheDocument();

    unavailable = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry availability' }));

    expect(await screen.findByRole('button', { name: '1:00 PM' })).toBeInTheDocument();
  });

  it('refreshes times after the notice window changes and keeps client details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => String(input) === '/api/appointments' && init?.method === 'POST'
      ? Promise.resolve(jsonResponse({ error: { code: 'TOO_SOON', message: 'Please choose a later time.' } }, 400))
      : fallback(input, init));
    render(<WalkInModal isOpen onClose={vi.fn()} />);
    await chooseService();
    fireEvent.click(await screen.findByRole('button', { name: '1:00 PM' }));
    fireEvent.change(screen.getByLabelText('Phone Number *'), { target: { value: '4165550188' } });
    fireEvent.change(screen.getByLabelText('Client Name (optional)'), { target: { value: 'Preview Client' } });
    fireEvent.click(screen.getByRole('button', { name: 'Book Walk-in Now' }));

    expect(await screen.findByText('Please choose a later time.')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: '1:00 PM' }));

    expect(screen.getByLabelText('Phone Number *')).toHaveValue('(416) 555-0188');
    expect(screen.getByLabelText('Client Name (optional)')).toHaveValue('Preview Client');
  });

  it('reuses the request identity after a lost response instead of creating a second appointment', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fallback = fetchMock.getMockImplementation()!;
    const submissions: RequestInit[] = [];
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    fetchMock.mockImplementation((input, init) => {
      if (String(input) === '/api/appointments' && init?.method === 'POST') {
        submissions.push(init);
        return submissions.length === 1 ? Promise.reject(new Error('Connection interrupted. Retry to check your booking.')) : Promise.resolve(jsonResponse({ data: { id: 'appt_1' } }));
      }
      return fallback(input, init);
    });
    render(<WalkInModal isOpen onClose={onClose} onSuccess={onSuccess} />);
    await chooseService();
    fireEvent.click(await screen.findByRole('button', { name: '1:00 PM' }));
    fireEvent.change(screen.getByLabelText('Phone Number *'), { target: { value: '4165550188' } });
    fireEvent.click(screen.getByRole('button', { name: 'Book Walk-in Now' }));
    await screen.findByText('Connection interrupted. Retry to check your booking.');
    fireEvent.click(screen.getByRole('button', { name: 'Book Walk-in Now' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());

    expect(onClose).toHaveBeenCalledOnce();
    expect(submissions).toHaveLength(2);
    expect(submissions[0]!.body).toBe(submissions[1]!.body);
    expect(JSON.parse(submissions[0]!.body as string)).toMatchObject({ serviceIds: ['service_1'] });
    expect(JSON.parse(submissions[0]!.body as string)).not.toHaveProperty('bookingBasket');
    expect(submissions[0]!.headers).toEqual(submissions[1]!.headers);
    expect((submissions[0]!.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  });
});
