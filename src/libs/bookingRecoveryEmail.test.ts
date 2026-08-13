/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueuedResult = unknown[];
type QueuedInsertResult = QueuedResult | Error;
type QueuedUpdateResult = QueuedResult | Error;

const state = vi.hoisted(() => ({
  deliveryClaimed: false,
  selectQueue: [] as QueuedResult[],
  insertQueue: [] as QueuedInsertResult[],
  insertedValues: [] as Array<{ table: unknown; values: unknown }>,
  resolveAppointmentOperationalEmailRecipient: vi.fn(),
  updateQueue: [] as QueuedUpdateResult[],
  updates: [] as Array<{ table: unknown; set: Record<string, unknown> }>,
  sendTransactionalEmailDetailed: vi.fn(),
}));

const { dbMock } = vi.hoisted(() => {
  const s = state;
  function selectChain() {
    const chain: any = {};
    for (const method of ['from', 'where', 'orderBy', 'limit']) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (resolve: any, reject: any) => {
      const queued = s.selectQueue.shift() ?? [];
      const rows = queued.map((row) => {
        if (
          row
          && typeof row === 'object'
          && 'status' in row
          && ('retryable' in row || row.status === 'sent')
          && !('purpose' in row)
        ) {
          return { ...row, purpose: 'booking_recovery' };
        }
        return row;
      });
      return Promise.resolve(rows).then(resolve, reject);
    };
    return chain;
  }
  function insertChain(table: unknown) {
    const chain: any = {};
    chain.values = vi.fn((values: unknown) => {
      s.insertedValues.push({ table, values });
      return chain;
    });
    chain.onConflictDoNothing = vi.fn(() => chain);
    chain.returning = vi.fn(() => chain);
    chain.then = (resolve: any, reject: any) => {
      const next = s.insertQueue.shift() ?? [{}];
      return (next instanceof Error ? Promise.reject(next) : Promise.resolve(next))
        .then(resolve, reject);
    };
    return chain;
  }
  function updateChain(table: unknown) {
    const chain: any = {};
    let updateValues: Record<string, unknown> = {};
    chain.set = vi.fn((values: Record<string, unknown>) => {
      updateValues = values;
      s.updates.push({ table, set: values });
      return chain;
    });
    chain.where = vi.fn(() => chain);
    chain.returning = vi.fn(() => chain);
    chain.then = (resolve: any, reject: any) => {
      const isClaim = updateValues.status === 'queued'
        && updateValues.retryable === false
        && updateValues.errorCode === 'EMAIL_DELIVERY_STATE_UNKNOWN';
      const next = s.updateQueue.length
        ? s.updateQueue.shift()!
        : isClaim && !s.deliveryClaimed
          ? [{ id: 'delivery_1' }]
          : [];
      if (!(next instanceof Error)) {
        if (isClaim && next.length) {
          s.deliveryClaimed = true;
        } else if (
          updateValues.status === 'failed'
          && updateValues.retryable === true
        ) {
          s.deliveryClaimed = false;
        }
      }
      return (next instanceof Error ? Promise.reject(next) : Promise.resolve(next))
        .then(resolve, reject);
    };
    return chain;
  }
  return {
    dbMock: {
      select: vi.fn(() => selectChain()),
      insert: vi.fn((table: unknown) => insertChain(table)),
      update: vi.fn((table: unknown) => updateChain(table)),
    },
  };
});

vi.mock('server-only', () => ({}));
vi.mock('./DB', () => ({ db: dbMock }));
vi.mock('./clientLifecycleStabilization', () => ({
  resolveAppointmentOperationalEmailRecipient:
    state.resolveAppointmentOperationalEmailRecipient,
}));
vi.mock('./email', () => ({ sendTransactionalEmailDetailed: state.sendTransactionalEmailDetailed }));
vi.mock('./bookingConfig', () => ({ resolveBookingConfigFromSettings: () => ({ timezone: 'America/Toronto' }) }));
vi.mock('./lusterSecurity', () => ({
  createOpaqueToken: vi.fn(() => ({ token: 'opaque-token-value', tokenHash: 'token-hash-value' })),
  hashOpaqueToken: vi.fn((value: string) => `hash_${Buffer.from(value).toString('hex')}`),
}));
vi.mock('./publicUrl', () => ({
  buildSalonTenantPublicUrl: vi.fn((path: string) => `https://salon.example.com/en${path}`),
}));

import {
  appointmentAccessTokenSchema,
  appointmentSchema,
  clientCommunicationSchema,
  integrationOutboxSchema,
  notificationDeliverySchema,
} from '@/models/Schema';

import { buildRecoveryDedupeKey, retryBookingRecoveryEmail, sendBookingRecoveryEmail } from './bookingRecoveryEmail';

const SALON = { id: 'salon_1', slug: 'test-salon', name: 'Test Salon', customDomain: null, settings: null };
const APPOINTMENT = {
  id: 'appt_1',
  startTime: new Date('2099-07-01T18:00:00Z'),
  endTime: new Date('2099-07-01T19:00:00Z'),
};
const ORPHAN_RECIPIENT = {
  status: 'appointment_snapshot',
  email: 'orphan@example.com',
  terminalClientId: null,
  identityResolution: 'zero_identity_candidates',
} as const;

function queueHappyPathDb(options: { serviceRows?: unknown[] } = {}) {
  // Call order: select(fresh appointments) → insert(delivery) →
  // select(service names) → insert(token) → provider → select(active tokens).
  state.selectQueue.push([APPOINTMENT]);
  state.insertQueue.push([{ id: 'delivery_1' }]); // delivery insert returning
  state.selectQueue.push(options.serviceRows ?? [{ appointmentId: 'appt_1', name: 'Gel Manicure' }]);
  state.insertQueue.push([{}]); // token insert
  state.selectQueue.push([]); // post-success active-token cap check
}

describe('buildRecoveryDedupeKey', () => {
  it('is stable within a 10-minute bucket and rotates across buckets', () => {
    const early = new Date('2099-07-01T12:01:00Z');
    const sameBucket = new Date('2099-07-01T12:08:00Z');
    const nextBucket = new Date('2099-07-01T12:11:00Z');

    expect(buildRecoveryDedupeKey('salon_1', ['appt_2', 'appt_1'], early))
      .toBe(buildRecoveryDedupeKey('salon_1', ['appt_1', 'appt_2'], sameBucket));
    expect(buildRecoveryDedupeKey('salon_1', ['appt_1'], early))
      .not.toBe(buildRecoveryDedupeKey('salon_1', ['appt_1'], nextBucket));
  });

  it('never embeds raw appointment IDs or recipient data', () => {
    const key = buildRecoveryDedupeKey(
      'salon_1',
      ['private-appointment-id'],
      new Date('2099-07-01T12:00:00Z'),
    );

    expect(key).not.toContain('x@example.com');
    expect(key).not.toContain('private-appointment-id');
    expect(key).toContain('hash_');
  });
});

describe('sendBookingRecoveryEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.deliveryClaimed = false;
    state.selectQueue.length = 0;
    state.insertQueue.length = 0;
    state.insertedValues.length = 0;
    state.updateQueue.length = 0;
    state.updates.length = 0;
    state.resolveAppointmentOperationalEmailRecipient.mockResolvedValue({
      status: 'terminal_current',
      email: 'current@example.com',
      terminalClientId: 'client_1',
    });
    state.sendTransactionalEmailDetailed.mockResolvedValue({ ok: true, providerMessageId: 'msg_1', errorCode: null });
  });

  it('skips the send entirely on a dedupe conflict', async () => {
    state.selectQueue.push([APPOINTMENT]);
    state.insertQueue.push([]); // onConflictDoNothing found an existing row

    const result = await sendBookingRecoveryEmail({
      salon: SALON,
      appointments: [APPOINTMENT],
    });

    expect(result).toEqual({ ok: true, deduped: true, deliveryId: null });
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();

    const tokenInserts = state.insertedValues.filter(entry => entry.table === appointmentAccessTokenSchema);

    expect(tokenInserts).toHaveLength(0);
  });

  it('sends an email containing salon, service, date, time, timezone, and manage link', async () => {
    queueHappyPathDb();

    const result = await sendBookingRecoveryEmail({
      salon: SALON,
      appointments: [APPOINTMENT],
    });

    expect(result.ok).toBe(true);
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);

    const message = state.sendTransactionalEmailDetailed.mock.calls[0]![0] as { to: string; subject: string; text: string; html: string };

    expect(message.to).toBe('current@example.com');
    expect(message.subject).toContain('Test Salon');
    expect(message.text).toContain('Gel Manicure');
    expect(message.text).toContain('July 1');
    expect(message.text).toMatch(/\d{1,2}:\d{2}\s?[AP]M/);
    expect(message.text).toContain('EDT'); // America/Toronto in July
    expect(message.text).toContain('https://salon.example.com/en/manage/opaque-token-value');
    expect(message.html).toContain('Gel Manicure');

    const deliveryUpdates = state.updates.filter(update => update.table === notificationDeliverySchema);

    expect(deliveryUpdates).toHaveLength(1);
    expect(deliveryUpdates.at(-1)!.set).toMatchObject({ status: 'sent', retryable: false });
  });

  it('sends one all-or-nothing recovery to a common zero-candidate orphan snapshot without mutating snapshots', async () => {
    const secondAppointment = {
      ...APPOINTMENT,
      id: 'appt_2',
      startTime: new Date('2099-07-01T20:00:00Z'),
      endTime: new Date('2099-07-01T21:00:00Z'),
    };
    state.selectQueue.push(
      [APPOINTMENT, secondAppointment],
      [
        { appointmentId: 'appt_1', name: 'Gel Manicure' },
        { appointmentId: 'appt_2', name: 'Pedicure' },
      ],
      [],
      [],
    );
    state.insertQueue.push([{ id: 'delivery_1' }], [{}], [{}]);
    state.resolveAppointmentOperationalEmailRecipient.mockResolvedValue(
      ORPHAN_RECIPIENT,
    );

    await expect(sendBookingRecoveryEmail({
      salon: SALON,
      appointments: [APPOINTMENT, secondAppointment],
      recipientMode: 'zero_candidate_orphan',
    })).resolves.toMatchObject({ ok: true });

    expect(state.resolveAppointmentOperationalEmailRecipient)
      .toHaveBeenCalledTimes(6);
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'orphan@example.com' }),
    );

    const delivery = state.insertedValues.find(
      entry => entry.table === notificationDeliverySchema,
    )!.values as { purpose: string };

    expect(delivery.purpose).toBe('booking_recovery_zero_candidate');
    expect(state.updates.some(update =>
      update.table === appointmentSchema
      || update.table === clientCommunicationSchema)).toBe(false);
    expect(state.insertedValues.some(entry =>
      entry.table === appointmentSchema
      || entry.table === clientCommunicationSchema)).toBe(false);
  });

  it.each([
    {
      name: 'mixed orphan and terminal ownership',
      recipients: [
        ORPHAN_RECIPIENT,
        {
          status: 'terminal_current',
          email: 'orphan@example.com',
          terminalClientId: 'client_1',
        },
      ],
    },
    {
      name: 'mixed orphan destinations',
      recipients: [
        ORPHAN_RECIPIENT,
        {
          ...ORPHAN_RECIPIENT,
          email: 'different@example.com',
        },
      ],
    },
    {
      name: 'one unavailable appointment',
      recipients: [
        ORPHAN_RECIPIENT,
        {
          status: 'unavailable',
          reason: 'client_identity_unavailable',
        },
      ],
    },
  ])('sends nothing for $name in an orphan recovery set', async ({ recipients }) => {
    const secondAppointment = {
      ...APPOINTMENT,
      id: 'appt_2',
      startTime: new Date('2099-07-01T20:00:00Z'),
      endTime: new Date('2099-07-01T21:00:00Z'),
    };
    state.selectQueue.push([APPOINTMENT, secondAppointment]);
    for (const recipient of recipients) {
      state.resolveAppointmentOperationalEmailRecipient
        .mockResolvedValueOnce(recipient);
    }

    await expect(sendBookingRecoveryEmail({
      salon: SALON,
      appointments: [APPOINTMENT, secondAppointment],
      recipientMode: 'zero_candidate_orphan',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.insertedValues).toHaveLength(0);
  });

  it('marks failures retryable, revokes fresh tokens, and enqueues an outbox retry with IDs only', async () => {
    state.selectQueue.push(
      [APPOINTMENT],
      [{ appointmentId: 'appt_1', name: 'Gel Manicure' }],
    );
    state.insertQueue.push([{ id: 'delivery_1' }], [{}]);
    state.sendTransactionalEmailDetailed.mockResolvedValue({ ok: false, providerMessageId: null, errorCode: 'RESEND_HTTP_500' });

    const result = await sendBookingRecoveryEmail({
      salon: SALON,
      appointments: [APPOINTMENT],
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('RESEND_HTTP_500');

    const deliveryUpdates = state.updates.filter(update => update.table === notificationDeliverySchema);

    expect(deliveryUpdates[0]!.set).toMatchObject({ status: 'failed', retryable: true, errorCode: 'RESEND_HTTP_500' });

    const tokenUpdates = state.updates.filter(update => update.table === appointmentAccessTokenSchema);

    expect(tokenUpdates).toHaveLength(1);
    expect(tokenUpdates[0]!.set.revokedAt).toBeInstanceOf(Date);

    const outboxInserts = state.insertedValues.filter(entry => entry.table === integrationOutboxSchema);

    expect(outboxInserts).toHaveLength(1);

    const outboxRow = outboxInserts[0]!.values as { operation: string; payload: unknown; dedupeKey: string };

    expect(outboxRow.operation).toBe('retry_booking_recovery');
    expect(outboxRow.payload).toEqual({ deliveryId: expect.any(String), appointmentIds: ['appt_1'] });

    const serialized = JSON.stringify(outboxRow);

    expect(serialized).not.toContain('current@example.com');
    expect(serialized).not.toContain('opaque-token-value');
    expect(dbMock.select).toHaveBeenCalledTimes(2);
  });

  it('keeps fresh capabilities and does not enqueue a retry for an ambiguous network result', async () => {
    state.selectQueue.push(
      [APPOINTMENT],
      [{ appointmentId: 'appt_1', name: 'Gel Manicure' }],
    );
    state.insertQueue.push([{ id: 'delivery_1' }], [{}]);
    state.sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      providerMessageId: null,
      errorCode: 'RESEND_NETWORK_ERROR',
    });

    await expect(sendBookingRecoveryEmail({
      salon: SALON,
      appointments: [APPOINTMENT],
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'RESEND_NETWORK_ERROR',
    });

    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        retryable: false,
      }),
    });
    expect(state.updates.filter(
      update => update.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
    expect(state.insertedValues.filter(
      entry => entry.table === integrationOutboxSchema,
    )).toHaveLength(0);
  });

  it('does not revoke or enqueue after provider success when the sent-state write fails', async () => {
    queueHappyPathDb();
    state.updateQueue.push(new Error('delivery ledger unavailable'));

    await expect(sendBookingRecoveryEmail({
      salon: SALON,
      appointments: [APPOINTMENT],
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
    expect(state.updates.filter(
      update => update.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
    expect(state.insertedValues.filter(
      entry => entry.table === integrationOutboxSchema,
    )).toHaveLength(0);
  });

  it('sends nothing and mints no capability when destinations differ', async () => {
    state.selectQueue.push([APPOINTMENT, { ...APPOINTMENT, id: 'appt_2' }]);
    state.resolveAppointmentOperationalEmailRecipient
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'first@example.com',
        terminalClientId: 'client_1',
      })
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'second@example.com',
        terminalClientId: 'client_1',
      });

    await expect(sendBookingRecoveryEmail({
      salon: SALON,
      appointments: [
        APPOINTMENT,
        {
          ...APPOINTMENT,
          id: 'appt_2',
        },
      ],
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.insertedValues).toHaveLength(0);
  });

  it('reloads the exact active appointment and ignores caller-supplied times', async () => {
    const authoritative = {
      ...APPOINTMENT,
      startTime: new Date('2099-07-02T18:00:00Z'),
      endTime: new Date('2099-07-02T19:30:00Z'),
    };
    state.selectQueue.push(
      [authoritative],
      [{ appointmentId: 'appt_1', name: 'Gel Manicure' }],
      [],
    );
    state.insertQueue.push([{ id: 'delivery_1' }], [{}]);

    await sendBookingRecoveryEmail({
      salon: SALON,
      appointments: [{
        ...APPOINTMENT,
        startTime: new Date('2000-01-01T00:00:00Z'),
        endTime: new Date('2000-01-01T01:00:00Z'),
      }],
    });

    const tokenInsert = state.insertedValues.find(
      entry => entry.table === appointmentAccessTokenSchema,
    )!.values as { expiresAt: Date };

    expect(tokenInsert.expiresAt.getTime()).toBe(
      authoritative.endTime.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('July 2'),
      }),
    );
  });

  it('sends nothing when the requested active appointment set cannot be reloaded exactly', async () => {
    state.selectQueue.push([]);

    await expect(sendBookingRecoveryEmail({
      salon: SALON,
      appointments: [APPOINTMENT],
    })).resolves.toMatchObject({
      ok: false,
      deliveryId: null,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
    });

    expect(state.resolveAppointmentOperationalEmailRecipient).not.toHaveBeenCalled();
    expect(state.insertedValues).toHaveLength(0);
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });

  it('uses a newly current common recipient resolved immediately before sending', async () => {
    state.selectQueue.push(
      [APPOINTMENT],
      [{ appointmentId: 'appt_1', name: 'Gel Manicure' }],
      [],
    );
    state.insertQueue.push([{ id: 'delivery_1' }], [{}]);
    state.resolveAppointmentOperationalEmailRecipient
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'old@example.com',
        terminalClientId: 'client_1',
      })
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'new@example.com',
        terminalClientId: 'client_1',
      })
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'new@example.com',
        terminalClientId: 'client_1',
      });

    await expect(sendBookingRecoveryEmail({
      salon: SALON,
      appointments: [APPOINTMENT],
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'new@example.com' }),
    );

    const tokenInsertIndex = dbMock.insert.mock.calls.findIndex(
      ([table]) => table === appointmentAccessTokenSchema,
    );

    expect(tokenInsertIndex).toBeGreaterThanOrEqual(0);
    expect(
      state.resolveAppointmentOperationalEmailRecipient.mock.invocationCallOrder[1],
    ).toBeLessThan(dbMock.insert.mock.invocationCallOrder[tokenInsertIndex]!);
    expect(
      state.resolveAppointmentOperationalEmailRecipient.mock.invocationCallOrder[2],
    ).toBeGreaterThan(dbMock.insert.mock.invocationCallOrder[tokenInsertIndex]!);
    expect(
      state.resolveAppointmentOperationalEmailRecipient.mock.invocationCallOrder[2],
    ).toBeLessThan(state.sendTransactionalEmailDetailed.mock.invocationCallOrder[0]!);
  });

  it('mints no capability when final resolution is unavailable', async () => {
    state.selectQueue.push(
      [APPOINTMENT],
      [{ appointmentId: 'appt_1', name: 'Gel Manicure' }],
    );
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.resolveAppointmentOperationalEmailRecipient
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'old@example.com',
        terminalClientId: 'client_1',
      })
      .mockResolvedValueOnce({
        status: 'unavailable',
        reason: 'email_unavailable',
      });

    await expect(sendBookingRecoveryEmail({
      salon: SALON,
      appointments: [APPOINTMENT],
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
    expect(state.updates.filter(
      update => update.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
  });

  it('revokes every fresh capability when the immediate pre-send recipient becomes unavailable', async () => {
    state.selectQueue.push(
      [APPOINTMENT],
      [{ appointmentId: 'appt_1', name: 'Gel Manicure' }],
    );
    state.insertQueue.push([{ id: 'delivery_1' }], [{}]);
    state.resolveAppointmentOperationalEmailRecipient
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'initial@example.com',
        terminalClientId: 'client_1',
      })
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'before-token@example.com',
        terminalClientId: 'client_1',
      })
      .mockResolvedValueOnce({
        status: 'unavailable',
        reason: 'email_unavailable',
      });

    await expect(sendBookingRecoveryEmail({
      salon: SALON,
      appointments: [APPOINTMENT],
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: appointmentAccessTokenSchema,
      set: { revokedAt: expect.any(Date) },
    });
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        retryable: false,
      }),
    });
  });

  it('cleans planned capabilities and queues IDs only when preparation fails partway through', async () => {
    const secondAppointment = {
      ...APPOINTMENT,
      id: 'appt_2',
      startTime: new Date('2099-07-01T20:00:00Z'),
      endTime: new Date('2099-07-01T21:00:00Z'),
    };
    state.selectQueue.push(
      [APPOINTMENT, secondAppointment],
      [],
    );
    state.insertQueue.push(
      [{ id: 'delivery_1' }],
      [{}],
      new Error('second token insert failed'),
      [{}],
    );

    await expect(sendBookingRecoveryEmail({
      salon: SALON,
      appointments: [APPOINTMENT, secondAppointment],
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'RECOVERY_EMAIL_PREPARATION_FAILED',
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(dbMock.select).toHaveBeenCalledTimes(2);
    expect(state.updates).toContainEqual({
      table: appointmentAccessTokenSchema,
      set: { revokedAt: expect.any(Date) },
    });

    const outbox = state.insertedValues.find(
      entry => entry.table === integrationOutboxSchema,
    )!.values as { payload: unknown };

    expect(outbox.payload).toEqual({
      deliveryId: expect.any(String),
      appointmentIds: ['appt_1', 'appt_2'],
    });
  });
});

describe('retryBookingRecoveryEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.deliveryClaimed = false;
    state.selectQueue.length = 0;
    state.insertQueue.length = 0;
    state.insertedValues.length = 0;
    state.updateQueue.length = 0;
    state.updates.length = 0;
    state.resolveAppointmentOperationalEmailRecipient.mockResolvedValue({
      status: 'terminal_current',
      email: 'fresh@example.com',
      terminalClientId: 'client_1',
    });
    state.sendTransactionalEmailDetailed.mockResolvedValue({ ok: true, providerMessageId: 'msg_2', errorCode: null });
  });

  it('does not inspect state or dispatch after its worker budget is already lost', async () => {
    const controller = new AbortController();
    controller.abort(new Error('WORKER_BUDGET_EXCEEDED'));

    await expect(retryBookingRecoveryEmail({
      salonId: 'salon_1',
      deliveryId: 'delivery_1',
      appointmentIds: ['appt_1'],
      signal: controller.signal,
    })).rejects.toThrow('WORKER_BUDGET_EXCEEDED');

    expect(dbMock.select).not.toHaveBeenCalled();
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });

  it('marks the delivery terminal when canonical resolution is unavailable', async () => {
    state.selectQueue.push([{ status: 'failed', retryable: true }]); // delivery lookup
    state.selectQueue.push([SALON]); // salon lookup
    state.selectQueue.push([APPOINTMENT]); // appointments reload
    state.resolveAppointmentOperationalEmailRecipient.mockResolvedValue({
      status: 'unavailable',
      reason: 'email_unavailable',
    });

    await expect(retryBookingRecoveryEmail({
      salonId: 'salon_1',
      deliveryId: 'delivery_1',
      appointmentIds: ['appt_1'],
    })).resolves.toEqual({
      ok: false,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
    });
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        retryable: false,
      }),
    });
  });

  it('resolves the recipient from the database at retry time and updates the original delivery row', async () => {
    state.selectQueue.push([{ status: 'failed', retryable: true }]); // delivery lookup
    state.selectQueue.push([SALON]); // salon lookup
    state.selectQueue.push([APPOINTMENT]); // appointments reload
    state.selectQueue.push([{ appointmentId: 'appt_1', name: 'Pedicure' }]); // service names
    state.insertQueue.push([{}]); // token insert
    state.selectQueue.push([]); // active-token cap check

    const result = await retryBookingRecoveryEmail({ salonId: 'salon_1', deliveryId: 'delivery_1', appointmentIds: ['appt_1'] });

    expect(result).toEqual({ ok: true });
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'fresh@example.com' }),
    );

    const deliveryUpdates = state.updates.filter(update => update.table === notificationDeliverySchema);

    expect(deliveryUpdates.at(-1)!.set).toMatchObject({ status: 'sent', retryable: false });
  });

  it('retries an orphan recovery only when every appointment still has explicit zero-candidate provenance', async () => {
    state.selectQueue.push(
      [{
        status: 'failed',
        retryable: true,
        purpose: 'booking_recovery_zero_candidate',
      }],
      [SALON],
      [APPOINTMENT],
      [{ appointmentId: 'appt_1', name: 'Pedicure' }],
      [],
    );
    state.insertQueue.push([{}]);
    state.resolveAppointmentOperationalEmailRecipient.mockResolvedValue(
      ORPHAN_RECIPIENT,
    );

    await expect(retryBookingRecoveryEmail({
      salonId: 'salon_1',
      deliveryId: 'delivery_1',
      appointmentIds: ['appt_1'],
    })).resolves.toEqual({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'orphan@example.com' }),
    );
  });

  it('fails an orphan retry closed if identity state becomes terminal-owned', async () => {
    state.selectQueue.push(
      [{
        status: 'failed',
        retryable: true,
        purpose: 'booking_recovery_zero_candidate',
      }],
      [SALON],
      [APPOINTMENT],
    );
    state.resolveAppointmentOperationalEmailRecipient.mockResolvedValue({
      status: 'terminal_current',
      email: 'current@example.com',
      terminalClientId: 'client_1',
    });

    await expect(retryBookingRecoveryEmail({
      salonId: 'salon_1',
      deliveryId: 'delivery_1',
      appointmentIds: ['appt_1'],
    })).resolves.toEqual({
      ok: false,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
  });

  it('throws on provider failure so the outbox applies backoff', async () => {
    state.selectQueue.push([{ status: 'failed', retryable: true }]);
    state.selectQueue.push([SALON]);
    state.selectQueue.push([APPOINTMENT]);
    state.selectQueue.push([]);
    state.insertQueue.push([{}]);
    state.sendTransactionalEmailDetailed.mockResolvedValue({ ok: false, providerMessageId: null, errorCode: 'RESEND_HTTP_429' });

    await expect(retryBookingRecoveryEmail({ salonId: 'salon_1', deliveryId: 'delivery_1', appointmentIds: ['appt_1'] }))
      .rejects.toThrow('RESEND_HTTP_429');

    const tokenUpdates = state.updates.filter(update => update.table === appointmentAccessTokenSchema);

    expect(tokenUpdates).toHaveLength(1);
    expect(dbMock.select).toHaveBeenCalledTimes(4);
  });

  it('does not reopen retry when fresh-capability cleanup fails', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [SALON],
      [APPOINTMENT],
      [],
    );
    state.insertQueue.push([{}]);
    state.updateQueue.push(
      [{ id: 'delivery_1' }],
      new Error('token cleanup unavailable'),
    );
    state.sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      providerMessageId: null,
      errorCode: 'RESEND_HTTP_500',
    });

    await expect(retryBookingRecoveryEmail({
      salonId: 'salon_1',
      deliveryId: 'delivery_1',
      appointmentIds: ['appt_1'],
    })).rejects.toThrow('RECOVERY_CAPABILITY_CLEANUP_FAILED');

    state.selectQueue.push([{
      status: 'failed',
      retryable: false,
      errorCode: 'RECOVERY_CAPABILITY_CLEANUP_FAILED',
    }]);

    await expect(retryBookingRecoveryEmail({
      salonId: 'salon_1',
      deliveryId: 'delivery_1',
      appointmentIds: ['appt_1'],
    })).resolves.toEqual({
      ok: false,
      errorCode: 'RECOVERY_CAPABILITY_CLEANUP_FAILED',
    });
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
  });

  it('does not revoke or throw for an ambiguous network result', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [SALON],
      [APPOINTMENT],
      [],
    );
    state.insertQueue.push([{}]);
    state.sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      providerMessageId: null,
      errorCode: 'RESEND_NETWORK_ERROR',
    });

    await expect(retryBookingRecoveryEmail({
      salonId: 'salon_1',
      deliveryId: 'delivery_1',
      appointmentIds: ['appt_1'],
    })).resolves.toEqual({
      ok: false,
      errorCode: 'RESEND_NETWORK_ERROR',
    });

    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        retryable: false,
      }),
    });
    expect(state.updates.filter(
      update => update.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);

    state.selectQueue.push([{
      status: 'failed',
      retryable: false,
      errorCode: 'RESEND_NETWORK_ERROR',
    }]);

    await expect(retryBookingRecoveryEmail({
      salonId: 'salon_1',
      deliveryId: 'delivery_1',
      appointmentIds: ['appt_1'],
    })).resolves.toEqual({
      ok: false,
      errorCode: 'RESEND_NETWORK_ERROR',
    });
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
  });

  it('does not revoke or throw after provider success when the sent-state write fails', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [SALON],
      [APPOINTMENT],
      [],
      [],
    );
    state.insertQueue.push([{}]);
    state.updateQueue.push(
      [{ id: 'delivery_1' }],
      new Error('delivery ledger unavailable'),
    );

    await expect(retryBookingRecoveryEmail({
      salonId: 'salon_1',
      deliveryId: 'delivery_1',
      appointmentIds: ['appt_1'],
    })).resolves.toEqual({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
    expect(state.updates.filter(
      update => update.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);

    state.selectQueue.push([{
      status: 'queued',
      retryable: false,
      errorCode: 'EMAIL_DELIVERY_STATE_UNKNOWN',
    }]);

    await expect(retryBookingRecoveryEmail({
      salonId: 'salon_1',
      deliveryId: 'delivery_1',
      appointmentIds: ['appt_1'],
    })).resolves.toEqual({
      ok: false,
      errorCode: 'EMAIL_DELIVERY_STATE_UNKNOWN',
    });
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
  });

  it('does not send when another recovery retry already owns the delivery claim', async () => {
    state.selectQueue.push([{
      status: 'failed',
      retryable: true,
      errorCode: 'RESEND_HTTP_500',
    }]);
    state.updateQueue.push([]);

    await expect(retryBookingRecoveryEmail({
      salonId: 'salon_1',
      deliveryId: 'delivery_1',
      appointmentIds: ['appt_1'],
    })).resolves.toEqual({
      ok: false,
      errorCode: 'RESEND_HTTP_500',
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
  });

  it('restores retryability without minting a capability when retry preparation fails', async () => {
    state.selectQueue.push(
      [{
        status: 'failed',
        retryable: true,
        errorCode: 'RESEND_HTTP_500',
      }],
      [SALON],
      [APPOINTMENT],
    );
    state.resolveAppointmentOperationalEmailRecipient.mockRejectedValueOnce(
      new Error('recipient resolution unavailable'),
    );

    await expect(retryBookingRecoveryEmail({
      salonId: 'salon_1',
      deliveryId: 'delivery_1',
      appointmentIds: ['appt_1'],
    })).rejects.toThrow('recipient resolution unavailable');

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        retryable: true,
        errorCode: 'RECOVERY_EMAIL_PREPARATION_FAILED',
      }),
    });
  });

  it('revokes retry capabilities when the immediate pre-send recipient becomes unavailable', async () => {
    state.selectQueue.push(
      [{
        status: 'failed',
        retryable: true,
        errorCode: 'RESEND_HTTP_500',
      }],
      [SALON],
      [APPOINTMENT],
      [],
    );
    state.insertQueue.push([{}]);
    state.resolveAppointmentOperationalEmailRecipient
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'initial@example.com',
        terminalClientId: 'client_1',
      })
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'before-token@example.com',
        terminalClientId: 'client_1',
      })
      .mockResolvedValueOnce({
        status: 'unavailable',
        reason: 'email_unavailable',
      });

    await expect(retryBookingRecoveryEmail({
      salonId: 'salon_1',
      deliveryId: 'delivery_1',
      appointmentIds: ['appt_1'],
    })).resolves.toEqual({
      ok: false,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: appointmentAccessTokenSchema,
      set: { revokedAt: expect.any(Date) },
    });
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        retryable: false,
      }),
    });
  });

  it('allows exactly one concurrent recovery retry to invoke the provider', async () => {
    const retryableDelivery = {
      status: 'failed',
      retryable: true,
      errorCode: 'RESEND_HTTP_500',
    };
    state.selectQueue.push(
      [retryableDelivery],
      [retryableDelivery],
      [SALON],
      [APPOINTMENT],
      [],
      [],
    );
    state.insertQueue.push([{}]);

    const results = await Promise.all([
      retryBookingRecoveryEmail({
        salonId: 'salon_1',
        deliveryId: 'delivery_1',
        appointmentIds: ['appt_1'],
      }),
      retryBookingRecoveryEmail({
        salonId: 'salon_1',
        deliveryId: 'delivery_1',
        appointmentIds: ['appt_1'],
      }),
    ]);

    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema,
    )).toHaveLength(1);
  });

  it('does not resend a recovery event already recorded as sent', async () => {
    state.selectQueue.push([{ status: 'sent' }]);

    await expect(retryBookingRecoveryEmail({
      salonId: 'salon_1',
      deliveryId: 'delivery_1',
      appointmentIds: ['appt_1'],
    })).resolves.toEqual({ ok: true });

    expect(state.resolveAppointmentOperationalEmailRecipient).not.toHaveBeenCalled();
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });

  it('uses the current common recipient when it changes during retry preparation', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [SALON],
      [APPOINTMENT],
      [],
      [],
    );
    state.insertQueue.push([{}]);
    state.resolveAppointmentOperationalEmailRecipient
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'old@example.com',
        terminalClientId: 'client_1',
      })
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'new@example.com',
        terminalClientId: 'client_1',
      })
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'new@example.com',
        terminalClientId: 'client_1',
      });

    await retryBookingRecoveryEmail({
      salonId: 'salon_1',
      deliveryId: 'delivery_1',
      appointmentIds: ['appt_1'],
    });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'new@example.com' }),
    );
  });
});
