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
  lifecycleState,
  lifecycleOperations,
  getSalonClientLineageIdsWithHandle,
  getSalonClientPhoneAliasesWithHandle,
  lockTerminalSalonClientWithHandle,
  MockClientLifecycleStabilizationError,
  resolveTerminalSalonClient,
  withClientLifecycleTransactionRetry,
  db,
} = vi.hoisted(() => {
  class MockClientLifecycleStabilizationError extends Error {}

  const selectQueue: unknown[] = [];
  const insertedValues: Array<Record<string, unknown>> = [];
  const updateSets: Array<Record<string, unknown>> = [];
  const lifecycleState: { terminalClientId: string | null } = { terminalClientId: null };
  const lifecycleOperations: string[] = [];

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
    select: vi.fn(() => {
      lifecycleOperations.push('dependent-read');
      return query(selectQueue.shift() ?? []);
    }),
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
    lifecycleState,
    lifecycleOperations,
    getSalonClientLineageIdsWithHandle: vi.fn(async (
      _handle: unknown,
      input: { terminalClientId: string },
    ) => [input.terminalClientId]),
    getSalonClientPhoneAliasesWithHandle: vi.fn(async () => []),
    lockTerminalSalonClientWithHandle: vi.fn(async (
      _handle: unknown,
      input: { salonId: string; clientId: string },
    ) => {
      lifecycleOperations.push('terminal-lock');
      return {
        id: lifecycleState.terminalClientId ?? input.clientId,
        salonId: input.salonId,
        archivedAt: null,
        redirectedFromClientId: lifecycleState.terminalClientId
          ? input.clientId
          : null,
        lineagePath: lifecycleState.terminalClientId
          ? [input.clientId, lifecycleState.terminalClientId]
          : [input.clientId],
      };
    }),
    MockClientLifecycleStabilizationError,
    resolveTerminalSalonClient: vi.fn(async (input: {
      salonId: string;
      clientId: string;
    }) => ({
      id: lifecycleState.terminalClientId ?? input.clientId,
      salonId: input.salonId,
      archivedAt: null,
      redirectedFromClientId: lifecycleState.terminalClientId
        ? input.clientId
        : null,
      lineagePath: lifecycleState.terminalClientId
        ? [input.clientId, lifecycleState.terminalClientId]
        : [input.clientId],
    })),
    withClientLifecycleTransactionRetry: vi.fn(async (
      operation: (attempt: number) => Promise<unknown>,
    ) => operation(1)),
    db: {
      select: vi.fn(() => query(selectQueue.shift() ?? [])),
      transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    },
  };
});

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon, getAdminSession }));
vi.mock('@/libs/clientLifecycleStabilization', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/libs/clientLifecycleStabilization')
  >();
  return {
    ...actual,
    ClientLifecycleStabilizationError: MockClientLifecycleStabilizationError,
    getSalonClientLineageIdsWithHandle,
    getSalonClientPhoneAliasesWithHandle,
    lockTerminalSalonClientWithHandle,
    resolveTerminalSalonClient,
    withClientLifecycleTransactionRetry,
  };
});
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
    lifecycleState.terminalClientId = null;
    lifecycleOperations.length = 0;
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
      [],
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

  it('collapses a merged source into its active terminal before building reminder destinations', async () => {
    lifecycleState.terminalClientId = 'primary_client';
    getSalonClientLineageIdsWithHandle.mockResolvedValueOnce([
      'merged_source',
      'primary_client',
    ]);
    selectQueue.push(
      [
        {
          id: 'primary_client',
          fullName: 'Primary fixture',
          phone: '4165550100',
          lastVisitAt: new Date('2026-06-01T16:00:00.000Z'),
          rebookIntervalDays: null,
          isBlocked: false,
          archivedAt: null,
          mergedIntoClientId: null,
        },
        {
          id: 'merged_source',
          fullName: 'Source fixture',
          phone: '4165550199',
          lastVisitAt: new Date('2026-05-01T16:00:00.000Z'),
          rebookIntervalDays: null,
          isBlocked: false,
          archivedAt: new Date('2026-07-01T16:00:00.000Z'),
          mergedIntoClientId: 'primary_client',
        },
      ],
      [{
        salonClientId: 'merged_source',
        kind: 'phone',
        normalizedValue: '4165550199',
      }],
      [{
        id: 'appointment_merged_source',
        salonClientId: 'merged_source',
        clientName: 'Historical fixture',
        clientPhone: '4165550199',
        startTime: new Date('2026-07-18T15:00:00.000Z'),
        endTime: new Date('2026-07-18T16:00:00.000Z'),
        status: 'confirmed',
        dayBeforeReminderSentAt: null,
        sameDayReminderSentAt: null,
      }],
      [],
      [{
        id: 'communication_merged_source',
        salonId: 'salon_1',
        salonClientId: 'merged_source',
        appointmentId: null,
        kind: 'promo_6w',
        status: 'prepared',
        dueAt: null,
        snoozedUntil: null,
        messageSnapshot: null,
        metadata: {},
        actorAdminId: 'admin_1',
        destinationSnapshot: '4165550199',
        preparedAt: NOW,
        markedSentAt: null,
        dismissedAt: null,
        convertedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      }],
    );

    const response = await GET(new Request(
      'http://localhost/api/admin/retention?salonSlug=salon-a&clientId=merged_source',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.retention).toEqual([]);
    expect(body.data.appointmentReminders).toEqual([
      expect.objectContaining({
        appointmentId: 'appointment_merged_source',
        clientId: 'primary_client',
        phone: '4165550100',
      }),
    ]);
    expect(body.data.history).toEqual([
      expect.objectContaining({
        id: 'communication_merged_source',
        clientId: 'primary_client',
      }),
    ]);
    expect(JSON.stringify(body.data)).not.toContain('4165550199');
    expect(JSON.stringify(body.data)).not.toContain('"merged_source"');
  });

  it('queries archived explicit communication history independently from the capped active queue', async () => {
    selectQueue.push(
      [{
        id: 'archived_client',
        fullName: 'Archived fixture',
        phone: '4165550990',
        lastVisitAt: new Date('2026-06-01T16:00:00.000Z'),
        rebookIntervalDays: null,
        isBlocked: false,
        archivedAt: new Date('2026-07-10T16:00:00.000Z'),
        mergedIntoClientId: null,
      }],
      [],
      [],
      [],
      [{
        id: 'communication_archived',
        salonId: 'salon_1',
        salonClientId: 'archived_client',
        appointmentId: null,
        kind: 'rebook',
        status: 'marked_sent',
        dueAt: null,
        snoozedUntil: null,
        messageSnapshot: 'Historical outreach',
        metadata: {},
        actorAdminId: 'admin_1',
        destinationSnapshot: '4165550990',
        preparedAt: null,
        markedSentAt: NOW,
        dismissedAt: null,
        convertedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      }],
    );

    const response = await GET(new Request(
      'http://localhost/api/admin/retention?salonSlug=salon-a&clientId=archived_client',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.retention).toEqual([]);
    expect(body.data.appointmentReminders).toEqual([]);
    expect(body.data.history).toEqual([
      expect.objectContaining({
        id: 'communication_archived',
        clientId: 'archived_client',
        status: 'marked_sent',
      }),
    ]);
    expect(resolveTerminalSalonClient).toHaveBeenCalledWith({
      salonId: 'salon_1',
      clientId: 'archived_client',
      allowArchived: true,
    });
  });

  it('returns 404 instead of leaking a client from another salon', async () => {
    resolveTerminalSalonClient.mockRejectedValueOnce(
      new MockClientLifecycleStabilizationError(),
    );

    const response = await GET(new Request(
      'http://localhost/api/admin/retention?salonSlug=salon-a&clientId=foreign_client',
    ));

    expect(response.status).toBe(404);
    expect(getRetentionSettingsForSalon).not.toHaveBeenCalled();
  });

  it('persists an exact seven-day snooze with an honest status', async () => {
    selectQueue.push(
      [{
        id: 'client_1',
        phone: '4165551212',
        lastVisitAt: new Date('2026-06-26T16:00:00.000Z'),
      }],
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

  it('locks and writes the terminal client when a merged source is submitted', async () => {
    lifecycleState.terminalClientId = 'primary_client';
    selectQueue.push(
      [{ id: 'primary_client', phone: '4165551212', lastVisitAt: null }],
      [{
        id: 'appointment_1',
        startTime: new Date('2026-07-17T18:00:00.000Z'),
        salonClientId: 'primary_client',
        clientPhone: 'historical-snapshot',
      }],
      [],
    );

    const response = await POST(new Request('http://localhost/api/admin/retention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'salon-a',
        clientId: 'merged_source',
        appointmentId: 'appointment_1',
        kind: 'reminder',
        status: 'prepared',
      }),
    }));

    expect(response.status).toBe(200);
    expect(lockTerminalSalonClientWithHandle).toHaveBeenCalledWith(
      expect.anything(),
      { salonId: 'salon_1', clientId: 'merged_source' },
    );
    expect(lifecycleOperations.slice(0, 2)).toEqual(['terminal-lock', 'dependent-read']);
    expect(insertedValues[0]).toMatchObject({
      salonClientId: 'primary_client',
      appointmentId: 'appointment_1',
      kind: 'reminder',
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

  it('records manual completion after an expired snooze without rewriting that history', async () => {
    selectQueue.push(
      [{ id: 'client_1', phone: '4165551212', lastVisitAt: new Date('2026-06-26T16:00:00.000Z') }],
      [{
        id: 'snoozed_1',
        salonId: 'salon_1',
        salonClientId: 'client_1',
        appointmentId: null,
        kind: 'rebook',
        status: 'snoozed',
        snoozedUntil: new Date('2026-07-16T16:00:00.000Z'),
        messageSnapshot: 'Original draft',
        createdAt: new Date('2026-07-10T16:00:00.000Z'),
      }],
    );

    const response = await POST(new Request('http://localhost/api/admin/retention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'salon-a',
        clientId: 'client_1',
        kind: 'rebook',
        status: 'converted',
      }),
    }));

    expect(response.status).toBe(200);
    expect(insertedValues[0]).toMatchObject({
      salonId: 'salon_1',
      salonClientId: 'client_1',
      kind: 'rebook',
      status: 'converted',
    });
    expect(insertedValues[0]?.messageSnapshot).toBeNull();
  });
});
