import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RETENTION_SETTINGS } from '@/libs/retentionAssistant';

import { GET, POST } from './route';

vi.mock('server-only', () => ({}));

const {
  requireAdminSalon,
  getAdminSession,
  getRetentionSettingsForSalon,
  selectQueue,
  insertedValues,
  updateSets,
  db,
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
            appointmentId: null,
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
    requireAdminSalon: vi.fn(),
    getAdminSession: vi.fn(),
    getRetentionSettingsForSalon: vi.fn(),
    selectQueue,
    insertedValues,
    updateSets,
    db: {
      select: vi.fn(() => query(selectQueue.shift() ?? [])),
      transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    },
  };
});

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon, getAdminSession }));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/retentionSettings.server', () => ({ getRetentionSettingsForSalon }));

const NOW = new Date('2026-07-17T16:00:00.000Z');

describe('/api/admin/retention', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    selectQueue.length = 0;
    insertedValues.length = 0;
    updateSets.length = 0;
    requireAdminSalon.mockResolvedValue({ salon: { id: 'salon_1', slug: 'salon-a' }, error: null });
    getAdminSession.mockResolvedValue({ id: 'admin_1' });
    getRetentionSettingsForSalon.mockResolvedValue(DEFAULT_RETENTION_SETTINGS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns one retention stage and reminders for first-time clients', async () => {
    selectQueue.push(
      [
        {
          id: 'due_client',
          fullName: 'Due Client',
          phone: '4161111111',
          lastVisitAt: new Date('2026-06-26T16:00:00.000Z'),
          rebookIntervalDays: null,
          isBlocked: false,
        },
        {
          id: 'new_client',
          fullName: 'New Client',
          phone: '4162222222',
          lastVisitAt: null,
          rebookIntervalDays: null,
          isBlocked: false,
        },
      ],
      [{
        id: 'appointment_1',
        salonClientId: 'new_client',
        clientName: 'New Client',
        clientPhone: '4162222222',
        startTime: new Date('2026-07-18T15:00:00.000Z'),
        endTime: new Date('2026-07-18T16:00:00.000Z'),
        status: 'confirmed',
        dayBeforeReminderSentAt: null,
        sameDayReminderSentAt: null,
      }],
      [],
    );

    const response = await GET(new Request('http://localhost/api/admin/retention?salonSlug=salon-a'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.retention).toEqual([
      expect.objectContaining({ clientId: 'due_client', stage: 'rebook' }),
    ]);
    expect(body.data.appointmentReminders).toEqual([
      expect.objectContaining({ appointmentId: 'appointment_1', clientId: 'new_client' }),
    ]);
    expect(body.data.history).toEqual([]);
  });

  it('returns 404 instead of leaking a client from another salon', async () => {
    selectQueue.push([]);

    const response = await GET(new Request(
      'http://localhost/api/admin/retention?salonSlug=salon-a&clientId=foreign_client',
    ));

    expect(response.status).toBe(404);
    expect(getRetentionSettingsForSalon).not.toHaveBeenCalled();
  });

  it('persists an exact seven-day snooze with an honest status', async () => {
    selectQueue.push(
      [{ id: 'client_1', lastVisitAt: new Date('2026-06-26T16:00:00.000Z') }],
      [],
    );

    const response = await POST(new Request('http://localhost/api/admin/retention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'salon-a',
        clientId: 'client_1',
        kind: 'rebook',
        status: 'snoozed',
        snoozeDays: 7,
        messageSnapshot: 'Book: https://example.com/book?campaign=secret-token',
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(insertedValues[0]).toMatchObject({
      salonId: 'salon_1',
      salonClientId: 'client_1',
      kind: 'rebook',
      status: 'snoozed',
      actorAdminId: 'admin_1',
      messageSnapshot: 'Book: https://example.com/book?campaign=[redacted]',
    });
    expect((insertedValues[0]?.snoozedUntil as Date).toISOString()).toBe('2026-07-24T16:00:00.000Z');
    expect(body.data.communication).toMatchObject({
      clientId: 'client_1',
      status: 'snoozed',
      snoozedUntil: '2026-07-24T16:00:00.000Z',
    });
  });

  it('caps reminder snoozes before appointment start instead of using seven days', async () => {
    selectQueue.push(
      [{ id: 'client_1', phone: '4165551212', lastVisitAt: null }],
      [{
        id: 'appointment_1',
        startTime: new Date('2026-07-17T18:00:00.000Z'),
        salonClientId: 'client_1',
        clientPhone: '4165551212',
      }],
      [],
    );

    const response = await POST(new Request('http://localhost/api/admin/retention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'salon-a',
        clientId: 'client_1',
        appointmentId: 'appointment_1',
        kind: 'reminder',
        status: 'snoozed',
        snoozeHours: 3,
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect((insertedValues[0]?.snoozedUntil as Date).toISOString()).toBe(
      '2026-07-17T17:59:59.999Z',
    );
    expect(body.data.communication).toMatchObject({
      appointmentId: 'appointment_1',
      kind: 'reminder',
      status: 'snoozed',
      snoozedUntil: '2026-07-17T17:59:59.999Z',
    });
  });

  it('requires an appointment id for reminder state', async () => {
    const response = await POST(new Request('http://localhost/api/admin/retention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'salon-a',
        clientId: 'client_1',
        kind: 'reminder',
        status: 'prepared',
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(requireAdminSalon).not.toHaveBeenCalled();
  });

  it('updates the tenant-scoped client last-contact time when outreach is marked sent', async () => {
    selectQueue.push(
      [{ id: 'client_1', phone: '4165551212', lastVisitAt: new Date('2026-06-26T16:00:00.000Z') }],
      [],
    );

    const response = await POST(new Request('http://localhost/api/admin/retention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'salon-a',
        clientId: 'client_1',
        kind: 'rebook',
        status: 'marked_sent',
      }),
    }));

    expect(response.status).toBe(200);
    expect(updateSets).toContainEqual({ lastContactAt: NOW, updatedAt: NOW });
  });
});
