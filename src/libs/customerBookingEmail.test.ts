/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueuedResult = unknown[];
type QueuedUpdateResult = QueuedResult | Error;

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
  updateQueue: [] as QueuedUpdateResult[],
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
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      const next = state.updateQueue.shift() ?? [];
      return (next instanceof Error ? Promise.reject(next) : Promise.resolve(next))
        .then(resolve, reject);
    };
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
    state.updateQueue.length = 0;
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

  it('records a terminal failure and does not call the provider when no recipient is supported', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.recipient = {
      status: 'unavailable',
      reason: 'email_unavailable',
    };

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(false);

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        retryable: false,
      }),
    });
  });

  it('queues an ID-only retry when initial recipient resolution fails transiently', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }], [{}]);
    state.resolveAppointmentOperationalEmailRecipient.mockRejectedValueOnce(
      new Error('transient database failure'),
    );

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(false);

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        errorCode: 'OPERATIONAL_EMAIL_RESOLUTION_FAILED',
        retryable: true,
      }),
    });

    const outbox = state.insertedValues.find(
      entry => entry.table === integrationOutboxSchema,
    )!.values as { payload: unknown };

    expect(outbox.payload).toEqual({ deliveryId: expect.any(String) });
    expect(JSON.stringify(outbox)).not.toContain('@');
  });

  it('does not retry an ambiguous initial network result', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      providerMessageId: null,
      errorCode: 'RESEND_NETWORK_ERROR',
    });

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(false);

    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        errorCode: 'RESEND_NETWORK_ERROR',
        retryable: false,
      }),
    });
    expect(state.insertedValues.filter(
      entry => entry.table === integrationOutboxSchema,
    )).toHaveLength(0);
  });

  it('does not enqueue a duplicate after an accepted initial send when the ledger write fails', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.updateQueue.push(new Error('delivery ledger unavailable'));

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
    expect(state.insertedValues.filter(
      entry => entry.table === integrationOutboxSchema,
    )).toHaveLength(0);
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

  it('keeps the fresh token and stops retrying on an ambiguous network result', async () => {
    state.selectQueue.push(
      [{ status: 'failed' }],
      [appointmentRow],
      [],
    );
    state.insertQueue.push([{}]);
    state.sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      providerMessageId: null,
      errorCode: 'RESEND_NETWORK_ERROR',
    });

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
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
  });

  it('does not revoke or retry after provider success when the sent-state write fails', async () => {
    state.selectQueue.push(
      [{ status: 'failed' }],
      [appointmentRow],
      [],
      [],
    );
    state.insertQueue.push([{}]);
    state.updateQueue.push(new Error('delivery ledger unavailable'));

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
    expect(state.updates.filter(
      update => update.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
    expect(state.insertedValues.filter(
      entry => entry.table === integrationOutboxSchema,
    )).toHaveLength(0);
  });

  it('sends to the current recipient when it changes during retry preparation', async () => {
    state.selectQueue.push(
      [{ status: 'failed' }],
      [appointmentRow],
      [],
      [],
    );
    state.insertQueue.push([{}]);
    state.resolveAppointmentOperationalEmailRecipient
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'first@example.com',
        terminalClientId: 'client_1',
      })
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'changed@example.com',
        terminalClientId: 'client_1',
      });

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'changed@example.com' }),
    );
    expect(state.updates).not.toContainEqual({
      table: appointmentAccessTokenSchema,
      set: { revokedAt: expect.any(Date) },
    });
  });

  it('revokes the fresh token when final recipient resolution becomes unavailable', async () => {
    state.selectQueue.push(
      [{ status: 'failed' }],
      [appointmentRow],
      [],
    );
    state.insertQueue.push([{}]);
    state.resolveAppointmentOperationalEmailRecipient
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'first@example.com',
        terminalClientId: 'client_1',
      })
      .mockResolvedValueOnce({
        status: 'unavailable',
        reason: 'email_unavailable',
      });

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
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
