import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  requireAppointmentManagerAccess: vi.fn(),
  mintAppointmentManageLink: vi.fn(),
  getSalonById: vi.fn(),
  resolveOperationalSalonClientContact: vi.fn(),
  resolveOperationalSalonClientContactByPhone: vi.fn(),
  queueAppointmentReminder: vi.fn(),
}));
vi.mock('@/libs/appointmentManageLink', () => ({ mintAppointmentManageLink: mocks.mintAppointmentManageLink }));
vi.mock('@/libs/clientLifecycleStabilization', () => ({
  resolveOperationalSalonClientContact: mocks.resolveOperationalSalonClientContact,
  resolveOperationalSalonClientContactByPhone: mocks.resolveOperationalSalonClientContactByPhone,
}));
vi.mock('@/libs/communicationMaterialization', () => ({ queueAppointmentReminder: mocks.queueAppointmentReminder }));
vi.mock('@/libs/queries', () => ({ getSalonById: mocks.getSalonById }));
vi.mock('@/libs/routeAccessGuards', () => ({ requireAppointmentManagerAccess: mocks.requireAppointmentManagerAccess }));

const appointment = {
  id: 'appt_1',
  salonId: 'salon_1',
  salonClientId: 'client_1',
  clientName: 'Ava',
  clientPhone: '4165551234',
  status: 'confirmed',
  requestExpiresAt: null,
  deletedAt: null,
  startTime: new Date('2099-07-22T21:00:00.000Z'),
  endTime: new Date('2099-07-22T22:00:00.000Z'),
};
const post = async (body?: unknown, headers?: Record<string, string>) => {
  const { POST } = await import('./route');
  return POST(new Request('https://app.test/api/appointments/appt_1/send-reminder?salonSlug=isla', {
    method: 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { params: Promise.resolve({ id: 'appt_1' }) });
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAppointmentManagerAccess.mockResolvedValue({ ok: true, appointment });
  mocks.getSalonById.mockResolvedValue({ id: 'salon_1', name: 'Isla' });
  mocks.mintAppointmentManageLink.mockResolvedValue('https://app.test/manage/private');
  mocks.resolveOperationalSalonClientContact.mockResolvedValue({ id: 'client_current', phone: '4165550198' });
  mocks.queueAppointmentReminder.mockResolvedValue({ intentId: 'ci_1', status: 'pending', created: true, scheduledFor: '2099-07-22T13:00:00.000Z' });
});

describe('POST appointment reminder', () => {
  it('queues the current client contact and reports queued instead of sent', async () => {
    const response = await post({}, { 'Idempotency-Key': 'owner-action-1' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: expect.objectContaining({ mode: 'automatic', sent: false, queued: true, status: 'pending', intentId: 'ci_1' }) });
    expect(mocks.queueAppointmentReminder).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      appointmentId: 'appt_1',
      phone: '4165550198',
      clientId: 'client_current',
      requestId: 'owner-action-1',
    }));
  });

  it('returns the same queued result for a duplicate action', async () => {
    mocks.queueAppointmentReminder.mockResolvedValue({ intentId: 'ci_existing', status: 'pending', created: false, scheduledFor: '2099-07-22T13:00:00.000Z' });

    expect(await (await post()).json()).toEqual({ data: expect.objectContaining({ intentId: 'ci_existing', sent: false, queued: true, reason: 'DUPLICATE_SUPPRESSED' }) });
  });

  it('requires an explicit action key before sending another reminder', async () => {
    const response = await post({ force: true });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REQUIRED' }) });
    expect(mocks.mintAppointmentManageLink).not.toHaveBeenCalled();
    expect(mocks.queueAppointmentReminder).not.toHaveBeenCalled();
  });

  it('preserves the explicit resend key for safe network retries', async () => {
    const response = await post({ force: true }, { 'Idempotency-Key': 'approved-resend-1' });

    expect(response.status).toBe(200);
    expect(mocks.queueAppointmentReminder).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'approved-resend-1' }));
  });

  it('rejects an unbounded action key before creating an event', async () => {
    expect((await post({ force: true }, { 'Idempotency-Key': 'x'.repeat(129) })).status).toBe(400);
    expect(mocks.queueAppointmentReminder).not.toHaveBeenCalled();
  });

  it('denies a wrong-tenant appointment before loading contacts or queuing', async () => {
    mocks.requireAppointmentManagerAccess.mockResolvedValue({ ok: false, response: Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 }) });

    expect((await post()).status).toBe(403);
    expect(mocks.getSalonById).not.toHaveBeenCalled();
    expect(mocks.queueAppointmentReminder).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'pending', requestExpiresAt: new Date('2099-07-22T18:00:00Z') },
    { status: 'cancelled' },
    { status: 'completed' },
    { status: 'no_show' },
    { startTime: new Date('2000-01-01T00:00:00Z') },
  ])('rejects appointments that cannot receive attendance reminders: %j', async (change) => {
    mocks.requireAppointmentManagerAccess.mockResolvedValue({ ok: true, appointment: { ...appointment, ...change } });

    expect((await post()).status).toBe(409);
    expect(mocks.queueAppointmentReminder).not.toHaveBeenCalled();
  });

  it.each(['INVALID_CLIENT_PHONE', 'SMS_DISABLED', 'QUIET_HOURS_STALE', 'APPOINTMENT_NOT_UPCOMING'])('shows recoverable %s errors', async (code) => {
    mocks.queueAppointmentReminder.mockRejectedValue(new Error(code));
    const response = await post();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: expect.objectContaining({ code }) });
  });

  it('rejects malformed request values', async () => {
    expect((await post({ force: 'yes' })).status).toBe(400);
    expect(mocks.queueAppointmentReminder).not.toHaveBeenCalled();
  });
});
