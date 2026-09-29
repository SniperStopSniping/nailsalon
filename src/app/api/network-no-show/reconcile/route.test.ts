import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcileNetworkNoShows } = vi.hoisted(() => ({
  reconcileNetworkNoShows: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/networkNoShow.server', () => ({ reconcileNetworkNoShows }));

/* eslint-disable import/first */
import { GET, POST } from './route';
/* eslint-enable import/first */

function request(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/network-no-show/reconcile', { headers });
}

describe('network no-show reconciliation cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reconcileNetworkNoShows.mockResolvedValue({ scanned: 2, recorded: 1 });
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['has no configured secret', undefined, {}, 401],
    ['has an invalid secret', 'right', { authorization: 'Bearer wrong' }, 401],
  ])('does not reconcile when it %s', async (_label, secret, headers, status) => {
    if (secret) {
      vi.stubEnv('CRON_SECRET', secret);
    } else {
      vi.stubEnv('CRON_SECRET', '');
    }

    expect((await POST(request(headers))).status).toBe(status);
    expect(reconcileNetworkNoShows).not.toHaveBeenCalled();
  });

  it('accepts the Vercel bearer secret and returns the bounded summary', async () => {
    vi.stubEnv('CRON_SECRET', 'right');

    const response = await GET(request({ authorization: 'Bearer right' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { scanned: 2, recorded: 1 } });
    expect(reconcileNetworkNoShows).toHaveBeenCalledTimes(1);
  });
});
