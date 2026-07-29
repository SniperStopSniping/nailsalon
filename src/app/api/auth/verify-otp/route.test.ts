/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createClientSession,
  fetchMock,
  getClientByPhone,
  setClientSessionCookies,
} = vi.hoisted(() => ({
  createClientSession: vi.fn(),
  fetchMock: vi.fn(),
  getClientByPhone: vi.fn(),
  setClientSessionCookies: vi.fn(),
}));

vi.mock('@/libs/clientAuth', () => ({
  createClientSession,
  legacyCustomerAuthDisabledResponse: () => Response.json({
    error: {
      code: 'LEGACY_CUSTOMER_AUTH_DISABLED',
      message: 'Customer sign-in is unavailable. Book as a guest or use your secure appointment management link.',
    },
  }, { status: 410 }),
  setClientSessionCookies,
}));
vi.mock('@/libs/queries', () => ({ getClientByPhone }));

import { POST } from './route';

describe('POST /api/auth/verify-otp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('LEGACY_OTP_AUTH_ENABLED', 'true');
    vi.stubGlobal('fetch', fetchMock);
  });

  it.each([
    ['valid-looking credentials', { phone: '5551234567', code: '123456' }],
    ['unknown phone', { phone: '5550000000', code: '000000' }],
    ['malformed input', {}],
  ])('uniformly retires %s before provider, customer, or session work', async (_label, body) => {
    const response = await POST(new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'LEGACY_CUSTOMER_AUTH_DISABLED',
        message: 'Customer sign-in is unavailable. Book as a guest or use your secure appointment management link.',
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getClientByPhone).not.toHaveBeenCalled();
    expect(createClientSession).not.toHaveBeenCalled();
    expect(setClientSessionCookies).not.toHaveBeenCalled();
  });
});
