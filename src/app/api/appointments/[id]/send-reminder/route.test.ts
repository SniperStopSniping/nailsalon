/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAppointmentServiceNames,
  getSalonById,
  getTechnicianById,
  mintAppointmentManageLink,
  requireAppointmentManagerAccess,
  sendSmartAppointmentReminder,
} = vi.hoisted(() => ({
  getAppointmentServiceNames: vi.fn(),
  getSalonById: vi.fn(),
  getTechnicianById: vi.fn(),
  mintAppointmentManageLink: vi.fn(),
  requireAppointmentManagerAccess: vi.fn(),
  sendSmartAppointmentReminder: vi.fn(),
}));

vi.mock('@/libs/appointmentManageLink', () => ({ mintAppointmentManageLink }));
vi.mock('@/libs/queries', () => ({
  getAppointmentServiceNames,
  getSalonById,
  getTechnicianById,
}));
vi.mock('@/libs/routeAccessGuards', () => ({ requireAppointmentManagerAccess }));
vi.mock('@/libs/SMS', () => ({ sendSmartAppointmentReminder }));

import { POST } from './route';

const appointment = {
  id: 'appt_1',
  salonId: 'salon_1',
  technicianId: 'tech_1',
  clientName: 'Ava',
  clientPhone: '(416) 555-1234',
  status: 'confirmed',
  deletedAt: null,
  startTime: new Date('2099-07-22T21:00:00.000Z'),
  endTime: new Date('2099-07-22T22:00:00.000Z'),
};

describe('POST /api/appointments/[id]/send-reminder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      appointment,
      actorRole: 'admin',
    });
    getSalonById.mockResolvedValue({
      id: 'salon_1',
      name: 'Isla Nail Studio',
      settings: { booking: { timezone: 'America/Toronto' } },
    });
    getAppointmentServiceNames.mockResolvedValue(['BIAB Fill']);
    getTechnicianById.mockResolvedValue({ id: 'tech_1', name: 'Daniela' });
    mintAppointmentManageLink.mockResolvedValue('https://islanailsalon.com/en/isla/manage/token');
    sendSmartAppointmentReminder.mockResolvedValue({
      outcome: 'sent',
      phone: '4165551234',
      body: 'Reminder body',
      sentAt: '2026-07-22T18:00:00.000Z',
    });
  });

  it('authorizes within the hinted salon and returns an automatic success', async () => {
    const response = await POST(
      new Request('https://app.test/api/appointments/appt_1/send-reminder?salonSlug=isla', {
        method: 'POST',
      }),
      { params: { id: 'appt_1' } },
    );

    expect(requireAppointmentManagerAccess).toHaveBeenCalledWith('appt_1', expect.objectContaining({
      assignedOnly: true,
      salonSlugHint: 'isla',
    }));
    expect(sendSmartAppointmentReminder).toHaveBeenCalledWith('salon_1', expect.objectContaining({
      appointmentId: 'appt_1',
      phone: '(416) 555-1234',
      services: ['BIAB Fill'],
      technicianName: 'Daniela',
      timeZone: 'America/Toronto',
      manageUrl: 'https://islanailsalon.com/en/isla/manage/token',
      force: false,
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        mode: 'automatic',
        sent: true,
        sentAt: '2026-07-22T18:00:00.000Z',
      },
    });
  });

  it('returns an editable draft for known automatic-send ineligibility', async () => {
    sendSmartAppointmentReminder.mockResolvedValue({
      outcome: 'manual',
      reason: 'SMS_CONSENT_REQUIRED',
      phone: '4165551234',
      body: 'Reminder body with secure link',
    });

    const response = await POST(
      new Request('https://app.test/api/appointments/appt_1/send-reminder', { method: 'POST' }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        mode: 'manual',
        sent: false,
        reason: 'SMS_CONSENT_REQUIRED',
        phone: '4165551234',
        body: 'Reminder body with secure link',
      },
    });
  });

  it('requires an explicit fallback after an ambiguous provider failure', async () => {
    sendSmartAppointmentReminder.mockResolvedValue({
      outcome: 'provider_failure',
      phone: '4165551234',
      body: 'Reminder body with secure link',
      errorCode: '30008',
    });

    const response = await POST(
      new Request('https://app.test/api/appointments/appt_1/send-reminder', { method: 'POST' }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SMS_DELIVERY_FAILED' },
      manualFallback: {
        phone: '4165551234',
        body: 'Reminder body with secure link',
      },
    });
  });

  it('reports a rapid duplicate as the prior automatic success', async () => {
    sendSmartAppointmentReminder.mockResolvedValue({
      outcome: 'duplicate',
      phone: '4165551234',
      body: 'Reminder body',
      sentAt: '2026-07-22T18:00:00.000Z',
    });

    const response = await POST(
      new Request('https://app.test/api/appointments/appt_1/send-reminder', { method: 'POST' }),
      { params: { id: 'appt_1' } },
    );

    await expect(response.json()).resolves.toEqual({
      data: {
        mode: 'automatic',
        sent: true,
        reason: 'DUPLICATE_SUPPRESSED',
        sentAt: '2026-07-22T18:00:00.000Z',
      },
    });
  });

  it('passes a confirmed resend through with force enabled', async () => {
    await POST(
      new Request('https://app.test/api/appointments/appt_1/send-reminder', {
        method: 'POST',
        body: JSON.stringify({ force: true }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(sendSmartAppointmentReminder).toHaveBeenCalledWith(
      'salon_1',
      expect.objectContaining({ force: true }),
    );
  });

  it('rejects finished appointments before preparing a message', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      appointment: { ...appointment, status: 'completed' },
      actorRole: 'admin',
    });

    const response = await POST(
      new Request('https://app.test/api/appointments/appt_1/send-reminder', { method: 'POST' }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(409);
    expect(mintAppointmentManageLink).not.toHaveBeenCalled();
    expect(sendSmartAppointmentReminder).not.toHaveBeenCalled();
  });

  it('preserves appointment access failures', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 }),
    });

    const response = await POST(
      new Request('https://app.test/api/appointments/appt_other/send-reminder', { method: 'POST' }),
      { params: { id: 'appt_other' } },
    );

    expect(response.status).toBe(403);
    expect(getSalonById).not.toHaveBeenCalled();
  });
});
