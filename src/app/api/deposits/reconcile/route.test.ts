import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { pingCronHeartbeat, runDepositReconcile } = vi.hoisted(() => ({
  pingCronHeartbeat: vi.fn(),
  runDepositReconcile: vi.fn(),
}));

vi.mock('@/libs/cronHeartbeat', () => ({ pingCronHeartbeat }));
vi.mock('@/libs/depositReconcile', () => ({ runDepositReconcile }));

/* eslint-disable import/first */
import { GET, POST } from './route';
/* eslint-enable import/first */

function request(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/deposits/reconcile', {
    headers,
    method: 'POST',
  });
}

describe('deposit reconcile cron heartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runDepositReconcile.mockResolvedValue({
      failed: 0,
      processed: 0,
      scanned: 0,
    });
    pingCronHeartbeat.mockResolvedValue('sent');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['missing server secret', '', { 'x-cron-secret': 'anything' }, 500],
    ['wrong caller secret', 'right', { 'x-cron-secret': 'wrong' }, 401],
  ])('does not report success for a %s', async (_label, secret, headers, status) => {
    vi.stubEnv('CRON_SECRET', secret);

    const response = await POST(request(headers));

    expect(response.status).toBe(status);
    expect(runDepositReconcile).not.toHaveBeenCalled();
    expect(pingCronHeartbeat).not.toHaveBeenCalled();
  });

  it('reports exactly one heartbeat after a successful reconcile', async () => {
    vi.stubEnv('CRON_SECRET', 'right');

    const response = await GET(request({ authorization: 'Bearer right' }));

    expect(response.status).toBe(200);
    expect(runDepositReconcile).toHaveBeenCalledTimes(1);
    expect(pingCronHeartbeat).toHaveBeenCalledTimes(1);
    expect(pingCronHeartbeat).toHaveBeenCalledWith('deposit_reconcile');
    expect(runDepositReconcile.mock.invocationCallOrder[0])
      .toBeLessThan(pingCronHeartbeat.mock.invocationCallOrder[0]!);
  });

  it('does not report success when reconcile throws', async () => {
    vi.stubEnv('CRON_SECRET', 'right');
    runDepositReconcile.mockRejectedValueOnce(new Error('reconcile failed'));
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined);

    const response = await POST(request({ 'x-cron-secret': 'right' }));

    expect(response.status).toBe(500);
    expect(pingCronHeartbeat).not.toHaveBeenCalled();
  });
});
