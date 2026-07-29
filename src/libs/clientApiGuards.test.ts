/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getResolvedSalon,
  getSalonFromSlugOrCookie,
} = vi.hoisted(() => ({
  getResolvedSalon: vi.fn(),
  getSalonFromSlugOrCookie: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/clientAuth', () => ({
  legacyCustomerAuthDisabledResponse: () => Response.json({
    error: {
      code: 'LEGACY_CUSTOMER_AUTH_DISABLED',
      message: 'Customer sign-in is unavailable. Book as a guest or use your secure appointment management link.',
    },
  }, { status: 410 }),
}));
vi.mock('./tenant', () => ({
  getResolvedSalon,
  getSalonFromSlugOrCookie,
}));

import { requireClientApiSession } from './clientApiGuards';

describe('legacy customer API guard shutdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a typed 410 before tenant or customer lookup', async () => {
    const result = await requireClientApiSession();

    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error('Legacy customer guard unexpectedly authorized a request');
    }

    expect(result.response.status).toBe(410);
    await expect(result.response.json()).resolves.toEqual({
      error: {
        code: 'LEGACY_CUSTOMER_AUTH_DISABLED',
        message: 'Customer sign-in is unavailable. Book as a guest or use your secure appointment management link.',
      },
    });
    expect(getResolvedSalon).not.toHaveBeenCalled();
    expect(getSalonFromSlugOrCookie).not.toHaveBeenCalled();
  });
});
