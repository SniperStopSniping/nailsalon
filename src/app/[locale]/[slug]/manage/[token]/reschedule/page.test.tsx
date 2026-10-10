import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RescheduleAppointmentPage from './page';

const { verifyAppointmentAccessToken, select } = vi.hoisted(() => ({
  verifyAppointmentAccessToken: vi.fn(),
  select: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/appointmentAccess', () => ({ verifyAppointmentAccessToken }));
vi.mock('@/libs/appointmentTaxSnapshot', () => ({ validateAppointmentTaxSnapshotChain: () => ({ ok: false }) }));
vi.mock('@/libs/DB', () => ({ db: { select } }));
vi.mock('./RescheduleAppointmentClient', () => ({
  RescheduleAppointmentClient: ({ manageHref }: { manageHref: string }) => (
    <a href={manageHref}>Available times for this appointment</a>
  ),
}));

function capability(status = 'confirmed') {
  return {
    salonId: 'salon_test',
    salonSlug: 'test-salon',
    salonName: 'Test Salon',
    salonSettings: { booking: { timezone: 'America/Toronto', clientChangeCutoffHours: 168 } },
    appointment: {
      id: 'appointment_test',
      salonId: 'salon_test',
      status,
      // Deliberately in the past: active status, not the old time cutoff,
      // determines whether a customer can open the rescheduling flow.
      startTime: new Date('2020-01-01T15:00:00Z'),
      technicianId: null,
      locationId: null,
      totalDurationMinutes: 35,
      totalPrice: 3500,
    },
  };
}

async function renderPage(slug = 'test-salon') {
  render(await RescheduleAppointmentPage({ params: Promise.resolve({ locale: 'en', slug, token: 'synthetic-token' }) }));
}

describe('rescheduling page access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    select.mockReturnValue({ from: () => ({ where: async () => [] }) });
  });

  it.each(['pending', 'confirmed'])('opens for a late %s appointment despite a legacy cutoff', async (status) => {
    verifyAppointmentAccessToken.mockResolvedValue(capability(status));
    await renderPage();

    expect(screen.getByRole('link', { name: 'Available times for this appointment' })).toHaveAttribute('href', '/en/test-salon/manage/synthetic-token');
    expect(screen.queryByText(/Online changes are closed/)).not.toBeInTheDocument();
  });

  it.each(['completed', 'cancelled', 'no_show', 'in_progress', 'awaiting_payment'])('protects %s appointments', async (status) => {
    verifyAppointmentAccessToken.mockResolvedValue(capability(status));
    await renderPage();

    expect(screen.getByRole('heading', { name: 'This appointment can no longer be changed' })).toBeInTheDocument();
    expect(select).not.toHaveBeenCalled();
  });

  it('rejects an invalid capability', async () => {
    verifyAppointmentAccessToken.mockResolvedValue(null);
    await renderPage();

    expect(screen.getByRole('link', { name: 'Find my booking' })).toHaveAttribute('href', '/en/test-salon/find-booking');
    expect(select).not.toHaveBeenCalled();
  });

  it('rejects a token used on another salon route', async () => {
    verifyAppointmentAccessToken.mockResolvedValue(capability());
    await renderPage('another-salon');

    expect(screen.getByRole('heading', { name: 'This link is not valid' })).toBeInTheDocument();
    expect(select).not.toHaveBeenCalled();
  });

  it('rejects an appointment outside the token salon', async () => {
    const value = capability();
    value.appointment.salonId = 'another-salon';
    verifyAppointmentAccessToken.mockResolvedValue(value);
    await renderPage();

    expect(screen.getByRole('heading', { name: 'This link is not valid' })).toBeInTheDocument();
    expect(select).not.toHaveBeenCalled();
  });
});
