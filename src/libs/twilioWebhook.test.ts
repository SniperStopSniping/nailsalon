import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const fetch = vi.fn();
  const validateRequest = vi.fn();
  const twilio = Object.assign(vi.fn(() => ({ api: { v2010: { accounts: () => ({ fetch }) } } })), { validateRequest });
  const limit = vi.fn();
  const query = { from: () => query, where: () => query, limit };
  return { twilio, validateRequest, fetch, limit, db: { select: () => query } };
});
vi.mock('server-only', () => ({}));
vi.mock('twilio', () => ({ default: mocks.twilio }));
vi.mock('@/libs/DB', () => ({ db: mocks.db }));
vi.mock('@/libs/Env', () => ({ Env: { TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000', TWILIO_AUTH_TOKEN: 'platform-token' } }));

const request = new Request('https://app.test/api/integrations/twilio/inbound', { headers: { 'x-twilio-signature': 'signature' } });
let sequence = 0;
const nextAccount = () => `AC${String(++sequence).padStart(32, '0')}`;

describe('Twilio webhook account signing tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.limit.mockResolvedValue([{ salonId: 'salon_1' }]);
    mocks.validateRequest.mockImplementation((token: string) => token === 'originating-token');
  });

  it('accepts the platform signature without querying or fetching another account', async () => {
    mocks.validateRequest.mockReturnValue(true);
    const { validateTwilioWebhook } = await import('./twilioWebhook');

    expect(await validateTwilioWebhook(request, { AccountSid: nextAccount() })).toBe(true);
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.twilio).not.toHaveBeenCalled();
  });

  it('validates a known connected account with its originating token and caches only briefly', async () => {
    const accountSid = nextAccount();
    mocks.fetch.mockResolvedValue({ sid: accountSid, authToken: 'originating-token' });
    const { validateTwilioWebhook } = await import('./twilioWebhook');

    expect(await validateTwilioWebhook(request, { AccountSid: accountSid })).toBe(true);
    expect(await validateTwilioWebhook(request, { AccountSid: accountSid })).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.twilio).toHaveBeenCalledWith(accountSid, 'platform-token', { timeout: 5_000, autoRetry: false });
  });

  it('never requests credentials for an unknown or malformed account', async () => {
    mocks.limit.mockResolvedValue([]);
    const { validateTwilioWebhook } = await import('./twilioWebhook');

    expect(await validateTwilioWebhook(request, { AccountSid: nextAccount() })).toBe(false);
    expect(await validateTwilioWebhook(request, { AccountSid: 'invalid-account' })).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('fails closed and bounds retries when Connect lacks read permission', async () => {
    const accountSid = nextAccount();
    mocks.fetch.mockRejectedValue(new Error('Permission denied'));
    const { validateTwilioWebhook } = await import('./twilioWebhook');

    expect(await validateTwilioWebhook(request, { AccountSid: accountSid })).toBe(false);
    expect(await validateTwilioWebhook(request, { AccountSid: accountSid })).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('never accepts an invalid signature simply because the connected account exists', async () => {
    const accountSid = nextAccount();
    mocks.fetch.mockResolvedValue({ sid: accountSid, authToken: 'originating-token' });
    mocks.validateRequest.mockReturnValue(false);
    const { validateTwilioWebhook } = await import('./twilioWebhook');

    expect(await validateTwilioWebhook(request, { AccountSid: accountSid })).toBe(false);
  });
});
