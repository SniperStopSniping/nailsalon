import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderFixtureConfig } from './evidence';
import { assertVerifiedProviderReceipt, verifyOfflineProviderReceipt } from './evidence';
import { assertVerifiedOfflineRefundProjection, assertVerifiedRefundEvidence, verifyOfflineRefundReceipt } from './refundEvidence';

const receivedAt = new Date('2026-11-08T10:00:00.000Z');
const epoch = Math.floor(receivedAt.getTime() / 1000);
function config(): ProviderFixtureConfig {
  return { endpointId: 'endpoint_fixture', platformId: 'acct_platform', accountScope: 'connected', expectedAccountId: 'acct_connected', apiVersion: '2024-06-20', livemode: false };
}
function event(): any {
  return { object: 'event', id: 'evt_refund1', type: 'refund.updated', api_version: '2024-06-20', livemode: false, account: 'acct_connected', created: epoch - 2, data: { object: { object: 'refund', id: 're_original', status: 'succeeded', charge: 'ch_original', payment_intent: 'pi_original', amount: 3000, currency: 'cad', created: epoch - 100, metadata: { private: 'PRIVATE_VALUE' }, customer_email: 'private@example.invalid' } } };
}
function feeEvent(): any {
  const value = event();
  value.type = 'application_fee.refund.updated';
  delete value.account;
  value.data.object = { object: 'fee_refund', id: 'fr_original', fee: 'fee_original', amount: 25, currency: 'cad', created: epoch - 100 };
  return value;
}
function feeConfig(): ProviderFixtureConfig {
  return { ...config(), accountScope: 'platform', expectedAccountId: null };
}
function input(value: unknown = event()) {
  return { rawBody: new TextEncoder().encode(JSON.stringify(value)), signature: 'offline_signature', receivedAt: new Date(receivedAt) };
}
async function verify(value: unknown = event(), fixed = config()) {
  return verifyOfflineRefundReceipt(input(value), fixed, () => true);
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'true');
});

afterEach(() => vi.unstubAllEnvs());

describe('additive offline refund evidence', () => {
  it('preserves original normalization and exact immutable receipt pairing without private data', async () => {
    const original = await verifyOfflineProviderReceipt(input(), config(), () => true);
    const { receipt, refund } = await verify();

    expect(receipt).toEqual(original);
    expect(refund).toMatchObject({ classification: 'correlatable', movementId: 're_original', outcome: 'succeeded', objectCreated: epoch - 100, eventCreated: epoch - 2 });
    expect(refund.payloadDigest).toBe(createHash('sha256').update(input().rawBody).digest('hex'));
    expect(() => assertVerifiedProviderReceipt(receipt)).not.toThrow();
    expect(() => assertVerifiedOfflineRefundProjection(refund, receipt)).not.toThrow();
    expect(() => assertVerifiedOfflineRefundProjection(refund, original)).toThrow();
    expect(() => assertVerifiedRefundEvidence({ ...refund })).toThrow();
    expect(() => assertVerifiedOfflineRefundProjection(refund, { ...receipt })).toThrow();
    expect(Object.isFrozen(refund)).toBe(true);
    expect(Object.isFrozen(refund.reviewReasons)).toBe(true);
    expect(JSON.stringify({ receipt, refund })).not.toMatch(/PRIVATE_VALUE|private@example|offline_signature/);
  });

  it.each(['pending', 'requires_action', 'succeeded', 'failed', 'canceled'])('retains customer lifecycle %s without promoting it to success', async (status) => {
    const value = event();
    value.data.object.status = status;
    const { refund } = await verify(value);

    expect(refund).toMatchObject({ classification: 'correlatable', status, outcome: status });
  });

  it('retains signed refund.failed while original remains review', async () => {
    const value = event();
    value.type = 'refund.failed';
    value.data.object.status = 'failed';
    const result = await verify(value);

    expect(result.receipt.classification).toBe('review');
    expect(result.refund).toMatchObject({ classification: 'correlatable', outcome: 'failed' });

    value.data.object.status = 'succeeded';

    expect((await verify(value)).refund.classification).toBe('review');
  });

  it('observes platform fee return without generic status or manufactured connected account', async () => {
    const result = await verify(feeEvent(), feeConfig());

    expect(result.refund).toMatchObject({ classification: 'correlatable', kind: 'application_fee_refund', status: null, outcome: 'fee_return_observed', accountId: null, expectedAccountId: null, applicationFeeId: 'fee_original', chargeId: null, paymentIntentId: null });

    const value = feeEvent();
    value.data.object.status = 'succeeded';

    expect((await verify(value, feeConfig())).refund.classification).toBe('review');
  });

  it.each([
    ['id', 're_original_secret_private'],
    ['id', 'fr_wrong'],
    ['id', 're_'],
    ['id', `re_${'a'.repeat(256)}`],
    ['charge', { id: 'ch_expanded' }],
    ['payment_intent', null],
    ['amount', 0],
    ['amount', -1],
    ['amount', 1.5],
    ['amount', 50000001],
    ['currency', 'usd'],
    ['status', 'unknown'],
    ['created', epoch + 1],
    ['created', -1],
    ['livemode', true],
  ])('retains invalid %s as review', async (field, value) => {
    const raw = event();
    raw.data.object[field as string] = value;

    expect((await verify(raw)).refund.classification).toBe('review');
  });

  it('retains unsupported aggregate and malformed signed payload as review', async () => {
    const value = event();
    value.type = 'charge.refunded';
    value.data.object.object = 'charge';

    expect((await verify(value)).refund.classification).toBe('review');
    expect((await verifyOfflineRefundReceipt({ ...input(), rawBody: new TextEncoder().encode('{') }, config(), () => true)).refund.classification).toBe('review');
  });

  it('rejects account, version, envelope mode, event timestamp and expected relationship mismatch', async () => {
    for (const patch of [{ account: 'acct_other' }, { livemode: true }, { api_version: 'other' }, { created: epoch + 1 }]) {
      expect((await verify({ ...event(), ...patch })).refund.classification).toBe('review');
    }

    expect((await verify(event(), feeConfig())).refund.classification).toBe('review');
    expect((await verify(event(), { ...config(), expectedObject: { id: 're_original', type: 'refund', chargeId: 'ch_other' } })).refund.classification).toBe('review');
  });

  it('does not create evidence for invalid signatures and gates before and after await', async () => {
    await expect(verifyOfflineRefundReceipt(input(), config(), () => false)).rejects.toThrow();

    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false');
    const verifier = vi.fn(() => true);

    await expect(verifyOfflineRefundReceipt(input(), config(), verifier)).rejects.toThrow();
    expect(verifier).not.toHaveBeenCalled();

    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'true');

    await expect(verifyOfflineRefundReceipt(input(), config(), async () => {
      vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false');
      return true;
    })).rejects.toThrow();
  });

  it('snapshots original bytes/config/date across asynchronous verification', async () => {
    const request = input();
    const fixed = config();
    const result = await verifyOfflineRefundReceipt(request, fixed, async () => {
      request.rawBody.fill(0);
      request.receivedAt.setTime(0);
      fixed.accountScope = 'platform';
      return true;
    });

    expect(result.refund).toMatchObject({ classification: 'correlatable', movementId: 're_original', accountScope: 'connected', receivedAt: receivedAt.toISOString() });
  });
});
