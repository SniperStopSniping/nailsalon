import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  resume: vi.fn(),
  send: vi.fn(),
  binding: vi.fn(),
  select: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: { select: mocks.select } }));
vi.mock('@/libs/clientLifecycleStabilization', () => ({ sendAppointmentOperationalEmailOnce: mocks.send }));
vi.mock('@/libs/deposits/resumeCustomerCheckout', () => ({ resumeCustomerDepositCheckout: mocks.resume }));
vi.mock('../customerAssistant/contact.server', () => ({ createCustomerContactBinding: mocks.binding }));
vi.mock('../customerAssistant/operationStore.server', () => ({ readCustomerBookingOperation: mocks.read }));

const { sendVoiceDepositLink } = await import('./depositDelivery.server');

const input = { salonId: 'salon-a', capability: 'opaque-capability', secret: 's'.repeat(32) };
const appointment = {
  id: 'appointment-a',
  salonId: input.salonId,
  status: 'awaiting_payment',
  clientName: 'Ava Client',
  clientEmail: 'ava@example.test',
  clientPhone: '4165550100',
  holdExpiresAt: new Date('2030-01-01T00:00:00Z'),
};

function selectRows(...rows: unknown[]) {
  let call = 0;
  mocks.select.mockImplementation(() => ({
    from() {
      return this;
    },
    where() {
      return this;
    },
    limit: () => Promise.resolve([rows[call++] ?? null].filter(Boolean)),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ appointmentId: appointment.id, sessionId: 'b883cdd1-f08e-41c4-a9f0-90fa5c946630', contactBinding: 'bound-contact' });
  mocks.binding.mockReturnValue('bound-contact');
  mocks.resume.mockResolvedValue('https://checkout.stripe.com/c/pay/cs_synthetic');
  mocks.send.mockResolvedValue({ status: 'sent', deliveryId: 'delivery-1', claimed: true });
  selectRows(appointment, { id: appointment.id });
});

describe('voice deposit checkout delivery', () => {
  it('uses only the operation-bound appointment and sends through durable operational email delivery', async () => {
    await expect(sendVoiceDepositLink(input)).resolves.toBe('accepted');

    expect(mocks.resume).toHaveBeenCalledWith({ salonId: input.salonId, appointmentId: appointment.id });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      salonId: input.salonId,
      appointmentId: appointment.id,
      purpose: 'voice_deposit_checkout',
      eventVersion: 'v1',
      retryFailed: true,
    }));
    expect(mocks.send.mock.calls[0]![0]).not.toHaveProperty('checkoutUrl');
  });

  it('rejects an appointment whose contact cannot prove the stored operation binding', async () => {
    mocks.binding.mockReturnValue('different-contact');

    await expect(sendVoiceDepositLink(input)).resolves.toBe('unavailable');
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('reports a prior durable claim as pending and never represents it as provider acceptance', async () => {
    mocks.send.mockResolvedValue({ status: 'duplicate', deliveryId: 'delivery-1', claimed: false });

    await expect(sendVoiceDepositLink(input)).resolves.toBe('pending');
  });

  it('does not send when the operation has no created appointment', async () => {
    mocks.read.mockResolvedValue({ appointmentId: null });

    await expect(sendVoiceDepositLink(input)).resolves.toBe('unavailable');
    expect(mocks.resume).not.toHaveBeenCalled();
  });

  it('does not resume or deliver an expired or no-longer-payable hold', async () => {
    selectRows(null);

    await expect(sendVoiceDepositLink(input)).resolves.toBe('unavailable');
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('rejects a changed canonical email even when the appointment snapshot still matches', async () => {
    selectRows(appointment, appointment);
    mocks.binding.mockImplementation(({ contact }) => contact.email === appointment.clientEmail ? 'bound-contact' : 'different-contact');
    mocks.send.mockImplementation(async ({ validateBeforeDelivery }) => ({ status: await validateBeforeDelivery({ email: 'unconfirmed@example.test' }) ? 'sent' : 'failed' }));

    await expect(sendVoiceDepositLink(input)).resolves.toBe('failed');
    expect(mocks.binding).toHaveBeenLastCalledWith(expect.objectContaining({ contact: expect.objectContaining({ email: 'unconfirmed@example.test' }) }));
  });

  it('accepts a still-payable hold for the actually confirmed canonical recipient', async () => {
    selectRows(appointment, appointment);
    mocks.binding.mockImplementation(({ contact }) => contact.email === appointment.clientEmail ? 'bound-contact' : 'different-contact');
    mocks.send.mockImplementation(async ({ validateBeforeDelivery }) => ({ status: await validateBeforeDelivery({ email: appointment.clientEmail }) ? 'sent' : 'failed' }));

    await expect(sendVoiceDepositLink(input)).resolves.toBe('accepted');
  });
});
