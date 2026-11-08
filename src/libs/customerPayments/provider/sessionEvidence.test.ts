import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderFixtureConfig } from './evidence';
import { assertVerifiedProviderReceipt, verifyOfflineProviderReceipt } from './evidence';
import { assertVerifiedCheckoutSessionEvidence, assertVerifiedOfflineSessionProjection, verifyOfflineCheckoutSessionReceipt } from './sessionEvidence';

const receivedAt = new Date('2026-11-08T10:00:00.000Z');
const epoch = Math.floor(receivedAt.getTime() / 1000);
function config(): ProviderFixtureConfig {
  return { endpointId: 'endpoint_fixture', platformId: 'acct_platform', accountScope: 'connected', expectedAccountId: 'acct_connected', apiVersion: '2024-06-20', livemode: false };
}
function event() {
  return { object: 'event', id: 'evt_session1', type: 'checkout.session.completed', api_version: '2024-06-20', livemode: false, account: 'acct_connected', created: epoch - 2, data: { object: { object: 'checkout.session', id: 'cs_test_abc123', livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid', payment_intent: 'pi_original', amount_total: 12000, currency: 'cad', client_reference_id: '61b5393c-59ab-4ef1-987b-0dd6a3110827', created: epoch - 100, expires_at: epoch + 3600, customer_email: 'private@example.invalid', customer_details: { name: 'Private Person' }, client_secret: 'do_not_retain', url: 'https://private.invalid/secret', metadata: { paid: true, private: 'PRIVATE_VALUE' } } } };
}
function input(value: unknown = event()) {
  return { rawBody: new TextEncoder().encode(JSON.stringify(value)), signature: 'offline_signature', receivedAt: new Date(receivedAt) };
}
async function verify(value: unknown = event(), fixed = config()) {
  return verifyOfflineCheckoutSessionReceipt(input(value), fixed, () => true);
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

describe('additive offline Session proof', () => {
  it('keeps exact original normalization/review and binds a separate immutable projection', async () => {
    const original = await verifyOfflineProviderReceipt(input(), config(), () => true);
    const result = await verify();

    expect(result.receipt).toEqual(original);
    expect(result.receipt.classification).toBe('review');
    expect(result.session).toMatchObject({ version: 1, projectionVersion: 1, source: 'offline_signed_fixture_session', classification: 'correlatable', sessionId: 'cs_test_abc123', paymentIntentId: 'pi_original', amountTotalCents: 12000, currency: 'cad', clientReferenceId: '61b5393c-59ab-4ef1-987b-0dd6a3110827', eventId: 'evt_session1', mode: 'test' });
    expect(result.session.payloadDigest).toBe(createHash('sha256').update(input().rawBody).digest('hex'));
    expect(() => assertVerifiedProviderReceipt(result.receipt)).not.toThrow();
    expect(() => assertVerifiedOfflineSessionProjection(result.session, result.receipt)).not.toThrow();
    expect(() => assertVerifiedOfflineSessionProjection(result.session, original)).toThrow('UNVERIFIED');
    expect(() => assertVerifiedCheckoutSessionEvidence({ ...result.session })).toThrow('UNVERIFIED');
    expect(() => assertVerifiedOfflineSessionProjection(result.session, { ...result.receipt })).toThrow('UNVERIFIED');
    expect(Object.isFrozen(result.session)).toBe(true);
    expect(Object.isFrozen(result.session.reviewReasons)).toBe(true);

    const serialized = JSON.stringify(result);
    for (const privateValue of ['private@example.invalid', 'Private Person', 'do_not_retain', 'private.invalid', 'PRIVATE_VALUE', 'offline_signature']) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it.each(['cs_test_', 'cs_live_', 'cs_test_abc_secret_xyz', 'cs_test_abc_def', 'cs_abc', 'cs_test_abc?secret=x', `cs_test_${'x'.repeat(255)}`])('retains invalid Session ID %s only as review without secret-shaped ID', async (sessionId) => {
    const value = event();
    value.data.object.id = sessionId;
    const result = await verify(value);

    expect(result.session.sessionId).toBeNull();
    expect(result.session.classification).toBe('review');
  });

  it('retains a safe live-form ID for review rather than treating it as test evidence', async () => {
    const value = event();
    value.data.object.id = 'cs_live_abc123';
    const result = await verify(value);

    expect(result.session.sessionId).toBe('cs_live_abc123');
    expect(result.session.reviewReasons).toContain('SESSION_MODE_MISMATCH');
  });

  it.each([
    { payment_intent: 'pi_secret_bad' },
    { payment_intent: { id: 'pi_expanded' } },
    { client_reference_id: 'quote_PrivateName' },
    { client_reference_id: 'private@example.invalid' },
    { client_reference_id: 'https://secret.invalid' },
    { client_reference_id: 'quote_abc_secret_xyz' },
    { client_reference_id: '4165551234' },
    { amount_total: -1 },
    { amount_total: 50_000_001 },
    { amount_total: 1.5 },
    { currency: 'usd' },
    { created: epoch + 1 },
    { expires_at: epoch + 86401 },
    { expires_at: -1 },
    { expires_at: Number.MAX_SAFE_INTEGER },
    { livemode: true },
    { livemode: undefined },
    { mode: 'setup' },
    { status: 'open' },
  ])('retains unsupported Session facts %j as review', async (patch) => {
    const value = event();
    const result = await verify({ ...value, data: { object: { ...value.data.object, ...patch } } });

    expect(result.session.classification).toBe('review');
  });

  it('leaves valid unpaid completion structurally correlatable for graph-level pending handling', async () => {
    const value = event();
    value.data.object.payment_status = 'unpaid';
    const result = await verify(value);

    expect(result.session.classification).toBe('correlatable');
    expect(result.session.paymentStatus).toBe('unpaid');
    expect(result.receipt.classification).toBe('review');

    value.type = 'checkout.session.async_payment_succeeded';

    expect((await verify(value)).session.reviewReasons).toContain('SESSION_STATE_REVIEW_REQUIRED');
  });

  it.each([{ account: 'acct_wrong' }, { account: undefined }, { livemode: true }, { api_version: '2025-01-01' }, { created: epoch + 1 }, { id: 'evt_secret_bad' }])('preserves signed scope/envelope mismatches %j for review', async (patch) => {
    expect((await verify({ ...event(), ...patch })).session.classification).toBe('review');
  });

  it('rejects platform scope and mismatched explicit expectations', async () => {
    expect((await verify(event(), { ...config(), accountScope: 'platform', expectedAccountId: null })).session.classification).toBe('review');
    expect((await verify(event(), { ...config(), expectedObject: { id: 'cs_test_other', type: 'checkout.session' } })).session.reviewReasons).toContain('SESSION_EXPECTATION_MISMATCH');
  });

  it('snapshots caller/verifier mutable bytes, config and date before awaiting', async () => {
    const mutable = input();
    const fixed = config();
    const digest = createHash('sha256').update(mutable.rawBody).digest('hex');
    const result = await verifyOfflineCheckoutSessionReceipt(mutable, fixed, async ({ rawBody }) => {
      mutable.rawBody.fill(0);
      rawBody.fill(1);
      fixed.expectedAccountId = 'acct_wrong';
      mutable.receivedAt.setFullYear(2000);
      await Promise.resolve();
      return true;
    });

    expect(result.session.payloadDigest).toBe(digest);
    expect(result.session.expectedAccountId).toBe('acct_connected');
    expect(result.session.receivedAt).toBe(receivedAt.toISOString());
    expect(result.session.classification).toBe('correlatable');
  });

  it('returns retained review for authenticated malformed bytes, not unverified facts', async () => {
    const result = await verifyOfflineCheckoutSessionReceipt({ ...input(), rawBody: Uint8Array.of(0xFF, 0xFE) }, config(), () => true);

    expect(result.receipt.classification).toBe('review');
    expect(result.session.classification).toBe('review');
    expect(result.session.sessionId).toBeNull();
    expect(() => assertVerifiedOfflineSessionProjection(result.session, result.receipt)).not.toThrow();
  });

  it('invalid signatures yield no evidence and verifier secrets never escape', async () => {
    await expect(verifyOfflineCheckoutSessionReceipt(input(), config(), () => false)).rejects.toThrow('SIGNATURE_INVALID');
    await expect(verifyOfflineCheckoutSessionReceipt(input(), config(), () => {
      throw new Error('SECRET_EXCEPTION');
    })).rejects.toThrow('SIGNATURE_INVALID');
  });

  it('checks the fixture gate before and after async verification', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const verifier = vi.fn(() => true);

    await expect(verifyOfflineCheckoutSessionReceipt(input(), config(), verifier)).rejects.toThrow('FIXTURE_DISABLED');
    expect(verifier).not.toHaveBeenCalled();

    vi.stubEnv('NODE_ENV', 'test');

    await expect(verifyOfflineCheckoutSessionReceipt(input(), config(), async () => {
      vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false');
      return true;
    })).rejects.toThrow('FIXTURE_DISABLED');
  });
});
