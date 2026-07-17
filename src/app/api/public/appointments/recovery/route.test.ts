/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSalonBySlug, checkBookingRecoveryRateLimit, getActiveAppointmentsForContact, sendBookingRecoveryEmail, loggerWarn, loggerError } = vi.hoisted(() => ({
  getSalonBySlug: vi.fn(),
  checkBookingRecoveryRateLimit: vi.fn(),
  getActiveAppointmentsForContact: vi.fn(),
  sendBookingRecoveryEmail: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/libs/queries', () => ({ getSalonBySlug }));
vi.mock('@/libs/bookingRecoveryRateLimit', () => ({ checkBookingRecoveryRateLimit }));
vi.mock('@/libs/activeAppointments', () => ({ getActiveAppointmentsForContact }));
vi.mock('@/libs/bookingRecoveryEmail', () => ({ sendBookingRecoveryEmail }));
vi.mock('@/libs/Logger', () => ({ logger: { warn: loggerWarn, error: loggerError } }));
vi.mock('@/libs/DB', () => ({ db: {} }));

import { POST } from './route';

const SALON = {
  id: 'salon_1',
  slug: 'test-salon',
  name: 'Test Salon',
  customDomain: null,
  settings: null,
};

const GENERIC_MESSAGE = 'If we find a matching appointment, we\'ll email its secure management link to the contact on file within a few minutes.';

function makeAppointment(overrides: Partial<{ id: string; clientEmail: string | null }> = {}) {
  return {
    id: overrides.id ?? 'appt_1',
    clientEmail: 'clientEmail' in overrides ? overrides.clientEmail : 'onfile@example.com',
    startTime: new Date('2099-07-01T14:00:00Z'),
    endTime: new Date('2099-07-01T15:00:00Z'),
  };
}

function post(body: unknown) {
  return POST(new Request('http://localhost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/public/appointments/recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSalonBySlug.mockResolvedValue(SALON);
    checkBookingRecoveryRateLimit.mockResolvedValue(true);
    getActiveAppointmentsForContact.mockResolvedValue([]);
    sendBookingRecoveryEmail.mockResolvedValue({ ok: true, deduped: false, deliveryId: 'delivery_1' });
  });

  it('returns the same privacy-safe response for invalid input', async () => {
    const response = await post({ salonSlug: '', email: 'not-an-email' });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({ data: { accepted: true, message: GENERIC_MESSAGE } });
    expect(sendBookingRecoveryEmail).not.toHaveBeenCalled();
  });

  it('requires at least one usable identity before touching the salon', async () => {
    const response = await post({ salonSlug: 'test-salon', phone: '123' });

    expect(response.status).toBe(202);
    expect(getSalonBySlug).not.toHaveBeenCalled();
    expect(sendBookingRecoveryEmail).not.toHaveBeenCalled();
  });

  it('does not reveal whether a salon exists', async () => {
    getSalonBySlug.mockResolvedValue(null);

    const response = await post({ salonSlug: 'unknown-salon', email: 'client@example.com' });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.data.accepted).toBe(true);
    expect(checkBookingRecoveryRateLimit).not.toHaveBeenCalled();
    expect(sendBookingRecoveryEmail).not.toHaveBeenCalled();
  });

  it('sends to the on-file email for an email match, normalizing case and whitespace', async () => {
    getActiveAppointmentsForContact.mockResolvedValue([makeAppointment()]);

    const response = await post({ salonSlug: 'test-salon', email: '  OnFile@Example.COM ' });

    expect(response.status).toBe(202);
    expect(getActiveAppointmentsForContact).toHaveBeenCalledWith({
      salonId: SALON.id,
      email: 'onfile@example.com',
      phone: undefined,
      horizon: 'recovery',
    });
    expect(sendBookingRecoveryEmail).toHaveBeenCalledWith(expect.objectContaining({
      recipientEmail: 'onfile@example.com',
      appointments: [expect.objectContaining({ id: 'appt_1' })],
    }));
  });

  it('matches by phone and sends to the ON-FILE email, not an entered address', async () => {
    getActiveAppointmentsForContact.mockResolvedValue([makeAppointment()]);

    const response = await post({ salonSlug: 'test-salon', phone: '+1 (416) 555-0101' });

    expect(response.status).toBe(202);
    expect(getActiveAppointmentsForContact).toHaveBeenCalledWith({
      salonId: SALON.id,
      email: undefined,
      phone: '4165550101',
      horizon: 'recovery',
    });
    expect(sendBookingRecoveryEmail).toHaveBeenCalledWith(expect.objectContaining({
      recipientEmail: 'onfile@example.com',
    }));
  });

  it('sends nothing when the phone-matched appointment has no email on file', async () => {
    getActiveAppointmentsForContact.mockResolvedValue([makeAppointment({ clientEmail: null })]);

    const response = await post({ salonSlug: 'test-salon', phone: '4165550101' });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.data.message).toBe(GENERIC_MESSAGE);
    expect(sendBookingRecoveryEmail).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(expect.objectContaining({ event: 'booking_recovery_no_email_on_file' }));
  });

  it('includes email-less appointments alongside the recipient appointment for the same person', async () => {
    getActiveAppointmentsForContact.mockResolvedValue([
      makeAppointment({ id: 'appt_walkin', clientEmail: null }),
      makeAppointment({ id: 'appt_online', clientEmail: 'onfile@example.com' }),
    ]);

    await post({ salonSlug: 'test-salon', phone: '4165550101' });

    expect(sendBookingRecoveryEmail).toHaveBeenCalledWith(expect.objectContaining({
      recipientEmail: 'onfile@example.com',
      appointments: [
        expect.objectContaining({ id: 'appt_walkin' }),
        expect.objectContaining({ id: 'appt_online' }),
      ],
    }));
  });

  it('returns the generic response with no send when nothing matches', async () => {
    const response = await post({ salonSlug: 'test-salon', email: 'wrong@example.com' });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.data.message).toBe(GENERIC_MESSAGE);
    expect(sendBookingRecoveryEmail).not.toHaveBeenCalled();
  });

  it('returns the generic response with no lookup when rate-limited', async () => {
    checkBookingRecoveryRateLimit.mockResolvedValue(false);

    const response = await post({ salonSlug: 'test-salon', email: 'onfile@example.com' });

    expect(response.status).toBe(202);
    expect(getActiveAppointmentsForContact).not.toHaveBeenCalled();
    expect(sendBookingRecoveryEmail).not.toHaveBeenCalled();
  });

  it('returns 503 only when the rate limiter infrastructure is down', async () => {
    checkBookingRecoveryRateLimit.mockRejectedValue(new Error('RECOVERY_RATE_LIMIT_UNAVAILABLE'));

    const response = await post({ salonSlug: 'test-salon', email: 'onfile@example.com' });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('RECOVERY_TEMPORARILY_UNAVAILABLE');
  });

  it('still returns the generic response when the provider send fails, and logs a safe diagnostic', async () => {
    getActiveAppointmentsForContact.mockResolvedValue([makeAppointment()]);
    sendBookingRecoveryEmail.mockResolvedValue({ ok: false, deduped: false, deliveryId: 'delivery_9', errorCode: 'RESEND_HTTP_500' });

    const response = await post({ salonSlug: 'test-salon', email: 'onfile@example.com' });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.data.message).toBe(GENERIC_MESSAGE);
    expect(loggerWarn).toHaveBeenCalledWith({
      event: 'booking_recovery_send_failed',
      salonId: SALON.id,
      deliveryId: 'delivery_9',
      errorCode: 'RESEND_HTTP_500',
    });

    const logged = JSON.stringify([...loggerWarn.mock.calls, ...loggerError.mock.calls]);

    expect(logged).not.toContain('onfile@example.com');
  });

  it('masks unexpected lookup errors behind the generic response with a code-only log', async () => {
    getActiveAppointmentsForContact.mockRejectedValue(new Error('boom with details user@example.com'));

    const response = await post({ salonSlug: 'test-salon', email: 'onfile@example.com' });

    expect(response.status).toBe(202);
    expect(loggerError).toHaveBeenCalledWith({
      event: 'booking_recovery_unexpected_error',
      salonId: SALON.id,
      errorCode: 'UNEXPECTED',
    });
  });
});
