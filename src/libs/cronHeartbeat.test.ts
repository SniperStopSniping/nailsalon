import { afterEach, describe, expect, it, vi } from 'vitest';

import { pingCronHeartbeat } from './cronHeartbeat';

const RECONCILE_ENV = 'CHECKLY_DEPOSIT_RECONCILE_HEARTBEAT_URL';
const OUTBOX_ENV = 'CHECKLY_INTEGRATION_OUTBOX_HEARTBEAT_URL';

describe('cron heartbeat pings', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('skips cleanly until the owner installs the generated Checkly URL', async () => {
    vi.stubEnv(RECONCILE_ENV, '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(pingCronHeartbeat('deposit_reconcile')).resolves.toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pings only the selected Checkly heartbeat with a bounded request', async () => {
    vi.stubEnv(RECONCILE_ENV, 'https://ping.checklyhq.com/reconcile-check-id');
    vi.stubEnv(OUTBOX_ENV, 'https://ping.checklyhq.com/outbox-check-id');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(pingCronHeartbeat('integration_outbox')).resolves.toBe('sent');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://ping.checklyhq.com/outbox-check-id'),
      expect.objectContaining({
        cache: 'no-store',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    ['malformed', 'not-a-url'],
    ['non-HTTPS', 'http://ping.checklyhq.com/check-id'],
    ['foreign host', 'https://example.com/check-id'],
    ['credential-bearing', 'https://user:password@ping.checklyhq.com/check-id'],
  ])('fails closed for a %s endpoint without sending a request', async (_label, endpoint) => {
    vi.stubEnv(RECONCILE_ENV, endpoint);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(pingCronHeartbeat('deposit_reconcile')).resolves.toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('contains network and non-success responses so work is never replayed for monitoring', async () => {
    vi.stubEnv(RECONCILE_ENV, 'https://ping.checklyhq.com/reconcile-check-id');
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(pingCronHeartbeat('deposit_reconcile')).resolves.toBe('failed');
    await expect(pingCronHeartbeat('deposit_reconcile')).resolves.toBe('failed');
  });
});
