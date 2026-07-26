/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueuedResult = unknown[];
type QueuedSelectResult = QueuedResult | Error;
type QueuedUpdateResult = QueuedResult | Error;

const state = vi.hoisted(() => ({
  deliveryClaimed: false,
  eligibilityQueue: [] as QueuedSelectResult[],
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
    status: 'appointment_snapshot';
    email: string;
    terminalClientId: null;
    identityResolution: 'zero_identity_candidates';
  }
  | {
    status: 'unavailable';
    reason: 'email_unavailable';
  },
  resolveAppointmentOperationalEmailRecipient: vi.fn(),
  resolveBookingConfigFromSettings: vi.fn(),
  selectQueue: [] as QueuedSelectResult[],
  sendTransactionalEmailDetailed: vi.fn(),
  updateQueue: [] as QueuedUpdateResult[],
  updates: [] as Array<{ table: unknown; set: Record<string, unknown> }>,
}));

const { dbMock } = vi.hoisted(() => {
  function selectChain(nextRows: () => QueuedSelectResult) {
    const chain: Record<string, any> = {};
    for (const method of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      const next = nextRows();
      return (next instanceof Error ? Promise.reject(next) : Promise.resolve(next))
        .then(resolve, reject);
    };
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
    let updateValues: Record<string, unknown> = {};
    chain.set = vi.fn((values: Record<string, unknown>) => {
      updateValues = values;
      state.updates.push({ table, set: values });
      return chain;
    });
    chain.where = vi.fn(() => chain);
    chain.returning = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      const isClaim = updateValues.status === 'queued'
        && updateValues.retryable === false
        && updateValues.errorCode === 'EMAIL_DELIVERY_STATE_UNKNOWN';
      const next = state.updateQueue.length
        ? state.updateQueue.shift()!
        : isClaim && !state.deliveryClaimed
          ? [{ id: 'delivery_1' }]
          : [];
      if (!(next instanceof Error)) {
        if (isClaim && next.length) {
          state.deliveryClaimed = true;
        } else if (
          updateValues.status === 'failed'
          && updateValues.retryable === true
        ) {
          state.deliveryClaimed = false;
        }
      }
      return (next instanceof Error ? Promise.reject(next) : Promise.resolve(next))
        .then(resolve, reject);
    };
    return chain;
  }
  return {
    dbMock: {
      insert: vi.fn((table: unknown) => insertChain(table)),
      select: vi.fn((fields?: Record<string, unknown>) => {
        const eligibilityProjection = fields
          && Object.keys(fields).length === 3
          && 'status' in fields
          && 'deletedAt' in fields
          && 'startTime' in fields;
        return selectChain(() => eligibilityProjection
          ? state.eligibilityQueue.shift() ?? [{
            status: 'confirmed',
            deletedAt: null,
            startTime: new Date('2099-07-01T18:00:00Z'),
          }]
          : state.selectQueue.shift() ?? []);
      }),
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
  resolveBookingConfigFromSettings: state.resolveBookingConfigFromSettings,
}));
vi.mock('./lusterSecurity', () => ({
  createOpaqueToken: vi.fn(() => ({
    token: 'opaque-token-value',
    tokenHash: 'token-hash-value',
  })),
}));

import {
  appointmentAccessTokenSchema,
  appointmentSchema,
  clientCommunicationSchema,
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
    status: 'confirmed',
    deletedAt: null,
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
    state.deliveryClaimed = false;
    state.eligibilityQueue.length = 0;
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
    state.resolveBookingConfigFromSettings.mockReturnValue({
      timezone: 'America/Toronto',
    });
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

  it('uses an explicit zero-candidate orphan snapshot for the initial confirmation without mutating snapshots', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.recipient = {
      status: 'appointment_snapshot',
      email: 'orphan@example.com',
      terminalClientId: null,
      identityResolution: 'zero_identity_candidates',
    };

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'orphan@example.com' }),
    );
    expect(state.updates.some(update =>
      update.table === appointmentSchema
      || update.table === clientCommunicationSchema)).toBe(false);
    expect(state.insertedValues.some(entry =>
      entry.table === appointmentSchema
      || entry.table === clientCommunicationSchema)).toBe(false);
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

  it('does not prepare an initial confirmation for an appointment that is already terminal', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.eligibilityQueue.push([{
      status: 'cancelled',
      deletedAt: null,
      startTime: new Date('2099-07-01T18:00:00Z'),
    }]);

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(false);

    expect(state.resolveAppointmentOperationalEmailRecipient).not.toHaveBeenCalled();
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
        retryable: false,
      }),
    });
    expect(state.insertedValues.filter(
      entry => entry.table === integrationOutboxSchema,
    )).toHaveLength(0);
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
      [{ status: 'failed', retryable: true }],
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

  it('uses an explicit zero-candidate orphan snapshot for a pending confirmation retry', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [{ name: 'Manicure' }],
      [],
    );
    state.insertQueue.push([{}]);
    state.recipient = {
      status: 'appointment_snapshot',
      email: 'orphan@example.com',
      terminalClientId: null,
      identityResolution: 'zero_identity_candidates',
    };

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'orphan@example.com' }),
    );
    expect(state.updates.some(update =>
      update.table === appointmentSchema
      || update.table === clientCommunicationSchema)).toBe(false);
  });

  it('marks an unavailable retry terminal without putting contact data in the outbox', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [],
    );
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

  it.each([
    'cancelled',
    'completed',
    'no_show',
    'in_progress',
  ])('classifies a %s appointment as non-retryable on the first worker attempt', async (status) => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [{
        ...appointmentRow,
        appointment: {
          ...appointmentRow.appointment,
          status,
        },
      }],
    );

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
      providerMessageId: null,
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
    expect(state.insertedValues.filter(
      entry => entry.table === integrationOutboxSchema,
    )).toHaveLength(0);
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
        retryable: false,
      }),
    });
    expect(state.updates.some(update =>
      update.table === appointmentSchema
      || update.table === clientCommunicationSchema)).toBe(false);
  });

  it.each([
    ['deleted', {
      ...appointmentRow,
      appointment: {
        ...appointmentRow.appointment,
        deletedAt: new Date('2099-06-01T12:00:00Z'),
      },
    }],
    ['past', {
      ...appointmentRow,
      appointment: {
        ...appointmentRow.appointment,
        startTime: new Date('2020-07-01T18:00:00Z'),
      },
    }],
    ['missing', null],
  ])('classifies a %s appointment as non-retryable', async (_reason, row) => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      row ? [row] : [],
    );

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
        retryable: false,
      }),
    });
  });

  it('does not retry or duplicate side effects after a terminal appointment is classified', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [{
        ...appointmentRow,
        appointment: {
          ...appointmentRow.appointment,
          status: 'cancelled',
        },
      }],
      [{
        status: 'failed',
        retryable: false,
        errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
      }],
    );

    const input = {
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    };

    await expect(retryCustomerBookingConfirmationEmail(input)).resolves.toEqual({
      ok: false,
      errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
      providerMessageId: null,
    });
    await expect(retryCustomerBookingConfirmationEmail(input)).resolves.toMatchObject({
      ok: false,
      errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates.filter(
      update => update.set.status === 'queued',
    )).toHaveLength(1);
    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema
        || entry.table === integrationOutboxSchema,
    )).toHaveLength(0);
  });

  it('revokes the fresh token and stops when an appointment becomes terminal before delivery', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [{ name: 'Manicure' }],
    );
    state.eligibilityQueue.push([{
      status: 'cancelled',
      deletedAt: null,
      startTime: new Date('2099-07-01T18:00:00Z'),
    }]);
    state.insertQueue.push([{}]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
      providerMessageId: null,
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
        errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
        retryable: false,
      }),
    });
  });

  it('revokes the fresh token and throws on provider failure so the outbox backs off', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
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

  it('does not reopen retry when fresh-token cleanup fails', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
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

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).rejects.toThrow('BOOKING_CAPABILITY_CLEANUP_FAILED');

    state.selectQueue.push([{
      status: 'failed',
      retryable: false,
      errorCode: 'BOOKING_CAPABILITY_CLEANUP_FAILED',
    }]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'BOOKING_CAPABILITY_CLEANUP_FAILED',
    });
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
  });

  it('keeps the fresh token and stops retrying on an ambiguous network result', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
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

    state.selectQueue.push([{
      status: 'failed',
      retryable: false,
      errorCode: 'RESEND_NETWORK_ERROR',
    }]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'RESEND_NETWORK_ERROR',
    });
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
  });

  it('does not revoke or retry after provider success when the sent-state write fails', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [],
      [],
    );
    state.insertQueue.push([{}]);
    state.updateQueue.push(
      [{ id: 'delivery_1' }],
      new Error('delivery ledger unavailable'),
    );

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

    state.selectQueue.push([{
      status: 'queued',
      retryable: false,
      errorCode: 'EMAIL_DELIVERY_STATE_UNKNOWN',
    }]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'EMAIL_DELIVERY_STATE_UNKNOWN',
    });
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
  });

  it('resolves before token creation and again immediately before provider delivery', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [],
      [],
    );
    state.insertQueue.push([{}]);
    state.resolveAppointmentOperationalEmailRecipient
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'before-token@example.com',
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

    const tokenInsertIndex = dbMock.insert.mock.calls.findIndex(
      ([table]) => table === appointmentAccessTokenSchema,
    );

    expect(tokenInsertIndex).toBeGreaterThanOrEqual(0);
    expect(
      state.resolveAppointmentOperationalEmailRecipient.mock.invocationCallOrder[0],
    ).toBeLessThan(dbMock.insert.mock.invocationCallOrder[tokenInsertIndex]!);
    expect(
      state.resolveAppointmentOperationalEmailRecipient.mock.invocationCallOrder[1],
    ).toBeGreaterThan(dbMock.insert.mock.invocationCallOrder[tokenInsertIndex]!);
    expect(
      state.resolveAppointmentOperationalEmailRecipient.mock.invocationCallOrder[1],
    ).toBeLessThan(state.sendTransactionalEmailDetailed.mock.invocationCallOrder[0]!);
  });

  it('mints no fresh token when final recipient resolution is unavailable', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [],
    );
    state.resolveAppointmentOperationalEmailRecipient
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
    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
    expect(state.updates.filter(
      update => update.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
  });

  it('revokes a fresh token when the immediate pre-send recipient becomes unavailable', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [],
    );
    state.insertQueue.push([{}]);
    state.resolveAppointmentOperationalEmailRecipient
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'before-token@example.com',
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
    })).resolves.toEqual({
      ok: false,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
      providerMessageId: null,
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

  it('restores retryability without minting a token when preparation fails', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [],
    );
    state.resolveBookingConfigFromSettings.mockImplementationOnce(() => {
      throw new Error('invalid salon configuration');
    });

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).rejects.toThrow('invalid salon configuration');

    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        retryable: true,
        errorCode: 'BOOKING_EMAIL_PREPARATION_FAILED',
      }),
    });
  });

  it('keeps a temporary appointment read failure retryable', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      new Error('temporary database failure'),
    );

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).rejects.toThrow('temporary database failure');

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        errorCode: 'BOOKING_EMAIL_PREPARATION_FAILED',
        retryable: true,
      }),
    });
  });

  it('does not send when another retry already owns the delivery claim', async () => {
    state.selectQueue.push([{
      status: 'failed',
      retryable: true,
      errorCode: 'RESEND_HTTP_500',
    }]);
    state.updateQueue.push([]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'RESEND_HTTP_500',
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
  });

  it('allows exactly one concurrent retry to invoke the provider', async () => {
    const retryableDelivery = {
      status: 'failed',
      retryable: true,
      errorCode: 'RESEND_HTTP_500',
    };
    state.selectQueue.push(
      [retryableDelivery],
      [retryableDelivery],
      [appointmentRow],
      [],
      [],
    );
    state.insertQueue.push([{}]);

    const results = await Promise.all([
      retryCustomerBookingConfirmationEmail({
        salonId: 'salon_1',
        appointmentId: 'appointment_1',
        deliveryId: 'delivery_1',
      }),
      retryCustomerBookingConfirmationEmail({
        salonId: 'salon_1',
        appointmentId: 'appointment_1',
        deliveryId: 'delivery_1',
      }),
    ]);

    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema,
    )).toHaveLength(1);
  });

  it('does not queue a manual retry when canonical resolution is unavailable', async () => {
    state.insertQueue.push([{}]);
    state.selectQueue.push([{
      status: 'failed',
      retryable: true,
      errorCode: 'MANUAL_RESEND_REQUESTED',
    }], [appointmentRow], []);
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

  it('uses an explicit zero-candidate orphan snapshot for manual confirmation resend', async () => {
    state.insertQueue.push([{}], [{}]);
    state.selectQueue.push(
      [{
        status: 'failed',
        retryable: true,
        errorCode: 'MANUAL_RESEND_REQUESTED',
      }],
      [appointmentRow],
      [{ name: 'Manicure' }],
      [],
    );
    state.recipient = {
      status: 'appointment_snapshot',
      email: 'orphan@example.com',
      terminalClientId: null,
      identityResolution: 'zero_identity_candidates',
    };

    await expect(resendCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'orphan@example.com' }),
    );
    expect(state.updates.some(update =>
      update.table === appointmentSchema
      || update.table === clientCommunicationSchema)).toBe(false);
  });
});
