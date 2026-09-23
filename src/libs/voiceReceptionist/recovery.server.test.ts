import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), read: vi.fn(), status: vi.fn(), select: vi.fn(), from: vi.fn(), innerJoin: vi.fn(), where: vi.fn(), limit: vi.fn(), update: vi.fn(), set: vi.fn(), returning: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: { select: mocks.select, update: mocks.update } }));
vi.mock('@/libs/customerAssistant/bookingStatus.server', () => ({ readCustomerBookingStatus: mocks.status }));
vi.mock('@/libs/customerAssistant/operationStore.server', () => ({ readCustomerBookingOperation: mocks.read }));
vi.mock('./storage.server', () => ({ getVoiceCall: mocks.get, redactVoiceDraft: (state: unknown) => state }));
const { reconcileVoiceCallBooking } = await import('./recovery.server');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({ id: 'call-a', salonId: 'salon-a', leaseExpiresAt: null, endedAt: new Date(), draft: { consentHash: 'confirmed', booking: { operation: { capability: 'cap-a' } }, confirmation: { id: 'checkpoint-a', stage: 'committing' } } });
  mocks.read.mockResolvedValue({ sessionId: 'call-a', appointmentId: 'appointment-a' });
  mocks.status.mockResolvedValue({ status: 'confirmed', appointment: { id: 'appointment-a' } });
  mocks.returning.mockResolvedValue([{ id: 'call-a' }]);
  mocks.set.mockReturnValue({ where: () => ({ returning: mocks.returning }) });
  mocks.update.mockReturnValue({ set: mocks.set });
});

describe('voice durable booking reconciliation', () => {
  it('links a proven canonical appointment after a crash and parent hangup without creating or messaging', async () => {
    await expect(reconcileVoiceCallBooking('call-a', 'salon-a', 'secret')).resolves.toMatchObject({ bookingStatus: { appointment: { id: 'appointment-a' } }, confirmation: { stage: 'committed' } });
    expect(mocks.read).toHaveBeenCalledWith({ salonId: 'salon-a', capability: 'cap-a', secret: 'secret' });
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ appointmentId: 'appointment-a', outcome: 'booked' }));
  });

  it('does not turn an empty snapshot racing an uncommitted booking into a final not-created result', async () => {
    mocks.read.mockResolvedValue({ sessionId: 'call-a', appointmentId: null });

    await expect(reconcileVoiceCallBooking('call-a', 'salon-a', 'secret')).resolves.toBeNull();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('never reconciles another call operation or an actively leased worker', async () => {
    mocks.read.mockResolvedValue({ sessionId: 'call-b', appointmentId: 'appointment-b' });

    await expect(reconcileVoiceCallBooking('call-a', 'salon-a', 'secret')).resolves.toBeNull();

    const call = await mocks.get();
    mocks.get.mockResolvedValue({ ...call, leaseExpiresAt: new Date(Date.now() + 90_000) });
    mocks.read.mockClear();

    await expect(reconcileVoiceCallBooking('call-a', 'salon-a', 'secret')).resolves.toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
