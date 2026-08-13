import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  pingCronHeartbeat,
  processGoogleCalendarInboundSync,
  processIntegrationOutbox,
  withTransientDatabaseRetry,
} = vi.hoisted(() => ({
  pingCronHeartbeat: vi.fn(),
  processGoogleCalendarInboundSync: vi.fn(),
  processIntegrationOutbox: vi.fn(),
  withTransientDatabaseRetry: vi.fn(async (operation: () => Promise<unknown>) => operation()),
}));

vi.mock('@/libs/cronHeartbeat', () => ({ pingCronHeartbeat }));
vi.mock('@/libs/databaseRetry', () => ({ withTransientDatabaseRetry }));
vi.mock('@/libs/googleCalendarInbound', () => ({ processGoogleCalendarInboundSync }));
vi.mock('@/libs/integrationOutbox', () => ({ processIntegrationOutbox }));

/* eslint-disable import/first */
import { GET, POST } from './route';
/* eslint-enable import/first */

function request(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/integrations/outbox/process', {
    headers,
    method: 'POST',
  });
}

describe('integration outbox cron heartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processIntegrationOutbox.mockResolvedValue({ scanned: 0, succeeded: 0 });
    processGoogleCalendarInboundSync.mockResolvedValue({ scanned: 0, succeeded: 0 });
    pingCronHeartbeat.mockResolvedValue('sent');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it.each([
    ['missing server secret', '', { 'x-cron-secret': 'anything' }, 500],
    ['wrong caller secret', 'right', { authorization: 'Bearer wrong' }, 401],
  ])('does not report success for a %s', async (_label, secret, headers, status) => {
    vi.stubEnv('CRON_SECRET', secret);

    const response = await POST(request(headers));

    expect(response.status).toBe(status);
    expect(processIntegrationOutbox).not.toHaveBeenCalled();
    expect(processGoogleCalendarInboundSync).not.toHaveBeenCalled();
    expect(pingCronHeartbeat).not.toHaveBeenCalled();
  });

  it('reports exactly one heartbeat after both worker halves succeed', async () => {
    vi.stubEnv('CRON_SECRET', 'right');

    const response = await GET(request({ authorization: 'Bearer right' }));

    expect(response.status).toBe(200);
    expect(processIntegrationOutbox).toHaveBeenCalledTimes(1);
    expect(processGoogleCalendarInboundSync).toHaveBeenCalledTimes(1);
    expect(processIntegrationOutbox).toHaveBeenCalledWith(2, {
      signal: expect.any(AbortSignal),
    });
    expect(processGoogleCalendarInboundSync).toHaveBeenCalledWith(2, undefined, {
      signal: expect.any(AbortSignal),
    });
    expect(pingCronHeartbeat).toHaveBeenCalledTimes(1);
    expect(pingCronHeartbeat).toHaveBeenCalledWith('integration_outbox');
    expect(processIntegrationOutbox.mock.invocationCallOrder[0])
      .toBeLessThan(pingCronHeartbeat.mock.invocationCallOrder[0]!);
    expect(processGoogleCalendarInboundSync.mock.invocationCallOrder[0])
      .toBeLessThan(pingCronHeartbeat.mock.invocationCallOrder[0]!);
  });

  it('does not report success when either worker half throws', async () => {
    vi.stubEnv('CRON_SECRET', 'right');
    processIntegrationOutbox.mockRejectedValueOnce(new Error('worker failed'));

    await expect(POST(request({ 'x-cron-secret': 'right' })))
      .rejects.toThrow('worker failed');
    expect(pingCronHeartbeat).not.toHaveBeenCalled();
  });

  it('aborts both workers and stops waiting for non-cooperative work', async () => {
    vi.useFakeTimers();
    vi.stubEnv('CRON_SECRET', 'right');
    let outboundSignal: AbortSignal | undefined;
    let inboundSignal: AbortSignal | undefined;
    processIntegrationOutbox.mockImplementation((_limit, options) => {
      outboundSignal = options?.signal;
      return new Promise(() => undefined);
    });
    processGoogleCalendarInboundSync.mockImplementation((_limit, _salonId, options) => {
      inboundSignal = options?.signal;
      return new Promise(() => undefined);
    });

    const operation = POST(request({ 'x-cron-secret': 'right' }));
    const rejection = expect(operation).rejects.toThrow(
      'INTEGRATION_WORKER_BUDGET_EXCEEDED',
    );
    await vi.advanceTimersByTimeAsync(240_001);

    expect(outboundSignal?.aborted).toBe(true);
    expect(inboundSignal?.aborted).toBe(true);
    expect(pingCronHeartbeat).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
  });

  it('cannot report a late worker completion after the cooperative budget expires', async () => {
    vi.useFakeTimers();
    vi.stubEnv('CRON_SECRET', 'right');
    let finishOutbound!: (value: { scanned: number }) => void;
    const outbound = new Promise<{ scanned: number }>((resolve) => {
      finishOutbound = resolve;
    });
    processIntegrationOutbox.mockReturnValue(outbound);

    const operation = POST(request({ 'x-cron-secret': 'right' }));
    const rejection = expect(operation).rejects.toThrow(
      'INTEGRATION_WORKER_BUDGET_EXCEEDED',
    );
    await vi.advanceTimersByTimeAsync(240_001);
    finishOutbound({ scanned: 1 });
    await rejection;

    expect(pingCronHeartbeat).not.toHaveBeenCalled();
  });
});
