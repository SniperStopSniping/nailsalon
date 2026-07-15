/* eslint-disable import/first */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/adminAuth', () => ({}));
vi.mock('@/libs/clientAuth', () => ({}));
vi.mock('@/libs/queries', () => ({}));
vi.mock('@/libs/rateLimit', () => ({}));
vi.mock('@/libs/staffAuth', () => ({}));

import { POST as adminSend } from './admin/auth/send-otp/route';
import { POST as adminVerify } from './admin/auth/verify-otp/route';
import { POST as customerSend } from './auth/send-otp/route';
import { POST as customerVerify } from './auth/verify-otp/route';
import { POST as staffSend } from './staff/send-otp/route';
import { POST as staffVerify } from './staff/verify-otp/route';

const originalLegacyFlag = process.env.LEGACY_OTP_AUTH_ENABLED;
const fetchSpy = vi.spyOn(globalThis, 'fetch');

const routes = [
  ['customer send', customerSend],
  ['customer verify', customerVerify],
  ['admin send', adminSend],
  ['admin verify', adminVerify],
  ['staff send', staffSend],
  ['staff verify', staffVerify],
] as const;

describe('retired OTP endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LEGACY_OTP_AUTH_ENABLED = 'false';
  });

  afterEach(() => {
    if (originalLegacyFlag === undefined) {
      delete process.env.LEGACY_OTP_AUTH_ENABLED;
    } else {
      process.env.LEGACY_OTP_AUTH_ENABLED = originalLegacyFlag;
    }
  });

  it.each(routes)('%s returns 410 before validation, database, or Twilio', async (_name, handler) => {
    const response = await handler(new Request('http://localhost/api/retired-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: 'LEGACY_OTP_DISABLED' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
