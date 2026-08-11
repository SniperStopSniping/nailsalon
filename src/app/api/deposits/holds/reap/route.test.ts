import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reapExpiredDepositHolds } = vi.hoisted(() => ({
  reapExpiredDepositHolds: vi.fn(),
}));

vi.mock('@/libs/depositHoldReaper', () => ({
  reapExpiredDepositHolds,
  DEPOSIT_REAP_MAX_DURATION_SECONDS: 300,
  DEPOSIT_REAP_BATCH: 16,
}));

/* eslint-disable import/first */
import { DEPOSIT_REAP_BATCH, DEPOSIT_REAP_MAX_DURATION_SECONDS } from '@/libs/depositHoldReaper';

import { GET, maxDuration, POST } from './route';
/* eslint-enable import/first */

function request(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/deposits/holds/reap', { method: 'POST', headers });
}

describe('reap route auth (§14 test 23)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reapExpiredDepositHolds.mockResolvedValue({
      scanned: 0,
      finalized: 0,
      leftStanding: 0,
      healed: 0,
      leaseAcquired: true,
    });
  });

  it('500s when CRON_SECRET is unset, and does NOT run the reaper', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const response = await POST(request({ 'x-cron-secret': 'anything' }));

    expect(response.status).toBe(500);
    // A misconfigured deployment must not silently expose a mutating endpoint.
    expect(reapExpiredDepositHolds).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
  });

  it('401s on the wrong secret, for both accepted header forms', async () => {
    vi.stubEnv('CRON_SECRET', 'right');

    const viaHeader = await POST(request({ 'x-cron-secret': 'wrong' }));
    const viaBearer = await POST(request({ authorization: 'Bearer wrong' }));

    expect(viaHeader.status).toBe(401);
    expect(viaBearer.status).toBe(401);
    expect(reapExpiredDepositHolds).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
  });

  it('401s when no secret is presented at all', async () => {
    vi.stubEnv('CRON_SECRET', 'right');

    expect((await POST(request())).status).toBe(401);
    expect(reapExpiredDepositHolds).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
  });

  it('200s on the right secret, via x-cron-secret AND Authorization: Bearer', async () => {
    vi.stubEnv('CRON_SECRET', 'right');

    const viaHeader = await POST(request({ 'x-cron-secret': 'right' }));
    const viaBearer = await GET(request({ authorization: 'Bearer right' }));

    expect(viaHeader.status).toBe(200);
    expect(viaBearer.status).toBe(200);
    expect(reapExpiredDepositHolds).toHaveBeenCalledTimes(2);

    vi.unstubAllEnvs();
  });

  it('declares a maxDuration that matches the reaper\'s own derivation', () => {
    // Next.js evaluates `maxDuration` STATICALLY, so the route must spell it as
    // a literal or the platform default is silently applied instead. This test
    // is therefore the only thing keeping the literal and the derivation from
    // drifting apart.
    expect(maxDuration).toBe(DEPOSIT_REAP_MAX_DURATION_SECONDS);
    // batch x 3 worst-case Stripe round trips x the 6 s client timeout.
    expect(DEPOSIT_REAP_BATCH * 3 * 6).toBeLessThanOrEqual(maxDuration);
  });
});
