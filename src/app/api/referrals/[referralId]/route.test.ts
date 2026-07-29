/* eslint-disable import/first */
import { describe, expect, it, vi } from 'vitest';

const { dbSelect } = vi.hoisted(() => ({
  dbSelect: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({
  db: {
    select: dbSelect,
  },
}));
vi.mock('@/libs/clientAuth', () => ({
  legacyCustomerAuthDisabledResponse: () => Response.json({
    error: {
      code: 'LEGACY_CUSTOMER_AUTH_DISABLED',
      message: 'Customer sign-in is unavailable. Book as a guest or use your secure appointment management link.',
    },
  }, { status: 410 }),
}));

import { GET } from './route';

describe('GET /api/referrals/[referralId]', () => {
  it.each([
    ['known-looking referral', 'referral_123'],
    ['unknown referral', 'does-not-exist'],
    ['empty referral', ''],
  ])('uniformly retires %s before database lookup', async (_label, referralId) => {
    const response = await GET(
      new Request(`http://localhost/api/referrals/${referralId}`),
      { params: Promise.resolve({ referralId }) },
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'LEGACY_CUSTOMER_AUTH_DISABLED',
        message: 'Customer sign-in is unavailable. Book as a guest or use your secure appointment management link.',
      },
    });
    expect(dbSelect).not.toHaveBeenCalled();
  });
});
