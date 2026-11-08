/** Independent adversarial protocol checks. No Stripe client or network use. */
import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderFixtureConfig } from './evidence';
import { type OfflineStripeFixtureSigningBinding, verifyOfflineStripeWebhookReceipt } from './stripeWebhookFixture';

const originalTime = new Date('2026-11-08T12:00:00.999Z');
const config: ProviderFixtureConfig = {
  endpointId: 'endpoint_protocol',
  platformId: 'acct_protocolplatform',
  accountScope: 'connected',
  expectedAccountId: 'acct_protocolconnected',
  apiVersion: '2024-06-20',
  livemode: false,
  expectedObject: { id: 'pi_protocol', type: 'payment_intent', amountCents: 10000, currency: 'cad', chargeId: 'ch_protocol' },
};
const binding: OfflineStripeFixtureSigningBinding = {
  endpointId: config.endpointId,
  platformId: config.platformId,
  publicFixtureKey: 'public-offline-stripe-fixture:protocol_boundary',
};
function fixture(key: string = binding.publicFixtureKey) {
  const rawBody = new TextEncoder().encode(JSON.stringify({
    id: 'evt_protocol',
    object: 'event',
    type: 'payment_intent.succeeded',
    account: config.expectedAccountId,
    api_version: config.apiVersion,
    livemode: false,
    created: Math.floor(originalTime.getTime() / 1000) - 1,
    data: { object: { id: 'pi_protocol', object: 'payment_intent', amount_received: 10000, currency: 'cad', status: 'succeeded', latest_charge: 'ch_protocol', livemode: false } },
  }));
  const timestamp = Math.floor(originalTime.getTime() / 1000);
  const digest = createHmac('sha256', key).update(`${timestamp}.`).update(rawBody).digest('hex');
  return { rawBody, signature: `t=${timestamp},v1=${digest}`, receivedAt: new Date(originalTime) };
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
});

afterEach(() => vi.unstubAllEnvs());

describe('strict offline Stripe signature parser', () => {
  it.each([
    { signatureOffset: -300, receiptOffset: 999, accepted: true },
    { signatureOffset: -300, receiptOffset: 1000, accepted: false },
    { signatureOffset: 5, receiptOffset: 999, accepted: true },
    { signatureOffset: 6, receiptOffset: 999, accepted: false },
    { signatureOffset: 6, receiptOffset: 1000, accepted: true },
  ])('applies second-granular freshness at subsecond cutoff %j', async ({ signatureOffset, receiptOffset, accepted }) => {
    const input = fixture();
    const second = Math.floor(originalTime.getTime() / 1000);
    const timestamp = second + signatureOffset;
    const signature = `t=${timestamp},v1=${createHmac('sha256', binding.publicFixtureKey).update(`${timestamp}.`).update(input.rawBody).digest('hex')}`;
    const pending = verifyOfflineStripeWebhookReceipt({ ...input, signature, receivedAt: new Date(second * 1000 + receiptOffset) }, config, binding);

    if (accepted) {
      expect((await pending).classification).toBe('accepted');
    } else {
      await expect(pending).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_SIGNATURE_INVALID');
    }
  });

  it.each(['\n', '\r', '\r\n', '\u2028', '\u2029'])('rejects terminal line separator %j in a signed header or ignored component', async (ending) => {
    const input = fixture();
    for (const signature of [input.signature + ending, `${input.signature},ignored=value${ending}`, input.signature.replace(',v1=', `${ending},v1=`)]) {
      await expect(verifyOfflineStripeWebhookReceipt({ ...input, signature }, config, binding)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_SIGNATURE_INVALID');
    }
  });

  it.each(['\n', '\r', '\r\n', '\u2028', '\u2029'])('rejects terminal line separator %j in public fixture material even with a matching HMAC', async (ending) => {
    const publicFixtureKey = `${binding.publicFixtureKey}${ending}` as OfflineStripeFixtureSigningBinding['publicFixtureKey'];

    await expect(verifyOfflineStripeWebhookReceipt(fixture(publicFixtureKey), config, { ...binding, publicFixtureKey })).rejects.toThrow('CUSTOMER_PAYMENT_STRIPE_FIXTURE_CONFIG_INVALID');
  });

  it('accepts exactly 128 bounded components and rejects the next one', async () => {
    const input = fixture();
    const signature = `${input.signature}${',ignored=1'.repeat(126)}`;

    expect((await verifyOfflineStripeWebhookReceipt({ ...input, signature }, config, binding)).classification).toBe('accepted');
    await expect(verifyOfflineStripeWebhookReceipt({ ...input, signature: `${signature},ignored=1` }, config, binding)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_SIGNATURE_INVALID');
  });

  it('accepts exactly 8192 ASCII header bytes and rejects a larger header before parsing', async () => {
    const input = fixture();
    let signature = input.signature;
    while (8192 - signature.length > 515) {
      signature += `,x=${'a'.repeat(512)}`;
    }
    signature += `,x=${'a'.repeat(8192 - signature.length - 3)}`;

    expect(signature).toHaveLength(8192);
    expect((await verifyOfflineStripeWebhookReceipt({ ...input, signature }, config, binding)).classification).toBe('accepted');
    await expect(verifyOfflineStripeWebhookReceipt({ ...input, signature: `${signature}a` }, config, binding)).rejects.toThrow('CUSTOMER_PAYMENT_STRIPE_FIXTURE_CONFIG_INVALID');
  });

  it('bounds ignored component names and values rather than skipping arbitrary extra data', async () => {
    const input = fixture();

    expect((await verifyOfflineStripeWebhookReceipt({ ...input, signature: `${input.signature},${'a'.repeat(32)}=${'b'.repeat(512)}` }, config, binding)).classification).toBe('accepted');

    for (const extra of [`${'a'.repeat(33)}=b`, `a=${'b'.repeat(513)}`, 'a=', 'a=b=c', 'a=☃', ' a=b']) {
      await expect(verifyOfflineStripeWebhookReceipt({ ...input, signature: `${input.signature},${extra}` }, config, binding)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_SIGNATURE_INVALID');
    }
  });
});

describe('offline wrapper snapshot and exception boundaries', () => {
  it('never reads inputs, config or signing material when disabled by default', async () => {
    const read = vi.fn(() => {
      throw new Error('PRIVATE_INPUT_MUST_NOT_BE_READ');
    });
    const unreadable = new Proxy({}, { get: read });
    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', '');

    await expect(verifyOfflineStripeWebhookReceipt(unreadable as Parameters<typeof verifyOfflineStripeWebhookReceipt>[0], unreadable as ProviderFixtureConfig, unreadable as OfflineStripeFixtureSigningBinding)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
    expect(read).not.toHaveBeenCalled();
  });

  it('sanitizes throwing input, configuration and binding accessors', async () => {
    const input = fixture();
    const secretError = () => {
      throw new Error(`PRIVATE_FIXTURE ${input.signature} ${binding.publicFixtureKey}`);
    };
    const hostileInput = Object.defineProperty({ ...input }, 'rawBody', { get: secretError });
    const hostileConfig = Object.defineProperty({ ...config }, 'expectedObject', { get: secretError });
    const hostileBinding = Object.defineProperty({ ...binding }, 'publicFixtureKey', { get: secretError });
    for (const operation of [
      () => verifyOfflineStripeWebhookReceipt(hostileInput, config, binding),
      () => verifyOfflineStripeWebhookReceipt(input, hostileConfig, binding),
      () => verifyOfflineStripeWebhookReceipt(input, config, hostileBinding),
    ]) {
      await expect(operation()).rejects.toEqual(new Error('CUSTOMER_PAYMENT_STRIPE_FIXTURE_CONFIG_INVALID'));
    }
  });

  it('reads intrinsic receipt time rather than a caller-supplied Date override', async () => {
    const input = fixture();
    const getTime = vi.fn(() => {
      throw new Error('PRIVATE_DATE_OVERRIDE');
    });
    input.receivedAt.getTime = getTime;
    const receipt = await verifyOfflineStripeWebhookReceipt(input, config, binding);

    expect(getTime).not.toHaveBeenCalled();
    expect(receipt).toMatchObject({ classification: 'accepted', receivedAt: originalTime.toISOString() });
  });

  it('snapshots original bytes, clock, expected relationships and endpoint-bound public key before yielding', async () => {
    const input = fixture();
    const mutableConfig = structuredClone(config);
    const mutableBinding = { ...binding };
    const pending = verifyOfflineStripeWebhookReceipt(input, mutableConfig, mutableBinding);
    input.rawBody.fill(0);
    input.signature = 'PRIVATE_MUTATED_HEADER';
    input.receivedAt.setTime(0);
    mutableConfig.endpointId = 'endpoint_changed';
    mutableConfig.platformId = 'acct_changed';
    mutableConfig.expectedAccountId = 'acct_changed';
    mutableConfig.expectedObject!.chargeId = 'ch_changed';
    mutableBinding.endpointId = 'endpoint_changed';
    mutableBinding.publicFixtureKey = 'public-offline-stripe-fixture:changed';

    expect(await pending).toMatchObject({
      source: 'offline_signed_fixture',
      classification: 'accepted',
      receivedAt: originalTime.toISOString(),
      endpointId: config.endpointId,
      platformId: config.platformId,
      expectedAccountId: config.expectedAccountId,
      normalizedFacts: { chargeId: 'ch_protocol' },
    });
  });

  it('rechecks production markers before minting a receipt after the asynchronous boundary', async () => {
    const pending = verifyOfflineStripeWebhookReceipt(fixture(), config, binding);
    vi.stubEnv('APP_ENV', 'production');

    await expect(pending).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
  });
});
