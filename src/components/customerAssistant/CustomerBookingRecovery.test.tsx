import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CustomerBookingStatus } from '@/libs/customerAssistant/bookingOperationContracts';

import { CustomerBookingRecovery } from './CustomerAssistantLauncher';

function pending(): CustomerBookingStatus {
  const expiresAt = new Date(Date.now() + 300_000).toISOString();
  return {
    kind: 'booking_status',
    status: 'not_created',
    appointment: null,
    payment: null,
    lastFailure: null,
    operation: { capability: 'original-capability', revision: 3, fingerprint: 'a'.repeat(64), expiresAt },
    review: {
      status: 'READY',
      fingerprint: 'r'.repeat(64),
      expiresAt,
      salon: { id: 'synthetic', slug: 'isla-nail-studio', name: 'Synthetic salon' },
      location: null,
      services: [{ id: 'gel-x', name: 'Gel-X', priceCents: 8500 }],
      addOns: [],
      technician: { kind: 'any_artist' },
      date: '2030-01-02',
      time: '13:00',
      timeZone: 'America/Toronto',
      durationMinutes: 90,
      financial: { subtotalCents: 8500, discountAmountCents: 0, discountLabel: null, taxAmountCents: 0, totalDueCents: 8500, currency: 'CAD' },
      deposit: { status: 'not_required', reason: 'policy_inactive' },
      confirmationMode: 'instant',
      bookingPolicy: { required: false },
      reminders: { mode: 'default_on', selection: 'default_on', requestedEnabled: true },
    },
  };
}

function store(status: CustomerBookingStatus, salonId = 'synthetic') {
  localStorage.setItem(`luster.customer-booking.operation.${salonId}`, JSON.stringify({ version: 1, salonId, ...status.operation }));
}

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('legacy durable operation status recovery', () => {
  it('reads the original operation without creating a new booking or starting the assistant', async () => {
    const status = { ...pending(), status: 'confirmed' as const, appointment: { id: 'original', startTime: '2030-01-02T18:00:00Z', durationMinutes: 90, technicianName: 'Synthetic Tech', reminderState: 'customer_disabled' as const } };
    store(status);
    const fetchMock = vi.fn().mockResolvedValue(Response.json(status));
    vi.stubGlobal('fetch', fetchMock);
    render(<CustomerBookingRecovery salonId="synthetic" locale="en" />);

    expect(await screen.findByText('Your appointment is confirmed.')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/public/customer-booking/synthetic/status', expect.objectContaining({ body: JSON.stringify({ capability: 'original-capability' }) }));
    expect(screen.queryByRole('button', { name: 'Confirm booking' })).not.toBeInTheDocument();
  });

  it('never describes a deposit hold as confirmed', async () => {
    const status = { ...pending(), status: 'payment_required' as const, payment: { amountCents: 2000, currency: 'CAD', holdExpiresAt: '2030-01-02T18:00:00Z', canResume: true } };
    store(status);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(status)));
    render(<CustomerBookingRecovery salonId="synthetic" locale="en" />);

    expect(await screen.findByText('Payment is required to complete this booking.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Resume payment' })).toBeVisible();
    expect(screen.queryByText('Your appointment is confirmed.')).not.toBeInTheDocument();
  });

  it('does not read another salon operation', async () => {
    store(pending(), 'other');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<CustomerBookingRecovery salonId="synthetic" locale="en" />);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports unresolved lookup failure without trying to create anything', async () => {
    store(pending());
    const fetchMock = vi.fn().mockRejectedValue(new Error('timeout'));
    vi.stubGlobal('fetch', fetchMock);
    render(<CustomerBookingRecovery salonId="synthetic" locale="en" />);

    expect(await screen.findByText(/could not check this booking yet/i)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
