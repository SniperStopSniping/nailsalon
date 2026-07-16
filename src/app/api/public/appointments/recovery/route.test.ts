/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSalonBySlug, checkBookingRecoveryRateLimit, sendTransactionalEmailDetailed } = vi.hoisted(() => ({
  getSalonBySlug: vi.fn(),
  checkBookingRecoveryRateLimit: vi.fn(),
  sendTransactionalEmailDetailed: vi.fn(),
}));

vi.mock('@/libs/queries', () => ({ getSalonBySlug }));
vi.mock('@/libs/bookingRecoveryRateLimit', () => ({ checkBookingRecoveryRateLimit }));
vi.mock('@/libs/email', () => ({ sendTransactionalEmailDetailed }));
vi.mock('@/libs/DB', () => ({ db: {} }));

import { POST } from './route';

describe('POST /api/public/appointments/recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSalonBySlug.mockResolvedValue(null);
  });

  it('returns the same privacy-safe response for invalid input', async () => {
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonSlug: '', email: 'not-an-email' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({ data: { accepted: true, message: 'If upcoming bookings match that email, a secure link will arrive shortly.' } });
    expect(sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });

  it('does not reveal whether a salon exists', async () => {
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonSlug: 'unknown-salon', email: 'client@example.com' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.data.accepted).toBe(true);
    expect(checkBookingRecoveryRateLimit).not.toHaveBeenCalled();
    expect(sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });
});
