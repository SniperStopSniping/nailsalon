/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAppointmentServiceNames,
  getSalonById,
  getSalonClientById,
  getTechnicianById,
  resolveSalonClientIdentityByPhone,
  mintAppointmentManageLink,
  requireAppointmentManagerAccess,
  sendSmartAppointmentReminder,
} = vi.hoisted(() => ({
  getAppointmentServiceNames: vi.fn(),
  getSalonById: vi.fn(),
  getSalonClientById: vi.fn(),
  getTechnicianById: vi.fn(),
  resolveSalonClientIdentityByPhone: vi.fn(),
  mintAppointmentManageLink: vi.fn(),
  requireAppointmentManagerAccess: vi.fn(),
  sendSmartAppointmentReminder: vi.fn(),
}));

vi.mock('@/libs/appointmentManageLink', () => ({ mintAppointmentManageLink }));
vi.mock('@/libs/queries', () => ({
  getAppointmentServiceNames,
  getSalonById,
  getSalonClientById,
  getTechnicianById,
  resolveSalonClientIdentityByPhone,
}));
vi.mock('@/libs/routeAccessGuards', () => ({ requireAppointmentManagerAccess }));
vi.mock('@/libs/SMS', () => ({ sendSmartAppointmentReminder }));

import { POST } from './route';

const appointment = {
  id: 'appt_1',
  salonId: 'salon_1',
  salonClientId: 'sc_1',
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
    getSalonClientById.mockResolvedValue({
      id: 'sc_1',
      salonId: 'salon_1',
      phone: '6475550199',
      email: 'current@example.com',
    });
    getTechnicianById.mockResolvedValue({ id: 'tech_1', name: 'Daniela' });
    resolveSalonClientIdentityByPhone.mockResolvedValue(null);
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
    expect(getSalonClientById).toHaveBeenCalledWith('salon_1', 'sc_1');
    expect(sendSmartAppointmentReminder).toHaveBeenCalledWith('salon_1', expect.objectContaining({
      appointmentId: 'appt_1',
      phone: '6475550199',
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

  it('resolves an unlinked legacy snapshot phone to the current primary', async () => {
    const legacyAppointment = {
      ...appointment,
      id: 'appt_legacy',
      salonClientId: null,
    };
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      appointment: legacyAppointment,
      actorRole: 'admin',
    });
    resolveSalonClientIdentityByPhone.mockResolvedValue({
      client: {
        id: 'sc_primary',
        salonId: 'salon_1',
        phone: '6475550188',
        email: 'current-primary@example.com',
      },
      clientIds: ['sc_primary', 'sc_source'],
      normalizedPhones: ['4165551234', '6475550188'],
      phoneVariants: ['4165551234', '6475550188'],
      resolvedFromClientId: 'sc_source',
    });

    await POST(
      new Request('https://app.test/api/appointments/appt_legacy/send-reminder', { method: 'POST' }),
      { params: { id: 'appt_legacy' } },
    );

    expect(getSalonClientById).not.toHaveBeenCalled();
    expect(resolveSalonClientIdentityByPhone).toHaveBeenCalledWith(
      'salon_1',
      '(416) 555-1234',
    );
    expect(sendSmartAppointmentReminder).toHaveBeenCalledWith('salon_1', expect.objectContaining({
      phone: '6475550188',
    }));
    expect(legacyAppointment.clientPhone).toBe('(416) 555-1234');
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
