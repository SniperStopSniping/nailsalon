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
});
