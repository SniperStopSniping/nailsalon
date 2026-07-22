/* eslint-disable import/first */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  db,
  getRetentionSettingsForSalon,
  getSalonClientById,
  getSalonClientByPhone,
  insertedValues,
  requireAppointmentManagerAccess,
  selectQueue,
  updateSets,
} = vi.hoisted(() => {
  const selectQueue: unknown[] = [];
  const insertedValues: Array<Record<string, unknown>> = [];
  const updateSets: Array<Record<string, unknown>> = [];

  const query = (result: unknown) => {
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => result),
      then: (resolve: (value: unknown) => void, reject?: (reason: unknown) => void) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  };

  const tx = {
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updateSets.push(values);
        const chain = {
          where: vi.fn(() => chain),
          returning: vi.fn(async () => []),
          then: (resolve: (value: unknown) => void) => Promise.resolve([]).then(resolve),
        };
        return chain;
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertedValues.push(values);
        return {
          returning: vi.fn(async () => [{
            metadata: {},
            messageSnapshot: null,
            dueAt: null,
            snoozedUntil: null,
            preparedAt: null,
            markedSentAt: null,
            dismissedAt: null,
            convertedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...values,
          }]),
        };
      }),
    })),
  };

  return {
    db: {
      select: vi.fn(() => query(selectQueue.shift() ?? [])),
      transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    },
    getRetentionSettingsForSalon: vi.fn(),
    getSalonClientById: vi.fn(),
    getSalonClientByPhone: vi.fn(),
    insertedValues,
    requireAppointmentManagerAccess: vi.fn(),
    selectQueue,
    updateSets,
  };
});

vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/queries', () => ({ getSalonClientById, getSalonClientByPhone }));
vi.mock('@/libs/retentionSettings.server', () => ({ getRetentionSettingsForSalon }));
vi.mock('@/libs/routeAccessGuards', () => ({ requireAppointmentManagerAccess }));

import { GET, POST } from './route';

const NOW = new Date('2026-07-22T18:00:00.000Z');
const appointment = {
  id: 'appt_1',
  salonId: 'salon_1',
  salonClientId: 'client_1',
  technicianId: 'tech_1',
  clientName: 'Ava',
  clientPhone: '4165551234',
  status: 'confirmed',
  startTime: new Date('2026-07-22T21:00:00.000Z'),
  endTime: new Date('2026-07-22T22:00:00.000Z'),
  dayBeforeReminderSentAt: null,
  sameDayReminderSentAt: null,
};
const client = {
  id: 'client_1',
  salonId: 'salon_1',
  fullName: 'Ava Client',
  phone: '4165551234',
  lastVisitAt: null,
  rebookIntervalDays: null,
  isBlocked: false,
};

function communication(overrides: Record<string, unknown> = {}) {
  return {
    id: 'comm_1',
    salonId: 'salon_1',
    salonClientId: 'client_1',
    appointmentId: 'appt_1',
    kind: 'generic_text',
    status: 'prepared',
    dueAt: null,
    snoozedUntil: null,
    messageSnapshot: 'Hello Ava',
    metadata: {},
    preparedAt: NOW,
    markedSentAt: null,
    dismissedAt: null,
    convertedAt: null,
    actorAdminId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('/api/appointments/[id]/communication', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    selectQueue.length = 0;
    insertedValues.length = 0;
    updateSets.length = 0;
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'staff',
      session: { technicianId: 'tech_1' },
      appointment,
    });
    getSalonClientById.mockResolvedValue(client);
    getSalonClientByPhone.mockResolvedValue(null);
    getRetentionSettingsForSalon.mockResolvedValue({ reminderLeadHours: 24 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns appointment-scoped reminder state and history for assigned staff', async () => {
    selectQueue.push([communication()], []);

    const response = await GET(
      new Request('https://app.test/api/appointments/appt_1/communication?salonSlug=isla'),
      { params: { id: 'appt_1' } },
    );

    expect(requireAppointmentManagerAccess).toHaveBeenCalledWith('appt_1', expect.objectContaining({
      assignedOnly: true,
      salonSlugHint: 'isla',
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        reminderDue: true,
        history: [{
          id: 'comm_1',
          appointmentId: 'appt_1',
          clientId: 'client_1',
          kind: 'generic_text',
          status: 'prepared',
          createdAt: NOW.toISOString(),
        }],
      },
    });
  });

  it('does not report a reminder due after an accepted automatic send', async () => {
    selectQueue.push(
      [],
      [{ updatedAt: new Date('2026-07-22T17:59:00.000Z') }],
    );

    const response = await GET(
      new Request('https://app.test/api/appointments/appt_1/communication'),
      { params: { id: 'appt_1' } },
    );

    await expect(response.json()).resolves.toEqual({
      data: { reminderDue: false, history: [] },
    });
  });

  it('returns an untracked empty state when a legacy appointment has no salon client', async () => {
    getSalonClientById.mockResolvedValue(null);
    getSalonClientByPhone.mockResolvedValue(null);

    const response = await GET(
      new Request('https://app.test/api/appointments/appt_1/communication'),
      { params: { id: 'appt_1' } },
    );

    await expect(response.json()).resolves.toEqual({
      data: { reminderDue: false, history: [] },
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('records sanitized appointment outreach for assigned staff', async () => {
    selectQueue.push([]);

    const response = await POST(
      new Request('https://app.test/api/appointments/appt_1/communication?salonSlug=isla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'appointment_details',
          status: 'prepared',
          messageSnapshot: 'Manage: https://example.com/en/isla/manage/secret-token',
        }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(200);
    expect(insertedValues[0]).toMatchObject({
      salonId: 'salon_1',
      salonClientId: 'client_1',
      appointmentId: 'appt_1',
      kind: 'appointment_details',
      status: 'prepared',
      actorAdminId: null,
      messageSnapshot: 'Manage: https://example.com/en/isla/manage/[redacted]',
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        tracked: true,
        communication: {
          clientId: 'client_1',
          appointmentId: 'appt_1',
          kind: 'appointment_details',
          status: 'prepared',
        },
      },
    });
  });

  it('caps a three-hour reminder snooze immediately before appointment start', async () => {
    selectQueue.push([]);
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      admin: { id: 'admin_1' },
      appointment,
    });

    const response = await POST(
      new Request('https://app.test/api/appointments/appt_1/communication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'reminder',
          status: 'snoozed',
          snoozeHours: 3,
        }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(200);
    expect(insertedValues[0]).toMatchObject({
      actorAdminId: 'admin_1',
      kind: 'reminder',
      status: 'snoozed',
    });
    expect((insertedValues[0]?.snoozedUntil as Date).toISOString()).toBe(
      '2026-07-22T20:59:59.999Z',
    );
  });

  it('keeps contact actions usable when communication tracking has no client row', async () => {
    getSalonClientById.mockResolvedValue(null);
    getSalonClientByPhone.mockResolvedValue(null);

    const response = await POST(
      new Request('https://app.test/api/appointments/appt_1/communication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'generic_text', status: 'prepared' }),
      }),
      { params: { id: 'appt_1' } },
    );

    await expect(response.json()).resolves.toEqual({
      data: { communication: null, tracked: false },
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects unsupported kinds and caller-supplied appointment identifiers', async () => {
    const unsupportedKind = await POST(
      new Request('https://app.test/api/appointments/appt_1/communication', {
        method: 'POST',
        body: JSON.stringify({ kind: 'rebook', status: 'prepared' }),
      }),
      { params: { id: 'appt_1' } },
    );
    const injectedAppointment = await POST(
      new Request('https://app.test/api/appointments/appt_1/communication', {
        method: 'POST',
        body: JSON.stringify({
          appointmentId: 'appt_other',
          kind: 'reminder',
          status: 'prepared',
        }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(unsupportedKind.status).toBe(400);
    expect(injectedAppointment.status).toBe(400);
    expect(getSalonClientById).not.toHaveBeenCalled();
  });

  it('enforces existing communication status transitions', async () => {
    selectQueue.push([communication({ kind: 'reminder', status: 'snoozed' })]);

    const response = await POST(
      new Request('https://app.test/api/appointments/appt_1/communication', {
        method: 'POST',
        body: JSON.stringify({ kind: 'reminder', status: 'converted' }),
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_STATUS_TRANSITION' },
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('preserves tenant and assignment access failures', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 }),
    });

    const response = await GET(
      new Request('https://app.test/api/appointments/appt_other/communication'),
      { params: { id: 'appt_other' } },
    );

    expect(response.status).toBe(403);
    expect(getSalonClientById).not.toHaveBeenCalled();
  });
});
