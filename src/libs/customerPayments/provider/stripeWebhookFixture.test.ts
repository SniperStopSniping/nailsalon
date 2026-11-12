import { createHash, createHmac } from 'node:crypto';

import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderFixtureConfig } from './evidence';
import { assertVerifiedProviderReceipt, verifyOfflineProviderReceipt } from './evidence';
import type { OfflineStripeFixtureSigningBinding } from './stripeWebhookFixture';
import { verifyOfflineStripeWebhookReceipt } from './stripeWebhookFixture';

const nowMs = Date.parse('2026-11-08T12:00:00.000Z');
const nowSeconds = nowMs / 1000;
const publicFixtureKey = 'public-offline-stripe-fixture:unit_test_material_not_a_provider_secret';
function config(): ProviderFixtureConfig {
  return {
    endpointId: 'we_fixture',
    platformId: 'acct_platform',
    accountScope: 'connected',
    expectedAccountId: 'acct_salon',
    apiVersion: '2024-06-20',
    livemode: false,
    expectedObject: { id: 'pi_fixture', type: 'payment_intent', amountCents: 12000, currency: 'cad', chargeId: 'ch_fixture' },
  };
}
function binding(): OfflineStripeFixtureSigningBinding {
  return { endpointId: 'we_fixture', platformId: 'acct_platform', publicFixtureKey };
}
function event() {
  return {
    id: 'evt_fixture',
    object: 'event',
    type: 'payment_intent.succeeded',
    api_version: '2024-06-20',
    account: 'acct_salon',
    livemode: false,
    created: nowSeconds - 1,
    data: { object: {
      id: 'pi_fixture',
      object: 'payment_intent',
      livemode: false,
      status: 'succeeded',
      amount_received: 12000,
      currency: 'cad',
      latest_charge: 'ch_fixture',
      metadata: { private: 'PRIVATE_CUSTOMER_DATA', unicode: 'é 🍁' },
    } },
  };
}
function bytes(value: unknown = event()) {
  return new TextEncoder().encode(JSON.stringify(value));
}
function rawHeader(rawBody: Uint8Array, timestamp: string | number = nowSeconds, key = publicFixtureKey) {
  const signature = createHmac('sha256', key).update(`${timestamp}.`).update(rawBody).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}
function input(value: unknown = event(), timestamp = nowSeconds) {
  const payload = JSON.stringify(value);
  return {
    rawBody: new TextEncoder().encode(payload),
    signature: Stripe.webhooks.generateTestHeaderString({ payload, timestamp, secret: publicFixtureKey }),
    receivedAt: new Date(nowMs),
  };
}
function verify(value: unknown = event(), fixed = config()) {
  return verifyOfflineStripeWebhookReceipt(input(value), fixed, binding());
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
});

afterEach(() => vi.unstubAllEnvs());

describe('offline Stripe v1 fixture interoperability', () => {
  it('matches installed SDK test headers and authenticates without constructing a client', async () => {
    const signed = input();

    expect(signed.signature).toBe(rawHeader(signed.rawBody));
    expect(Stripe.webhooks.constructEvent(Buffer.from(signed.rawBody), signed.signature, publicFixtureKey, 300, undefined, nowMs)).toEqual(event());
    expect(vi.isMockFunction(Stripe.webhooks.generateTestHeaderString)).toBe(false);
    expect(vi.isMockFunction(Stripe.webhooks.constructEvent)).toBe(false);

    const receipt = await verifyOfflineStripeWebhookReceipt(signed, config(), binding());
    const original = await verifyOfflineProviderReceipt(signed, config(), () => true);

    expect(receipt).toEqual(original);
    expect(receipt).toMatchObject({ source: 'offline_signed_fixture', classification: 'accepted', eventId: 'evt_fixture', mode: 'test' });
    expect(() => assertVerifiedProviderReceipt(receipt)).not.toThrow();
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.normalizedFacts)).toBe(true);
    expect(Object.isFrozen(receipt.reviewReasons)).toBe(true);
    expect(JSON.stringify(receipt)).not.toMatch(/PRIVATE_CUSTOMER_DATA|public-offline-stripe-fixture|v1=|metadata/);
  });

  it('supports exact SDK-signed whitespace and Unicode, but rejects changes after signing', async () => {
    const payload = `${JSON.stringify(event(), null, 2)}\r\n`;
    const signed = { rawBody: new TextEncoder().encode(payload), signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: publicFixtureKey, timestamp: nowSeconds }), receivedAt: new Date(nowMs) };

    expect((await verifyOfflineStripeWebhookReceipt(signed, config(), binding())).classification).toBe('accepted');

    for (const changed of [payload.trim(), payload.replaceAll('\r\n', '\n'), payload.replace('é', 'é'), payload.replace('🍁', '🍂')]) {
      await expect(verifyOfflineStripeWebhookReceipt({ ...signed, rawBody: new TextEncoder().encode(changed) }, config(), binding())).rejects.toThrow('SIGNATURE_INVALID');
    }
  });

  it('accepts any matching v1 during rollover, ignoring well-formed other schemes', async () => {
    const signed = input();
    const good = signed.signature.split(',')[1]!;
    const bad = `v1=${'0'.repeat(64)}`;

    for (const signature of [`t=${nowSeconds},v0=old,${bad},${good}`, `${good},t=${nowSeconds},${bad},v2=next`, `${signed.signature},${good}`]) {
      expect((await verifyOfflineStripeWebhookReceipt({ ...signed, signature }, config(), binding())).classification).toBe('accepted');
    }

    await expect(verifyOfflineStripeWebhookReceipt({ ...signed, signature: `t=${nowSeconds},v0=${good.slice(3)}` }, config(), binding())).rejects.toThrow('SIGNATURE_INVALID');
  });

  it('rejects a wrong public fixture key and a body/header mismatch', async () => {
    const signed = input();

    await expect(verifyOfflineStripeWebhookReceipt(signed, config(), { ...binding(), publicFixtureKey: 'public-offline-stripe-fixture:wrong' })).rejects.toThrow('SIGNATURE_INVALID');
    await expect(verifyOfflineStripeWebhookReceipt({ ...signed, signature: rawHeader(bytes({ ...event(), id: 'evt_other' })) }, config(), binding())).rejects.toThrow('SIGNATURE_INVALID');
  });

  it.each([-301, -300, -1, 0, 5, 6])('uses fixed 300-second old and 5-second future bounds at offset %i', async (offset) => {
    const signed = input(event(), nowSeconds + offset);
    const pending = verifyOfflineStripeWebhookReceipt(signed, config(), binding());

    if (offset < -300 || offset > 5) {
      await expect(pending).rejects.toThrow('SIGNATURE_INVALID');
    } else {
      expect((await pending).classification).toBe('accepted');
    }
    if (offset === 6) {
      // Explicitly stricter than SDK 16.12.0: it has no future timestamp ceiling.
      expect(Stripe.webhooks.constructEvent(Buffer.from(signed.rawBody), signed.signature, publicFixtureKey, 300, undefined, nowMs)).toEqual(event());
    }
  });

  it('uses integer receipt seconds and delivery time, not event creation time', async () => {
    const oldEvent = { ...event(), created: nowSeconds - 864000 };
    const signed = input(oldEvent, nowSeconds - 300);

    expect((await verifyOfflineStripeWebhookReceipt({ ...signed, receivedAt: new Date(nowMs + 999) }, config(), binding())).classification).toBe('accepted');
    await expect(verifyOfflineStripeWebhookReceipt({ ...signed, receivedAt: new Date(nowMs + 1000) }, config(), binding())).rejects.toThrow('SIGNATURE_INVALID');
  });
});

describe('strict fixture header grammar', () => {
  it.each(['NaN', 'Infinity', '-1', '-0', '+1', '01', '1.0', '1e3', '9007199254740992', `${nowSeconds}suffix`, `${nowSeconds}.0`])('rejects noncanonical timestamp %s even with a matching raw HMAC', async (timestamp) => {
    const signed = input();

    await expect(verifyOfflineStripeWebhookReceipt({ ...signed, signature: rawHeader(signed.rawBody, timestamp) }, config(), binding())).rejects.toThrow('SIGNATURE_INVALID');
  });

  it.each(['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), '*'.repeat(64)])('rejects malformed v1 candidate %s', async (candidate) => {
    const signed = input();

    await expect(verifyOfflineStripeWebhookReceipt({ ...signed, signature: `${signed.signature},v1=${candidate}` }, config(), binding())).rejects.toThrow('SIGNATURE_INVALID');
  });

  it.each([' ', ', ', ',,', ',broken', ',=value', ',v2=', ',v2=a=b', ',v2=é', ',v2=a b', `,${'a'.repeat(33)}=v`, `,v2=${'a'.repeat(513)}`])('rejects malformed field addition %j', async (suffix) => {
    const signed = input();

    await expect(verifyOfflineStripeWebhookReceipt({ ...signed, signature: signed.signature + suffix }, config(), binding())).rejects.toThrow('SIGNATURE_INVALID');
  });

  it('rejects duplicate timestamps and timestamp parser quirks accepted by SDK 16.12.0', async () => {
    const signed = input();
    for (const signature of [`t=1,${signed.signature}`, `${signed.signature},t=${nowSeconds}`, signed.signature.replace(`t=${nowSeconds}`, `t=${nowSeconds}suffix`), rawHeader(signed.rawBody, 'NaN')]) {
      expect(Stripe.webhooks.constructEvent(Buffer.from(signed.rawBody), signature, publicFixtureKey, 300, undefined, nowMs)).toEqual(event());
      await expect(verifyOfflineStripeWebhookReceipt({ ...signed, signature }, config(), binding())).rejects.toThrow('SIGNATURE_INVALID');
    }
  });

  it('bounds field count and header bytes without weakening the matching signature', async () => {
    const signed = input();
    const maxFields = signed.signature + ',v0=0'.repeat(126);

    expect((await verifyOfflineStripeWebhookReceipt({ ...signed, signature: maxFields }, config(), binding())).classification).toBe('accepted');
    await expect(verifyOfflineStripeWebhookReceipt({ ...signed, signature: `${maxFields},v0=0` }, config(), binding())).rejects.toThrow('SIGNATURE_INVALID');
    await expect(verifyOfflineStripeWebhookReceipt({ ...signed, signature: signed.signature.padEnd(8193, 'a') }, config(), binding())).rejects.toThrow('FIXTURE_CONFIG_INVALID');
  });
});

describe('unchanged authenticated review and authority', () => {
  it.each(['{broken', 'null', '[]', '{}'])('retains correctly signed malformed or unsupported JSON %s', async (payload) => {
    const rawBody = new TextEncoder().encode(payload);
    const receipt = await verifyOfflineStripeWebhookReceipt({ rawBody, signature: rawHeader(rawBody), receivedAt: new Date(nowMs) }, config(), binding());

    expect(receipt).toMatchObject({ source: 'offline_signed_fixture', classification: 'review', eventId: null });
    expect(receipt.payloadDigest).toBe(createHash('sha256').update(rawBody).digest('hex'));
    expect(receipt.receiptIdentity).toBe(`digest:${receipt.payloadDigest}`);
    expect(() => assertVerifiedProviderReceipt(receipt)).not.toThrow();
  });

  it('authenticates malformed UTF-8 bytes without replacement-decoding or discarding evidence', async () => {
    const rawBody = Buffer.concat([Buffer.from('{"memo":"'), Buffer.from([0xFF]), Buffer.from('"}')]);
    const replacedPayload = new TextDecoder().decode(rawBody);
    const replacedHeader = Stripe.webhooks.generateTestHeaderString({ payload: replacedPayload, timestamp: nowSeconds, secret: publicFixtureKey });

    expect(Stripe.webhooks.constructEvent(rawBody, replacedHeader, publicFixtureKey, 300, undefined, nowMs)).toEqual({ memo: '�' });
    await expect(verifyOfflineStripeWebhookReceipt({ rawBody, signature: replacedHeader, receivedAt: new Date(nowMs) }, config(), binding())).rejects.toThrow('SIGNATURE_INVALID');

    const receipt = await verifyOfflineStripeWebhookReceipt({ rawBody, signature: rawHeader(rawBody), receivedAt: new Date(nowMs) }, config(), binding());

    expect(receipt.reviewReasons).toContain('MALFORMED_AUTHENTICATED_PAYLOAD');
    expect(receipt.payloadDigest).toBe(createHash('sha256').update(rawBody).digest('hex'));
    expect(receipt.classification).toBe('review');
  });

  it.each([
    { account: 'acct_foreign' },
    { account: undefined },
    { account: null },
    { livemode: true },
    { livemode: undefined },
    { api_version: '2025-01-01' },
    { api_version: null },
    { type: 'unknown.fixture' },
    { id: null },
    { data: null },
    { object: 'not_event' },
  ])('retains signed envelope mismatch %j as review', async (patch) => {
    const receipt = await verify({ ...event(), ...patch });

    expect(receipt.classification).toBe('review');
    expect(receipt.source).toBe('offline_signed_fixture');
    expect(receipt.reviewReasons.length).toBeGreaterThan(0);
  });

  it('keeps object mode, money and expanded relationship limitations unchanged', async () => {
    for (const patch of [{ livemode: true }, { status: 'processing' }, { amount_received: -1 }, { currency: 'CAD' }, { latest_charge: { id: 'ch_fixture' } }]) {
      const value = event();
      const receipt = await verify({ ...value, data: { object: { ...value.data.object, ...patch } } });

      expect(receipt.classification).toBe('review');
    }

    expect((await verify(event(), { ...config(), expectedObject: undefined })).reviewReasons).toContain('UNMATCHED_OBJECT');
  });

  it('keeps platform fee scope distinct from its object connected account', async () => {
    const value = { ...event(), account: undefined, type: 'application_fee.created', data: { object: { id: 'fee_fixture', object: 'application_fee', livemode: false, amount: 100, currency: 'cad', charge: 'ch_fixture', account: 'acct_salon' } } };
    const fixed: ProviderFixtureConfig = { ...config(), accountScope: 'platform', expectedAccountId: null, expectedObject: { id: 'fee_fixture', type: 'application_fee', amountCents: 100, currency: 'cad', chargeId: 'ch_fixture', connectedAccountId: 'acct_salon' } };

    expect(await verify(value, fixed)).toMatchObject({ classification: 'accepted', accountId: null, normalizedFacts: { connectedAccountId: 'acct_salon' } });
    expect((await verify({ ...value, account: 'acct_salon' }, fixed)).reviewReasons).toContain('ACCOUNT_SCOPE_MISMATCH');
  });

  it('retains the same receipt and digest across fresh signature redelivery', async () => {
    const first = await verify();
    const retry = await verifyOfflineStripeWebhookReceipt(input(event(), nowSeconds - 1), config(), binding());

    expect(retry).toEqual(first);

    for (const fake of [{ ...first }, JSON.parse(JSON.stringify(first))]) {
      expect(() => assertVerifiedProviderReceipt(fake)).toThrow('RECEIPT_UNVERIFIED');
    }
  });
});

describe('fixed fixture configuration and gate', () => {
  it.each([1, 128])('accepts public fixture material with a %i-character suffix', async (length) => {
    const publicFixtureKey = `public-offline-stripe-fixture:${'a'.repeat(length)}` as const;
    const signed = input();

    expect((await verifyOfflineStripeWebhookReceipt({ ...signed, signature: rawHeader(signed.rawBody, nowSeconds, publicFixtureKey) }, config(), { ...binding(), publicFixtureKey })).classification).toBe('accepted');
  });

  it.each(['', 'whsec_accidental_provider_secret', 'public-offline-stripe-fixture:', `public-offline-stripe-fixture:${'a'.repeat(129)}`, 'public-offline-stripe-fixture:space here', 'PUBLIC-OFFLINE-STRIPE-FIXTURE:key'])('rejects non-fixture or unbounded material %j', async (key) => {
    await expect(verifyOfflineStripeWebhookReceipt(input(), config(), { ...binding(), publicFixtureKey: key as never })).rejects.toThrow('STRIPE_FIXTURE_CONFIG_INVALID');
  });

  it.each([{ endpointId: 'we_other' }, { platformId: 'acct_other' }])('rejects key binding mismatch %j without trusting envelope metadata', async (patch) => {
    const value = { ...event(), ...patch, metadata: { ...patch } };

    await expect(verifyOfflineStripeWebhookReceipt(input(value), { ...config(), ...patch }, binding())).rejects.toThrow('STRIPE_FIXTURE_CONFIG_INVALID');
    await expect(verifyOfflineStripeWebhookReceipt(input(value), config(), { ...binding(), ...patch })).rejects.toThrow('STRIPE_FIXTURE_CONFIG_INVALID');
    expect((await verify(value)).endpointId).toBe('we_fixture');
    expect((await verify(value)).platformId).toBe('acct_platform');
  });

  it.each([{ apiVersion: '2025-01-01' }, { livemode: true }])('rejects unsupported fixed contract %j', async (patch) => {
    await expect(verifyOfflineStripeWebhookReceipt(input(), { ...config(), ...patch } as ProviderFixtureConfig, binding())).rejects.toThrow('STRIPE_FIXTURE_CONFIG_INVALID');
  });

  it.each([
    { rawBody: new Uint8Array() },
    { rawBody: new Uint8Array(1024 * 1024 + 1) },
    { rawBody: {} },
    { signature: '' },
    { signature: null },
    { signature: ['one', 'two'] },
    { receivedAt: new Date(Number.NaN) },
    { receivedAt: new Date(-1) },
    { receivedAt: nowMs },
  ])('rejects invalid or oversized input %#', async (patch) => {
    await expect(verifyOfflineStripeWebhookReceipt({ ...input(), ...patch } as never, config(), binding())).rejects.toThrow('STRIPE_FIXTURE_CONFIG_INVALID');
  });

  it('retains an authenticated payload at the existing one-MiB boundary', async () => {
    const rawBody = new Uint8Array(1024 * 1024).fill(32);
    const result = await verifyOfflineStripeWebhookReceipt({ rawBody, signature: rawHeader(rawBody), receivedAt: new Date(nowMs) }, config(), binding());

    expect(result.classification).toBe('review');
    expect(result.reviewReasons).toContain('MALFORMED_AUTHENTICATED_PAYLOAD');
  });

  it('snapshots bytes, signature, time, nested expectations and signing binding before await', async () => {
    const signed = input();
    const fixed = config();
    const mutableBinding = { ...binding() };
    const pending = verifyOfflineStripeWebhookReceipt(signed, fixed, mutableBinding);
    signed.rawBody.fill(0);
    signed.signature = 'changed';
    signed.receivedAt.setTime(nowMs + 86400000);
    fixed.expectedAccountId = 'acct_changed';
    fixed.endpointId = 'we_changed';
    fixed.expectedObject!.amountCents = 1;
    mutableBinding.publicFixtureKey = 'public-offline-stripe-fixture:changed';
    mutableBinding.platformId = 'acct_changed';

    expect(await pending).toMatchObject({ classification: 'accepted', endpointId: 'we_fixture', platformId: 'acct_platform', receivedAt: new Date(nowMs).toISOString(), normalizedFacts: { amountCents: 12000 } });
  });

  it.each([
    ['NODE_ENV', 'development'],
    ['NODE_ENV', 'production'],
    ['APP_ENV', 'production'],
    ['VERCEL_ENV', 'production'],
    ['CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false'],
    ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'false'],
  ])('rejects disabled %s=%s before accessing supplied input or key', async (name, value) => {
    const trap = new Proxy({}, { get: () => {
      throw new Error('PRIVATE_INPUT_MUST_NOT_BE_READ');
    } });
    vi.stubEnv(name, value);

    await expect(verifyOfflineStripeWebhookReceipt(trap as never, trap as never, trap as never)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
  });

  it('rechecks the gate after the receipt boundary yields', async () => {
    const pending = verifyOfflineStripeWebhookReceipt(input(), config(), binding());
    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false');

    await expect(pending).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
  });
});
