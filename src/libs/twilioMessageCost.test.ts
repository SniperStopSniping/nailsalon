import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  messages: vi.fn(),
  twilio: vi.fn(),
  env: {
    TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
    TWILIO_AUTH_TOKEN: 'test-token' as string | undefined,
    LUSTER_SMS_SENDER_IDENTITY: undefined as string | undefined,
  },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/Env', () => ({ Env: mocks.env }));
vi.mock('twilio', () => ({ default: mocks.twilio }));

const delivery = {
  providerMessageId: 'SM00000000000000000000000000000001',
  senderIdentity: 'luster_shared_v1',
  messagingServiceSid: 'MG00000000000000000000000000000001',
};
const message = {
  sid: delivery.providerMessageId,
  accountSid: mocks.env.TWILIO_ACCOUNT_SID,
  messagingServiceSid: delivery.messagingServiceSid,
  numSegments: '2',
  price: '-0.0158',
  priceUnit: 'usd',
};

describe('Twilio message cost reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.TWILIO_AUTH_TOKEN = 'test-token';
    mocks.env.LUSTER_SMS_SENDER_IDENTITY = undefined;
    mocks.messages.mockReturnValue({ fetch: mocks.fetch });
    mocks.twilio.mockReturnValue({ messages: mocks.messages });
    mocks.fetch.mockResolvedValue({ ...message });
  });

  it('reads the exact message with bounded timeout and durable-worker retries', async () => {
    const { fetchTwilioMessageCost } = await import('./twilioMessageCost');

    await expect(fetchTwilioMessageCost(delivery)).resolves.toEqual({ priceRaw: '-0.0158', priceCurrency: 'USD', numSegments: 2 });
    expect(mocks.twilio).toHaveBeenCalledWith(message.accountSid, 'test-token', { timeout: 5_000, autoRetry: false });
    expect(mocks.messages).toHaveBeenCalledWith(delivery.providerMessageId);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it('keeps a historical connected account instead of substituting the platform account', async () => {
    const accountSid = 'AC11111111111111111111111111111111';
    mocks.fetch.mockResolvedValue({ ...message, accountSid });
    const { fetchTwilioMessageCost } = await import('./twilioMessageCost');

    await expect(fetchTwilioMessageCost({ ...delivery, senderIdentity: `byo:${accountSid}` })).resolves.toMatchObject({ numSegments: 2 });
    expect(mocks.twilio).toHaveBeenCalledWith(accountSid, 'test-token', expect.any(Object));
  });

  it('recognizes the configured shared identity', async () => {
    mocks.env.LUSTER_SMS_SENDER_IDENTITY = 'shared_v2';
    const { fetchTwilioMessageCost } = await import('./twilioMessageCost');

    await expect(fetchTwilioMessageCost({ ...delivery, senderIdentity: 'shared_v2' })).resolves.toMatchObject({ numSegments: 2 });
  });

  it.each([null, '', 'unrecognized', 'byo:invalid'])('rejects an unowned sender before lookup: %s', async (senderIdentity) => {
    const { fetchTwilioMessageCost } = await import('./twilioMessageCost');

    await expect(fetchTwilioMessageCost({ ...delivery, senderIdentity })).rejects.toThrow('TWILIO_COST_CREDENTIALS_UNAVAILABLE');
    expect(mocks.twilio).not.toHaveBeenCalled();
  });

  it('does not call the provider without credentials', async () => {
    mocks.env.TWILIO_AUTH_TOKEN = undefined;
    const { fetchTwilioMessageCost } = await import('./twilioMessageCost');

    await expect(fetchTwilioMessageCost(delivery)).rejects.toThrow('TWILIO_COST_CREDENTIALS_UNAVAILABLE');
    expect(mocks.twilio).not.toHaveBeenCalled();
  });

  it.each(['SM_invalid', '../Messages', 'MM00000000000000000000000000000001'])('rejects invalid/non-SMS identity: %s', async (providerMessageId) => {
    const { fetchTwilioMessageCost } = await import('./twilioMessageCost');

    await expect(fetchTwilioMessageCost({ ...delivery, providerMessageId })).rejects.toThrow('TWILIO_COST_MESSAGE_ID_INVALID');
    expect(mocks.twilio).not.toHaveBeenCalled();
  });

  it.each([
    { sid: 'SM11111111111111111111111111111111' },
    { accountSid: 'AC11111111111111111111111111111111' },
    { messagingServiceSid: 'MG11111111111111111111111111111111' },
  ])('rejects mismatched provider identity: %j', async (override) => {
    mocks.fetch.mockResolvedValue({ ...message, ...override });
    const { fetchTwilioMessageCost } = await import('./twilioMessageCost');

    await expect(fetchTwilioMessageCost(delivery)).rejects.toThrow('TWILIO_COST_IDENTITY_MISMATCH');
  });

  it.each([
    { numSegments: '0' },
    { numSegments: null },
    { numSegments: '-1' },
    { numSegments: '1.5' },
    { numSegments: '2junk' },
    { numSegments: '9007199254740992' },
    { price: null },
    { price: 'NaN' },
    { price: '' },
    { priceUnit: null },
    { priceUnit: 'invalid' },
  ])('keeps missing or invalid actuals pending: %j', async (override) => {
    mocks.fetch.mockResolvedValue({ ...message, ...override });
    const { fetchTwilioMessageCost } = await import('./twilioMessageCost');

    await expect(fetchTwilioMessageCost(delivery)).resolves.toBeNull();
  });

  it('accepts a finalized zero cost', async () => {
    mocks.fetch.mockResolvedValue({ ...message, price: '0.0000' });
    const { fetchTwilioMessageCost } = await import('./twilioMessageCost');

    await expect(fetchTwilioMessageCost(delivery)).resolves.toMatchObject({ priceRaw: '0.0000' });
  });

  it.each([429, 503, 404])('reports lookup failure safely for HTTP%s without SDK retry', async (status) => {
    mocks.fetch.mockRejectedValue(Object.assign(new Error('sensitive provider details'), { status }));
    const { fetchTwilioMessageCost } = await import('./twilioMessageCost');

    await expect(fetchTwilioMessageCost(delivery)).rejects.toThrow('TWILIO_COST_LOOKUP_FAILED');
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
});
