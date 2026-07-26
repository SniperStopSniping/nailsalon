/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAppointmentManagerAccess, resendCustomerBookingConfirmationEmail } = vi.hoisted(() => ({
  requireAppointmentManagerAccess: vi.fn(),
  resendCustomerBookingConfirmationEmail: vi.fn(),
}));

vi.mock('@/libs/routeAccessGuards', () => ({ requireAppointmentManagerAccess }));
vi.mock('@/libs/customerBookingEmail', () => ({ resendCustomerBookingConfirmationEmail }));

import { POST } from './route';

describe('POST /api/appointments/:id/resend-confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: { id: 'appt_1', salonId: 'salon_1', clientEmail: 'client@example.com' },
    });
    resendCustomerBookingConfirmationEmail.mockResolvedValue({ ok: true });
  });

  it('resends only through the tenant-scoped managed appointment', async () => {
    const response = await POST(new Request('http://localhost', { method: 'POST' }), { params: { id: 'appt_1' } });

    expect(response.status).toBe(200);
    expect(resendCustomerBookingConfirmationEmail).toHaveBeenCalledWith({ salonId: 'salon_1', appointmentId: 'appt_1' });
  });

  it('returns the existing access denial unchanged', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });

    const response = await POST(new Request('http://localhost', { method: 'POST' }), { params: { id: 'appt_other' } });

    expect(response.status).toBe(403);
    expect(resendCustomerBookingConfirmationEmail).not.toHaveBeenCalled();
  });

  it('lets the delivery helper resolve a current terminal email when the snapshot is empty', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: { id: 'appt_1', salonId: 'salon_1', clientEmail: null },
    });

    const response = await POST(new Request('http://localhost', { method: 'POST' }), { params: { id: 'appt_1' } });

    expect(response.status).toBe(200);
    expect(resendCustomerBookingConfirmationEmail).toHaveBeenCalledWith({
      salonId: 'salon_1',
      appointmentId: 'appt_1',
    });
  });

  it('preserves the unavailable response after canonical recipient resolution', async () => {
    resendCustomerBookingConfirmationEmail.mockResolvedValue({
      ok: false,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
      providerMessageId: null,
    });

    const response = await POST(new Request('http://localhost', { method: 'POST' }), { params: { id: 'appt_1' } });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'EMAIL_UNAVAILABLE',
        message: 'This appointment has no client email address.',
      },
    });
  });
});
