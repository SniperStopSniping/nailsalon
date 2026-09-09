import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), twilio: vi.fn(), env: { TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000' as string | undefined, TWILIO_AUTH_TOKEN: 'test-token' as string | undefined, TWILIO_MESSAGING_SERVICE_SID: 'MG00000000000000000000000000000000', NEXT_PUBLIC_APP_URL: 'https://app.test/' } }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/Env', () => ({ Env: mocks.env }));
vi.mock('twilio', () => ({ default: mocks.twilio }));
vi.mock('@/libs/communicationDispatcher', () => ({ ProviderOutcomeUnknownError: class ProviderOutcomeUnknownError extends Error {
  constructor() {
    super('PROVIDER_OUTCOME_UNKNOWN');
  }
} }));

const input = { to: '+14165550100', body: 'Test message', messagingServiceSid: 'MG00000000000000000000000000000000', statusCallbackUrl: 'https://app.test/api/integrations/twilio/status?deliveryId=nd_test' };

describe('canonical Twilio provider boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.TWILIO_AUTH_TOKEN = 'test-token';
    mocks.create.mockResolvedValue({ sid: 'SM_test' });
    mocks.twilio.mockReturnValue({ messages: { create: mocks.create } });
  });

  it('uses a bounded request and disables automatic SDK retries', async () => {
    const { sendViaSharedMessagingService, buildStatusCallbackUrl } = await import('./twilioMessagingSend');

    expect(await sendViaSharedMessagingService(input)).toEqual({ sid: 'SM_test' });
    expect(mocks.twilio).toHaveBeenCalledWith(mocks.env.TWILIO_ACCOUNT_SID, 'test-token', { timeout: 30_000, autoRetry: false });
    expect(buildStatusCallbackUrl('nd 1')).toBe('https://app.test/api/integrations/twilio/status?deliveryId=nd%201');
  });

  it.each([
    { accountSid: 'AC11111111111111111111111111111111' },
    { from: '+14165559999' },
    { messagingServiceSid: 'MG11111111111111111111111111111111' },
    { messagingServiceSid: null },
  ])('rejects non-platform sender overrides before any provider request: %j', async (override) => {
    const { sendViaSharedMessagingService } = await import('./twilioMessagingSend');

    await expect(sendViaSharedMessagingService({ ...input, ...override })).rejects.toThrow('SENDER_NOT_READY');
    expect(mocks.twilio).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('fails before the provider when credentials are absent', async () => {
    mocks.env.TWILIO_AUTH_TOKEN = undefined;
    const { sendViaSharedMessagingService } = await import('./twilioMessagingSend');

    await expect(sendViaSharedMessagingService(input)).rejects.toThrow('SENDER_NOT_READY');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([new Error('socket timeout'), Object.assign(new Error('provider internal error'), { status: 503, code: 20503 })])('parks ambiguous failures without claiming rejection', async (error) => {
    mocks.create.mockRejectedValue(error);
    const { sendViaSharedMessagingService } = await import('./twilioMessagingSend');

    await expect(sendViaSharedMessagingService(input)).rejects.toThrow('PROVIDER_OUTCOME_UNKNOWN');
  });

  it('preserves a coded 4xx rejection for safe owner retry', async () => {
    const rejection = Object.assign(new Error('rate limited'), { status: 429, code: 20429 });
    mocks.create.mockRejectedValue(rejection);
    const { sendViaSharedMessagingService } = await import('./twilioMessagingSend');

    await expect(sendViaSharedMessagingService(input)).rejects.toBe(rejection);
  });
});
