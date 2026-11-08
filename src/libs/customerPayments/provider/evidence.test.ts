import { createHmac, timingSafeEqual } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OfflineSignatureVerifier, ProviderFixtureConfig } from './evidence';
import { assertVerifiedProviderReceipt, verifyOfflineProviderReceipt } from './evidence';

const now = new Date('2026-11-08T12:00:00Z');
const key = 'public-offline-test-fixture-key-not-a-provider-secret';
const config: ProviderFixtureConfig = { endpointId: 'we_fixture', platformId: 'acct_platform', accountScope: 'connected', expectedAccountId: 'acct_salon', apiVersion: '2024-06-20', livemode: false, expectedObject: { id: 'pi_fixture', type: 'payment_intent', amountCents: 12000, currency: 'cad', chargeId: 'ch_fixture' } };
function fixture() {
  return { id: 'evt_fixture', object: 'event', type: 'payment_intent.succeeded', api_version: '2024-06-20', account: 'acct_salon', livemode: false, created: Math.floor(now.getTime() / 1000) - 1, data: { object: { id: 'pi_fixture', object: 'payment_intent', livemode: false, status: 'succeeded', amount_received: 12000, currency: 'cad', latest_charge: 'ch_fixture', metadata: { customerPhone: 'PRIVATE_PHONE', clientSecret: 'PRIVATE_SECRET' }, receipt_email: 'PRIVATE_EMAIL' } } };
}
function bytes(event: unknown) {
  return new TextEncoder().encode(JSON.stringify(event));
}
function sign(raw: Uint8Array) {
  return createHmac('sha256', key).update(raw).digest('hex');
}
const verifier: OfflineSignatureVerifier = ({ rawBody, signature, endpointId, platformId }) => {
  if (endpointId !== config.endpointId || platformId !== config.platformId || !/^[a-f0-9]{64}$/.test(signature)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(sign(rawBody), 'hex'), Buffer.from(signature, 'hex'));
};
async function receipt(event: unknown = fixture(), endpoint = config) {
  const rawBody = bytes(event);
  return verifyOfflineProviderReceipt({ rawBody, signature: sign(rawBody), receivedAt: now }, endpoint, verifier);
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

describe('offline signed fixture receipt boundary', () => {
  it('verifies original bytes and freezes only scoped normalized facts', async () => {
    const result = await receipt();

    expect(() => assertVerifiedProviderReceipt(result)).not.toThrow();
    expect(result).toMatchObject({ source: 'offline_signed_fixture', classification: 'accepted', mode: 'test', accountId: 'acct_salon', eventId: 'evt_fixture', normalizedFacts: { amountCents: 12000, currency: 'cad', chargeId: 'ch_fixture', objectLivemode: false } });
    expect(result.source).not.toBe('synthetic_test');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.normalizedFacts)).toBe(true);
    expect(Object.isFrozen(result.reviewReasons)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|metadata|receipt_email|signature/);
  });

  it('invalid signature or changed raw bytes creates no receipt, with no secret exception leak', async () => {
    const rawBody = bytes(fixture());

    await expect(verifyOfflineProviderReceipt({ rawBody: new Uint8Array([...rawBody, 32]), signature: sign(rawBody), receivedAt: now }, config, verifier)).rejects.toThrow('SIGNATURE_INVALID');
    await expect(verifyOfflineProviderReceipt({ rawBody, signature: 'bad', receivedAt: now }, config, verifier)).rejects.toThrow('SIGNATURE_INVALID');
    await expect(verifyOfflineProviderReceipt({ rawBody, signature: sign(rawBody), receivedAt: now }, config, () => {
      throw new Error('PRIVATE_SECRET');
    })).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_SIGNATURE_INVALID');
  });

  it('keeps duplicate normalized evidence stable but digests exact payload bytes', async () => {
    const first = await receipt();
    const second = await receipt();
    const rawBody = new TextEncoder().encode(JSON.stringify(fixture(), null, 2));
    const spaced = await verifyOfflineProviderReceipt({ rawBody, signature: sign(rawBody), receivedAt: now }, config, verifier);

    expect(first).toEqual(second);
    expect(first.normalizedFacts).toEqual(spaced.normalizedFacts);
    expect(first.payloadDigest).not.toBe(spaced.payloadDigest);
    expect(first.receiptIdentity).toBe(spaced.receiptIdentity);
  });

  it.each([
    { account: 'acct_foreign' },
    { account: undefined },
    { livemode: true },
    { livemode: undefined },
    { api_version: '2025-01-01' },
    { api_version: null },
    { type: 'payment_intent.created' },
    { id: null },
  ])('retains authenticated mismatched envelope %j for review', async (patch) => {
    const result = await receipt({ ...fixture(), ...patch });

    expect(result.classification).toBe('review');
    expect(() => assertVerifiedProviderReceipt(result)).not.toThrow();
    expect(result.reviewReasons.length).toBeGreaterThan(0);
  });

  it.each([
    { id: 'pi_foreign' },
    { object: 'charge' },
    { latest_charge: 'ch_foreign' },
    { latest_charge: { id: 'ch_fixture' } },
    { amount_received: -1 },
    { currency: 'CAD' },
    { livemode: true },
    { status: 'processing' },
  ])('retains authenticated object mismatch %j without settlement authority', async (patch) => {
    const event = fixture();
    const result = await receipt({ ...event, data: { object: { ...event.data.object, ...patch } } });

    expect(result.classification).toBe('review');
    expect(result.source).toBe('offline_signed_fixture');
  });

  it('requires explicit object match and correct platform verifier binding', async () => {
    expect((await receipt(fixture(), { ...config, expectedObject: undefined })).reviewReasons).toContain('UNMATCHED_OBJECT');
    await expect(receipt(fixture(), { ...config, platformId: 'acct_foreign' })).rejects.toThrow('SIGNATURE_INVALID');
    await expect(receipt(fixture(), { ...config, endpointId: 'we_foreign' })).rejects.toThrow('SIGNATURE_INVALID');
  });

  it('does not fabricate connected account on platform fee evidence', async () => {
    const event = { ...fixture(), account: undefined, type: 'application_fee.created', data: { object: { id: 'fee_fixture', object: 'application_fee', amount: 100, currency: 'cad', livemode: false, charge: 'ch_fixture', account: 'acct_salon' } } };
    const result = await receipt(event, { ...config, accountScope: 'platform', expectedAccountId: null, expectedObject: { id: 'fee_fixture', type: 'application_fee', amountCents: 100, currency: 'cad', chargeId: 'ch_fixture', connectedAccountId: 'acct_salon' } });

    expect(result).toMatchObject({ classification: 'accepted', accountId: null, normalizedFacts: { connectedAccountId: 'acct_salon' } });
  });

  it('retains signed malformed bytes with an explicit digest identity', async () => {
    const rawBody = new Uint8Array([0xFF, 0x00]);
    const result = await verifyOfflineProviderReceipt({ rawBody, signature: sign(rawBody), receivedAt: now }, config, verifier);

    expect(result).toMatchObject({ classification: 'review', eventId: null, mode: 'unknown', accountId: null });
    expect(result.receiptIdentity).toBe(`digest:${result.payloadDigest}`);
    expect(result.reviewReasons).toContain('MALFORMED_AUTHENTICATED_PAYLOAD');
  });

  it('rejects caller-cast, spread and deserialized authority', async () => {
    const result = await receipt();
    for (const fake of [{}, { ...result }, JSON.parse(JSON.stringify(result))]) {
      expect(() => assertVerifiedProviderReceipt(fake)).toThrow('RECEIPT_UNVERIFIED');
    }
  });

  it('snapshots raw bytes and config across asynchronous verifier completion', async () => {
    const rawBody = bytes(fixture());
    const mutable = structuredClone(config);
    let release!: (accepted: boolean) => void;
    const pending = verifyOfflineProviderReceipt({ rawBody, signature: sign(rawBody), receivedAt: now }, mutable, async (input) => {
      expect(verifier(input)).toBe(true);

      return new Promise<boolean>((resolve) => {
        release = resolve;
      });
    });
    rawBody.fill(0);
    mutable.expectedAccountId = 'acct_changed';
    mutable.expectedObject!.id = 'pi_changed';
    release(true);

    expect(await pending).toMatchObject({ classification: 'accepted', accountId: 'acct_salon', objectId: 'pi_fixture' });
  });

  it.each([['NODE_ENV', 'production'], ['APP_ENV', 'production'], ['VERCEL_ENV', 'production'], ['CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false']])('gates before verification for %s=%s', async (name, value) => {
    vi.stubEnv(name, value);
    const verify = vi.fn(verifier);
    const rawBody = bytes(fixture());

    await expect(verifyOfflineProviderReceipt({ rawBody, signature: sign(rawBody), receivedAt: now }, config, verify)).rejects.toThrow();
    expect(verify).not.toHaveBeenCalled();
  });
});

it('retains insufficient or conflicting money and relationship expectations for review', async () => {
  for (const patch of [{ amountCents: undefined }, { currency: undefined }, { chargeId: undefined }, { amountCents: 1 }, { currency: 'usd' }]) {
    const result = await receipt(fixture(), { ...config, expectedObject: { ...config.expectedObject!, ...patch } });

    expect(result.classification).toBe('review');
  }
});

it('retains cumulative money facts on an unsupported authenticated event without treating them as a refund receipt', async () => {
  const event = fixture();
  const result = await receipt({ ...event, type: 'charge.refunded', data: { object: { id: 'ch_fixture', object: 'charge', livemode: false, amount: 12000, amount_refunded: 5000, currency: 'cad', payment_intent: 'pi_fixture' } } });

  expect(result).toMatchObject({ classification: 'review', normalizedFacts: { objectAmountCents: 12000, amountRefundedCents: 5000, amountCents: null } });
});

it.each(['pi_', 'pi_fixture_secret_PRIVATE', 'pi_fixture_extra'])('never retains invalid or client-secret-shaped object ID %s', async (id) => {
  const event = fixture();
  const result = await receipt({ ...event, data: { object: { ...event.data.object, id } } });

  expect(result.classification).toBe('review');
  expect(result.objectId).toBeNull();
  expect(JSON.stringify(result)).not.toContain(id);
});

it('drops client-secret-shaped relationships and unsupported object IDs', async () => {
  const event = fixture();
  const result = await receipt({ ...event, type: 'unknown.fixture', data: { object: { ...event.data.object, id: 'pi_any_secret_PRIVATE', payment_intent: 'pi_any_secret_PRIVATE', latest_charge: 'ch_' } } });

  expect(result).toMatchObject({ classification: 'review', objectId: null, normalizedFacts: { paymentIntentId: null, chargeId: null } });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
