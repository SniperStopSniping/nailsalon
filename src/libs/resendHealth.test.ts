import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isResendSenderVerified } from './resendHealth';

vi.mock('server-only', () => ({}));

describe('isResendSenderVerified', () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    process.env.RESEND_API_KEY = 'runtime-only-key';
    process.env.RESEND_FROM_EMAIL = 'Luster <bookings@islanailsalon.com>';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('requires an authenticated verified matching sender domain', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: [{ name: 'islanailsalon.com', status: 'verified' }],
    }), { status: 200 }));

    await expect(isResendSenderVerified()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/domains', expect.objectContaining({
      headers: { Authorization: 'Bearer runtime-only-key' },
    }));
  });

  it('fails closed for invalid provider credentials', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));

    await expect(isResendSenderVerified()).resolves.toBe(false);
  });

  it('does not accept a different verified domain', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: [{ name: 'other.example', status: 'verified' }],
    }), { status: 200 }));

    await expect(isResendSenderVerified()).resolves.toBe(false);
  });
});
