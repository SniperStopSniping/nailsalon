/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getClientSession,
  refreshClientSession,
  setClientSessionCookies,
} = vi.hoisted(() => ({
  getClientSession: vi.fn(),
  refreshClientSession: vi.fn(),
  setClientSessionCookies: vi.fn(),
}));

vi.mock('@/libs/clientAuth', () => ({
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

  it('returns 410 without changing cookies, validating, or renewing', async () => {
    const response = await GET();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'LEGACY_CUSTOMER_AUTH_DISABLED',
        message: 'Customer sign-in is unavailable. Book as a guest or use your secure appointment management link.',
      },
    });
    expect(getClientSession).not.toHaveBeenCalled();
    expect(refreshClientSession).not.toHaveBeenCalled();
    expect(setClientSessionCookies).not.toHaveBeenCalled();
  });
});
