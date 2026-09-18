import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomerBookingOperation } from './operationStore.server';

const mocks = vi.hoisted(() => ({ select: vi.fn(), sms: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: { select: mocks.select } }));
vi.mock('@/libs/bookingSmsConsent.server', () => ({ getAppointmentSmsDeliveryPreference: mocks.sms }));
vi.mock('./operationStore.server', () => ({ customerBookingOperationReference: () => ({ capability: 'opaque', revision: 1, fingerprint: 'hash', expiresAt: '2030-01-01T00:00:00Z' }) }));
const { readCustomerBookingStatus } = await import('./bookingStatus.server');
const now = new Date('2030-01-01T00:00:00Z');
const row = { id: 'appointment', status: 'awaiting_payment', startTime: new Date('2030-01-02T15:00:00Z'), durationMinutes: 60, technicianName: 'Synthetic Tech', phone: '4165550100', holdExpiresAt: new Date(now.getTime() + 10 * 60_000), depositAmountCents: 2500, depositCurrency: 'cad', depositStatus: 'checkout_created' };
const operation = { appointmentId: 'appointment', salonId: 'synthetic', lastFailure: null, material: { review: { status: 'READY' } } } as unknown as CustomerBookingOperation;
function returnRows(rows: unknown[]) {
  const chain = { from: vi.fn(), leftJoin: vi.fn(), where: vi.fn(), limit: vi.fn(async () => rows) };
  chain.from.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  mocks.select.mockReturnValue(chain);
}

beforeEach(() => {
  vi.clearAllMocks();
  returnRows([row]);
  mocks.sms.mockResolvedValue({ state: 'opted_out' });
});

describe('truthful durable booking status', () => {
  it('reports the coherent live hold as payment required with actual STOP suppression', async () => {
    const status = await readCustomerBookingStatus(operation, 'secret', now);

    expect(status).toMatchObject({ status: 'payment_required', payment: { amountCents: 2500, currency: 'CAD', canResume: true }, appointment: { reminderState: 'opted_out' } });
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.sms).toHaveBeenCalledWith({ salonId: 'synthetic', appointmentId: 'appointment', phone: row.phone });
  });

  it('keeps an elapsed hold unresolved until durable settlement decides its outcome', async () => {
    returnRows([{ ...row, holdExpiresAt: new Date(now.getTime() - 1) }]);

    expect(await readCustomerBookingStatus(operation, 'secret', now)).toMatchObject({ status: 'payment_processing', payment: null });

    returnRows([{ ...row, status: 'confirmed', depositStatus: 'paid', holdExpiresAt: null }]);

    expect(await readCustomerBookingStatus(operation, 'secret', now)).toMatchObject({ status: 'confirmed', payment: null });
  });

  it('never calls a pending approval confirmed, even after deposit settlement', async () => {
    returnRows([{ ...row, status: 'pending', depositStatus: 'paid' }]);

    expect(await readCustomerBookingStatus(operation, 'secret', now)).toMatchObject({ status: 'awaiting_approval' });
  });

  it('keeps inconsistent payment pairs unresolved without a checkout link', async () => {
    returnRows([{ ...row, depositStatus: 'paid' }]);

    expect(await readCustomerBookingStatus(operation, 'secret', now)).toMatchObject({ status: 'payment_processing', payment: null });
  });

  it('distinguishes never-created operations from linked bookings that no longer exist', async () => {
    expect(await readCustomerBookingStatus({ ...operation, appointmentId: null }, 'secret', now)).toMatchObject({ status: 'not_created', appointment: null });
    expect(mocks.select).not.toHaveBeenCalled();

    returnRows([]);

    expect(await readCustomerBookingStatus(operation, 'secret', now)).toMatchObject({ status: 'unavailable', appointment: null });
    expect(mocks.sms).not.toHaveBeenCalled();
  });
});
