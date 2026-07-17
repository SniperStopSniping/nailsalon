/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueuedResult = unknown[];

const state = vi.hoisted(() => ({
  selectQueue: [] as QueuedResult[],
  insertQueue: [] as QueuedResult[],
  insertedValues: [] as Array<{ table: unknown; values: unknown }>,
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
    chain.then = (resolve: any, reject: any) =>
      Promise.resolve(s.selectQueue.shift() ?? []).then(resolve, reject);
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
    chain.then = (resolve: any, reject: any) =>
      Promise.resolve(s.insertQueue.shift() ?? [{}]).then(resolve, reject);
    return chain;
  }
  function updateChain(table: unknown) {
    const chain: any = {};
    chain.set = vi.fn((values: Record<string, unknown>) => {
      s.updates.push({ table, set: values });
      return chain;
    });
    chain.where = vi.fn(() => chain);
    chain.then = (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject);
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

function queueHappyPathDb(options: { serviceRows?: unknown[] } = {}) {
  // Call order: insert(delivery) → select(service names) → insert(token) → select(active tokens) → update(delivery)
  state.insertQueue.push([{ id: 'delivery_1' }]); // delivery insert returning
  state.selectQueue.push(options.serviceRows ?? [{ appointmentId: 'appt_1', name: 'Gel Manicure' }]);
  state.insertQueue.push([{}]); // token insert
  state.selectQueue.push([]); // active-token cap check
}

describe('buildRecoveryDedupeKey', () => {
  it('is stable within a 10-minute bucket and rotates across buckets', () => {
    const early = new Date('2099-07-01T12:01:00Z');
    const sameBucket = new Date('2099-07-01T12:08:00Z');
    const nextBucket = new Date('2099-07-01T12:11:00Z');

    expect(buildRecoveryDedupeKey('salon_1', 'x@example.com', early))
      .toBe(buildRecoveryDedupeKey('salon_1', 'X@Example.com ', sameBucket));
    expect(buildRecoveryDedupeKey('salon_1', 'x@example.com', early))
      .not.toBe(buildRecoveryDedupeKey('salon_1', 'x@example.com', nextBucket));
  });

  it('never embeds the raw email address', () => {
    const key = buildRecoveryDedupeKey('salon_1', 'x@example.com', new Date('2099-07-01T12:00:00Z'));

    expect(key).not.toContain('x@example.com');
    expect(key).toContain(`hash_${Buffer.from('x@example.com').toString('hex')}`);
  });
});

describe('sendBookingRecoveryEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.selectQueue.length = 0;
    state.insertQueue.length = 0;
    state.insertedValues.length = 0;
    state.updates.length = 0;
    state.sendTransactionalEmailDetailed.mockResolvedValue({ ok: true, providerMessageId: 'msg_1', errorCode: null });
  });

  it('skips the send entirely on a dedupe conflict', async () => {
    state.insertQueue.push([]); // onConflictDoNothing found an existing row

    const result = await sendBookingRecoveryEmail({ salon: SALON, appointments: [APPOINTMENT], recipientEmail: 'onfile@example.com' });

    expect(result).toEqual({ ok: true, deduped: true, deliveryId: null });
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();

    const tokenInserts = state.insertedValues.filter(entry => entry.table === appointmentAccessTokenSchema);

    expect(tokenInserts).toHaveLength(0);
  });

  it('sends an email containing salon, service, date, time, timezone, and manage link', async () => {
    queueHappyPathDb();

    const result = await sendBookingRecoveryEmail({ salon: SALON, appointments: [APPOINTMENT], recipientEmail: 'onfile@example.com' });

    expect(result.ok).toBe(true);
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);

    const message = state.sendTransactionalEmailDetailed.mock.calls[0]![0] as { to: string; subject: string; text: string; html: string };

    expect(message.to).toBe('onfile@example.com');
    expect(message.subject).toContain('Test Salon');
    expect(message.text).toContain('Gel Manicure');
    expect(message.text).toContain('July 1');
    expect(message.text).toMatch(/\d{1,2}:\d{2}\s?[AP]M/);
    expect(message.text).toContain('EDT'); // America/Toronto in July
    expect(message.text).toContain('https://salon.example.com/en/manage/opaque-token-value');
    expect(message.html).toContain('Gel Manicure');

    const deliveryUpdates = state.updates.filter(update => update.table === notificationDeliverySchema);

    expect(deliveryUpdates).toHaveLength(1);
    expect(deliveryUpdates[0]!.set).toMatchObject({ status: 'sent', retryable: false });
  });

  it('marks failures retryable, revokes fresh tokens, and enqueues an outbox retry with IDs only', async () => {
    queueHappyPathDb();
    state.sendTransactionalEmailDetailed.mockResolvedValue({ ok: false, providerMessageId: null, errorCode: 'RESEND_HTTP_500' });

    const result = await sendBookingRecoveryEmail({ salon: SALON, appointments: [APPOINTMENT], recipientEmail: 'onfile@example.com' });

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

    expect(serialized).not.toContain('onfile@example.com');
    expect(serialized).not.toContain('opaque-token-value');
  });
});

describe('retryBookingRecoveryEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.selectQueue.length = 0;
    state.insertQueue.length = 0;
    state.insertedValues.length = 0;
    state.updates.length = 0;
    state.sendTransactionalEmailDetailed.mockResolvedValue({ ok: true, providerMessageId: 'msg_2', errorCode: null });
  });

  it('throws when no appointment still has an email on file', async () => {
    state.selectQueue.push([SALON]); // salon lookup
    state.selectQueue.push([{ ...APPOINTMENT, clientEmail: null }]); // appointments reload

    await expect(retryBookingRecoveryEmail({ salonId: 'salon_1', deliveryId: 'delivery_1', appointmentIds: ['appt_1'] }))
      .rejects.toThrow('RECOVERY_EMAIL_RECIPIENT_UNAVAILABLE');
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });

  it('resolves the recipient from the database at retry time and updates the original delivery row', async () => {
    state.selectQueue.push([SALON]); // salon lookup
    state.selectQueue.push([{ ...APPOINTMENT, clientEmail: 'fresh@example.com' }]); // appointments reload
    state.selectQueue.push([{ appointmentId: 'appt_1', name: 'Pedicure' }]); // service names
    state.insertQueue.push([{}]); // token insert
    state.selectQueue.push([]); // active-token cap check

    const result = await retryBookingRecoveryEmail({ salonId: 'salon_1', deliveryId: 'delivery_1', appointmentIds: ['appt_1'] });

    expect(result).toEqual({ ok: true });
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(expect.objectContaining({ to: 'fresh@example.com' }));

    const deliveryUpdates = state.updates.filter(update => update.table === notificationDeliverySchema);

    expect(deliveryUpdates[0]!.set).toMatchObject({ status: 'sent', retryable: false });
  });

  it('throws on provider failure so the outbox applies backoff', async () => {
    state.selectQueue.push([SALON]);
    state.selectQueue.push([{ ...APPOINTMENT, clientEmail: 'fresh@example.com' }]);
    state.selectQueue.push([]);
    state.insertQueue.push([{}]);
    state.selectQueue.push([]);
    state.sendTransactionalEmailDetailed.mockResolvedValue({ ok: false, providerMessageId: null, errorCode: 'RESEND_HTTP_429' });

    await expect(retryBookingRecoveryEmail({ salonId: 'salon_1', deliveryId: 'delivery_1', appointmentIds: ['appt_1'] }))
      .rejects.toThrow('RESEND_HTTP_429');

    const tokenUpdates = state.updates.filter(update => update.table === appointmentAccessTokenSchema);

    expect(tokenUpdates).toHaveLength(1);
  });
});
