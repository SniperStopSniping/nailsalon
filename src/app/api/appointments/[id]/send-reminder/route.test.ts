/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAppointmentServiceNames,
  getSalonById,
  getTechnicianById,
  mintAppointmentManageLink,
  resolveOperationalSalonClientContact,
  resolveOperationalSalonClientContactByPhone,
  requireAppointmentManagerAccess,
  sendSmartAppointmentReminder,
} = vi.hoisted(() => ({
  getAppointmentServiceNames: vi.fn(),
  getSalonById: vi.fn(),
  getTechnicianById: vi.fn(),
  mintAppointmentManageLink: vi.fn(),
  resolveOperationalSalonClientContact: vi.fn(),
  resolveOperationalSalonClientContactByPhone: vi.fn(),
  requireAppointmentManagerAccess: vi.fn(),
  sendSmartAppointmentReminder: vi.fn(),
}));

vi.mock('@/libs/appointmentManageLink', () => ({ mintAppointmentManageLink }));
vi.mock('@/libs/clientLifecycleStabilization', () => ({
  resolveOperationalSalonClientContact,
  resolveOperationalSalonClientContactByPhone,
}));
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
    resolveOperationalSalonClientContact.mockResolvedValue({
      id: 'primary_client',
      salonId: 'salon_1',
      phone: '4165550198',
      email: null,
      archivedAt: null,
      redirectedFromClientId: 'merged_source',
      lineagePath: ['merged_source', 'primary_client'],
    });
    resolveOperationalSalonClientContactByPhone.mockResolvedValue(null);
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
      { params: Promise.resolve({ id: 'appt_1' }) },
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
      { params: Promise.resolve({ id: 'appt_1' }) },
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

  it('uses the terminal client current phone without rewriting the appointment snapshot', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      appointment: {
        ...appointment,
        salonClientId: 'merged_source',
        clientPhone: '4165550100',
      },
      actorRole: 'admin',
    });

    const response = await POST(
      new Request('https://app.test/api/appointments/appt_1/send-reminder', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'appt_1' }) },
    );

    expect(response.status).toBe(200);
    expect(resolveOperationalSalonClientContact).toHaveBeenCalledWith({
      salonId: 'salon_1',
      clientId: 'merged_source',
      allowArchived: true,
    });
    expect(sendSmartAppointmentReminder).toHaveBeenCalledWith(
      'salon_1',
      expect.objectContaining({ phone: '4165550198' }),
    );
    expect(appointment.clientPhone).toBe('(416) 555-1234');
  });

  it('uses a unique same-salon alias for a null-ID appointment', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      appointment: {
        ...appointment,
        salonClientId: null,
        clientPhone: '4165550100',
      },
      actorRole: 'admin',
    });
    resolveOperationalSalonClientContactByPhone.mockResolvedValue({
      id: 'primary_client',
      salonId: 'salon_1',
      phone: '4165550198',
      email: null,
      archivedAt: null,
      redirectedFromClientId: 'merged_source',
      lineagePath: ['merged_source', 'primary_client'],
    });

    const response = await POST(
      new Request('https://app.test/api/appointments/appt_1/send-reminder', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'appt_1' }) },
    );

    expect(response.status).toBe(200);
    expect(resolveOperationalSalonClientContactByPhone).toHaveBeenCalledWith({
      salonId: 'salon_1',
      phone: '4165550100',
      allowArchived: true,
    });
    expect(sendSmartAppointmentReminder).toHaveBeenCalledWith(
      'salon_1',
      expect.objectContaining({ phone: '4165550198' }),
    );
  });

  it('fails closed when a null-ID lifecycle phone is ambiguous', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      appointment: {
        ...appointment,
        salonClientId: null,
        clientPhone: '4165550100',
      },
      actorRole: 'admin',
    });
    resolveOperationalSalonClientContactByPhone.mockRejectedValue(
      new Error('ambiguous lifecycle state'),
    );

    const response = await POST(
      new Request('https://app.test/api/appointments/appt_1/send-reminder', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'appt_1' }) },
    );

    expect(response.status).toBe(500);
    expect(sendSmartAppointmentReminder).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      '[AppointmentReminder] failed to prepare reminder',
      expect.any(Error),
    );
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
      { params: Promise.resolve({ id: 'appt_1' }) },
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
      { params: Promise.resolve({ id: 'appt_1' }) },
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
      { params: Promise.resolve({ id: 'appt_1' }) },
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
      { params: Promise.resolve({ id: 'appt_1' }) },
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
      { params: Promise.resolve({ id: 'appt_other' }) },
    );

    expect(response.status).toBe(403);
    expect(getSalonById).not.toHaveBeenCalled();
  });
});
