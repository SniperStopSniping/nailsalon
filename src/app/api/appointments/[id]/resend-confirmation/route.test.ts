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
    const response = await POST(
      new Request('http://localhost?salonSlug=glow', { method: 'POST' }),
      { params: Promise.resolve({ id: 'appt_1' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { status: 'sent' },
    });
    expect(requireAppointmentManagerAccess).toHaveBeenCalledWith('appt_1', {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can resend confirmations',
      assignmentForbiddenMessage: 'You can only manage your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: 'glow',
    });
    expect(resendCustomerBookingConfirmationEmail).toHaveBeenCalledWith({ salonId: 'salon_1', appointmentId: 'appt_1' });
  });

  it('returns a cross-tenant access denial without invoking resend', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: { code: 'APPOINTMENT_NOT_FOUND' } },
        { status: 404 },
      ),
    });

    const response = await POST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: 'appt_other' }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'APPOINTMENT_NOT_FOUND' },
    });
    expect(resendCustomerBookingConfirmationEmail).not.toHaveBeenCalled();
  });

  it('keeps historical appointments eligible without route-level evidence fields', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      appointment: { id: 'appt_1', salonId: 'salon_1', clientEmail: null },
    });

    const response = await POST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: 'appt_1' }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { status: 'sent' },
    });
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

    const response = await POST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: 'appt_1' }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'EMAIL_UNAVAILABLE',
        message: 'This appointment has no client email address.',
      },
    });
  });

  it('preserves the queued-retry response when email preparation fails', async () => {
    resendCustomerBookingConfirmationEmail.mockRejectedValue(
      new Error('BOOKING_POLICY_EVIDENCE_LOOKUP_FAILED'),
    );

    const response = await POST(
      new Request('http://localhost', { method: 'POST' }),
      { params: Promise.resolve({ id: 'appt_1' }) },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'EMAIL_QUEUED_FOR_RETRY',
        message:
          'Email could not be delivered yet. Luster will retry automatically.',
      },
    });
  });
});
