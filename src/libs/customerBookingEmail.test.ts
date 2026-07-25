/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueuedResult = unknown[];

const state = vi.hoisted(() => ({
  insertQueue: [] as QueuedResult[],
  insertedValues: [] as Array<{ table: unknown; values: unknown }>,
  recipient: {
    status: 'terminal_current',
    email: 'current@example.com',
    terminalClientId: 'client_1',
  } as
  | {
    status: 'terminal_current' | 'appointment_snapshot';
    email: string;
    terminalClientId: string;
  }
  | {
    status: 'unavailable';
    reason: 'email_unavailable';
  },
  resolveAppointmentOperationalEmailRecipient: vi.fn(),
  selectQueue: [] as QueuedResult[],
  sendTransactionalEmailDetailed: vi.fn(),
  updates: [] as Array<{ table: unknown; set: Record<string, unknown> }>,
}));

const { dbMock } = vi.hoisted(() => {
  function selectChain() {
    const chain: Record<string, any> = {};
    for (const method of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(state.selectQueue.shift() ?? []).then(resolve, reject);
    return chain;
  }
  function insertChain(table: unknown) {
    const chain: Record<string, any> = {};
    chain.values = vi.fn((values: unknown) => {
      state.insertedValues.push({ table, values });
      return chain;
    });
    chain.onConflictDoNothing = vi.fn(() => chain);
    chain.returning = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(state.insertQueue.shift() ?? [{}]).then(resolve, reject);
    return chain;
  }
  function updateChain(table: unknown) {
    const chain: Record<string, any> = {};
    chain.set = vi.fn((values: Record<string, unknown>) => {
      state.updates.push({ table, set: values });
      return chain;
    });
    chain.where = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve([]).then(resolve, reject);
    return chain;
  }
  return {
    dbMock: {
      insert: vi.fn((table: unknown) => insertChain(table)),
      select: vi.fn(() => selectChain()),
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
vi.mock('./email', () => ({
  sendTransactionalEmailDetailed: state.sendTransactionalEmailDetailed,
}));
vi.mock('./bookingConfig', () => ({
  resolveBookingConfigFromSettings: () => ({
    timezone: 'America/Toronto',
  }),
}));
vi.mock('./lusterSecurity', () => ({
  createOpaqueToken: vi.fn(() => ({
    token: 'opaque-token-value',
    tokenHash: 'token-hash-value',
  })),
}));

import {
  appointmentAccessTokenSchema,
  integrationOutboxSchema,
  notificationDeliverySchema,
} from '@/models/Schema';

import {
  resendCustomerBookingConfirmationEmail,
  retryCustomerBookingConfirmationEmail,
  sendCustomerBookingConfirmationEmail,
} from './customerBookingEmail';

const appointmentRow = {
  appointment: {
    id: 'appointment_1',
    clientEmail: 'historical@example.com',
    clientName: 'Client',
    startTime: new Date('2099-07-01T18:00:00Z'),
    endTime: new Date('2099-07-01T19:00:00Z'),
  },
  salonName: 'Salon',
  salonSlug: 'salon',
  customDomain: null,
  salonSettings: null,
};

function initialInput() {
  return {
    salonId: 'salon_1',
    appointmentId: 'appointment_1',
    salonName: 'Salon',
    clientName: 'Client',
    serviceNames: ['Manicure'],
    startTime: '2099-07-01T18:00:00Z',
    timeZone: 'America/Toronto',
    manageUrl: 'https://salon.example/manage/token',
  };
}

describe('customer booking operational email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.insertQueue.length = 0;
    state.insertedValues.length = 0;
    state.selectQueue.length = 0;
    state.updates.length = 0;
    state.recipient = {
      status: 'terminal_current',
      email: 'current@example.com',
      terminalClientId: 'client_1',
    };
    state.resolveAppointmentOperationalEmailRecipient.mockImplementation(
      async () => state.recipient,
    );
    state.sendTransactionalEmailDetailed.mockResolvedValue({
      ok: true,
      providerMessageId: 'message_1',
      errorCode: null,
    });
  });

  it('resolves the current recipient before the initial confirmation send', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);

    expect(state.resolveAppointmentOperationalEmailRecipient).toHaveBeenCalledWith({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
    });
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'current@example.com' }),
    );
  });

  it('does not create delivery state or call the provider when no recipient is supported', async () => {
    state.recipient = {
      status: 'unavailable',
      reason: 'email_unavailable',
    };

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(false);

    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });

  it('does not retry a business event already recorded as sent', async () => {
    state.selectQueue.push([{ status: 'sent' }]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toEqual({
      ok: true,
      errorCode: null,
      providerMessageId: null,
    });

    expect(state.resolveAppointmentOperationalEmailRecipient).not.toHaveBeenCalled();
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });

  it('re-resolves a changed current email for a pending retry', async () => {
    state.selectQueue.push(
      [{ status: 'failed' }],
      [appointmentRow],
      [{ name: 'Manicure' }],
      [],
    );
    state.insertQueue.push([{}]);
    state.recipient = {
      status: 'terminal_current',
      email: 'changed@example.com',
      terminalClientId: 'client_1',
    };

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'changed@example.com' }),
    );
  });

  it('marks an unavailable retry terminal without putting contact data in the outbox', async () => {
    state.selectQueue.push([{ status: 'failed' }]);
    state.recipient = {
      status: 'unavailable',
      reason: 'email_unavailable',
    };

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
      providerMessageId: null,
    });

    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        retryable: false,
      }),
    });
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });

  it('revokes the fresh token and throws on provider failure so the outbox backs off', async () => {
    state.selectQueue.push(
      [{ status: 'failed' }],
      [appointmentRow],
      [],
      [],
    );
    state.insertQueue.push([{}]);
    state.sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      providerMessageId: null,
      errorCode: 'RESEND_HTTP_500',
    });

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).rejects.toThrow('RESEND_HTTP_500');

    expect(state.updates).toContainEqual({
      table: appointmentAccessTokenSchema,
      set: { revokedAt: expect.any(Date) },
    });
  });

  it('does not queue a manual retry when canonical resolution is unavailable', async () => {
    state.insertQueue.push([{}]);
    state.selectQueue.push([{ status: 'queued' }]);
    state.recipient = {
      status: 'unavailable',
      reason: 'email_unavailable',
    };

    await expect(resendCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
    });

    const outboxRows = state.insertedValues.filter(
      entry => entry.table === integrationOutboxSchema,
    );

    expect(outboxRows).toHaveLength(0);
  });
});
