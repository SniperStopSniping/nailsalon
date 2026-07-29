/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clearClientSessionCookies,
  getClientSession,
  refreshClientSession,
  setClientSessionCookies,
} = vi.hoisted(() => ({
  clearClientSessionCookies: vi.fn(),
  getClientSession: vi.fn(),
  refreshClientSession: vi.fn(),
  setClientSessionCookies: vi.fn(),
}));

vi.mock('@/libs/clientAuth', () => ({
  clearClientSessionCookies,
  getClientSession,
  legacyCustomerAuthDisabledResponse: () => Response.json({
    error: {
      code: 'LEGACY_CUSTOMER_AUTH_DISABLED',
      message: 'Customer sign-in is unavailable. Book as a guest or use your secure appointment management link.',
    },
  }, { status: 410 }),
  refreshClientSession,
  setClientSessionCookies,
}));

import { GET } from './route';

describe('GET /api/auth/validate-session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears legacy cookies and returns 410 without validating or renewing', async () => {
    const response = await GET();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'LEGACY_CUSTOMER_AUTH_DISABLED',
        message: 'Customer sign-in is unavailable. Book as a guest or use your secure appointment management link.',
      },
    });
    expect(clearClientSessionCookies).toHaveBeenCalledOnce();
    expect(getClientSession).not.toHaveBeenCalled();
    expect(refreshClientSession).not.toHaveBeenCalled();
    expect(setClientSessionCookies).not.toHaveBeenCalled();
  });
});
