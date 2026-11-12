import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertVerifiedDisputeEvidence, assertVerifiedOfflineDisputeProjection, verifyOfflineDisputeReceipt } from './disputeEvidence';
import type { ProviderFixtureConfig } from './evidence';
import { assertVerifiedProviderReceipt, verifyOfflineProviderReceipt } from './evidence';

const receivedAt = new Date('2026-11-08T10:00:00.000Z');
const epoch = Math.floor(receivedAt.getTime() / 1000);
function config(): ProviderFixtureConfig {
  return { endpointId: 'endpoint_fixture', platformId: 'acct_platform', accountScope: 'connected', expectedAccountId: 'acct_connected', apiVersion: '2024-06-20', livemode: false };
}
function event(): any {
  return { object: 'event', id: 'evt_dispute1', type: 'charge.dispute.created', api_version: '2024-06-20', livemode: false, account: 'acct_connected', created: epoch - 2, data: { object: { object: 'dispute', id: 'dp_original', livemode: false, status: 'needs_response', charge: 'ch_original', payment_intent: 'pi_original', amount: 3000, currency: 'cad', created: epoch - 100, balance_transactions: [], evidence: { customer_name: 'PRIVATE_VALUE' } } } };
}
function balance(): any {
  return { object: 'balance_transaction', id: 'txn_original', source: 'dp_original', amount: -3000, fee: 1500, net: -4500, currency: 'cad', exchange_rate: null, type: 'adjustment', reporting_category: 'dispute', status: 'available', created: epoch - 50, available_on: epoch - 40, description: 'PRIVATE_VALUE' };
}
function input(value: unknown = event()) {
  return { rawBody: new TextEncoder().encode(JSON.stringify(value)), signature: 'offline_signature', receivedAt: new Date(receivedAt) };
}
async function verify(value: unknown = event(), fixed = config()) {
  return verifyOfflineDisputeReceipt(input(value), fixed, () => true);
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

describe('signed offline dispute supplement', () => {
  it('preserves original review and exact private pairing with no status-inferred money', async () => {
    const original = await verifyOfflineProviderReceipt(input(), config(), () => true);
    const { receipt, dispute } = await verify();

    expect(receipt).toEqual(original);
    expect(receipt.classification).toBe('review');
    expect(dispute).toMatchObject({ classification: 'correlatable', disputeId: 'dp_original', balanceTransactions: [] });
    expect(dispute.payloadDigest).toBe(createHash('sha256').update(input().rawBody).digest('hex'));
    expect(() => assertVerifiedProviderReceipt(receipt)).not.toThrow();
    expect(() => assertVerifiedOfflineDisputeProjection(dispute, receipt)).not.toThrow();
    expect(() => assertVerifiedOfflineDisputeProjection(dispute, original)).toThrow();
    expect(() => assertVerifiedDisputeEvidence({ ...dispute })).toThrow();
    expect(() => assertVerifiedOfflineDisputeProjection(dispute, { ...receipt })).toThrow();
    expect(Object.isFrozen(dispute)).toBe(true);
    expect(Object.isFrozen(dispute.balanceTransactions)).toBe(true);
    expect(JSON.stringify({ receipt, dispute })).not.toMatch(/PRIVATE_VALUE|offline_signature/);
  });

  it.each(['won', 'lost', 'warning_closed', 'warning_needs_response', 'warning_under_review', 'under_review', 'needs_response'])('status %s never manufactures balance movements', async (status) => {
    const value = event();
    value.data.object.status = status;

    expect((await verify(value)).dispute).toMatchObject({ classification: 'correlatable', status, balanceTransactions: [] });
  });

  it.each(['created', 'updated', 'closed', 'funds_withdrawn', 'funds_reinstated'])('supports only signed details for event %s', async (type) => {
    const value = event();
    value.type = `charge.dispute.${type}`;

    expect((await verify(value)).dispute.balanceTransactions).toEqual([]);
  });

  it.each([epoch - 86400, epoch + 86400])('retains availability date %s without imposing occurrence ordering', async (availableOn) => {
    const value = event();
    value.data.object.balance_transactions = [{ ...balance(), available_on: availableOn }];
    const { dispute } = await verify(value);

    expect(dispute.classification).toBe('correlatable');
    expect(dispute.balanceTransactions[0]).toMatchObject({ availableOn, created: epoch - 50, amountCents: -3000, netCents: -4500 });
  });

  it.each(['needs_response', 'under_review', 'warning_needs_response', 'warning_under_review'])('retains closed with nonterminal %s as review', async (status) => {
    const value = event();
    value.type = 'charge.dispute.closed';
    value.data.object.status = status;

    expect((await verify(value)).dispute.classification).toBe('review');
  });

  it.each(['lost', 'won', 'warning_closed'])('accepts closed lifecycle %s without inferred money', async (status) => {
    const value = event();
    value.type = 'charge.dispute.closed';
    value.data.object.status = status;

    expect((await verify(value)).dispute).toMatchObject({ classification: 'correlatable', balanceTransactions: [] });
  });

  it('retains signed withdrawal and reversal including fee and net independently', async () => {
    const value = event();
    const reversal = { ...balance(), id: 'txn_reversal', amount: 3000, fee: -1500, net: 4500, reporting_category: 'dispute_reversal' };
    value.data.object.balance_transactions = [balance(), reversal];
    const { dispute } = await verify(value);

    expect(dispute.classification).toBe('correlatable');
    expect(dispute.balanceTransactions).toHaveLength(2);
    expect(dispute.balanceTransactions[0]).toMatchObject({ id: 'txn_original', sourceId: 'dp_original', amountCents: -3000, feeCents: 1500, netCents: -4500 });
    expect(dispute.balanceTransactions[1]).toMatchObject({ amountCents: 3000, feeCents: -1500, netCents: 4500 });
    expect(Object.isFrozen(dispute.balanceTransactions[0])).toBe(true);
    expect(JSON.stringify(dispute)).not.toContain('PRIVATE_VALUE');
  });

  it.each([
    ['id', 'txn_x_secret_private'],
    ['source', 'dp_other'],
    ['source', { id: 'dp_original' }],
    ['amount', 0],
    ['amount', -1.1],
    ['amount', -50000001],
    ['net', -1],
    ['fee', undefined],
    ['currency', 'usd'],
    ['exchange_rate', 1],
    ['exchange_rate', undefined],
    ['reporting_category', 'charge'],
    ['reporting_category', 'dispute_reversal'],
    ['type', 'charge'],
    ['created', epoch + 1],
    ['created', epoch - 101],
    ['available_on', -1],
    ['status', 'unknown'],
  ])('rejects unsupported balance %s', async (field, v) => {
    const value = event();
    value.data.object.balance_transactions = [{ ...balance(), [field as string]: v }];
    const { dispute } = await verify(value);

    expect(dispute.classification).toBe('review');
    expect(dispute.balanceTransactions).toEqual([]);
  });

  it.each([undefined, null, ['txn_original'], [balance(), balance()], [balance(), balance(), balance()]])('retains missing/unexpanded/duplicate/oversized balance list as review', async (details) => {
    const value = event();
    value.data.object.balance_transactions = details;

    expect((await verify(value)).dispute.classification).toBe('review');
  });

  it.each([['id', 'dp_x_secret_private'], ['charge', null], ['payment_intent', { id: 'pi_original' }], ['status', 'unknown'], ['amount', -1], ['currency', 'usd'], ['created', epoch + 1], ['livemode', true]])('retains malformed dispute %s as review', async (field, v) => {
    const value = event();
    value.data.object[field as string] = v;

    expect((await verify(value)).dispute.classification).toBe('review');
  });

  it('rejects unsupported event, scope, API version and original chronology without discarding receipt', async () => {
    for (const patch of [{ type: 'charge.dispute.unknown' }, { account: 'acct_other' }, { api_version: '2025-01-01' }, { created: epoch + 1 }]) {
      expect((await verify({ ...event(), ...patch })).dispute.classification).toBe('review');
    }

    expect((await verify(event(), { ...config(), accountScope: 'platform', expectedAccountId: null })).dispute.classification).toBe('review');

    const malformed = await verifyOfflineDisputeReceipt({ ...input(), rawBody: new TextEncoder().encode('{') }, config(), () => true);

    expect(malformed.dispute.classification).toBe('review');
  });

  it('gates before and after async verification, invalid signatures produce no evidence', async () => {
    await expect(verifyOfflineDisputeReceipt(input(), config(), () => false)).rejects.toThrow();

    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false');
    const verifier = vi.fn(() => true);

    await expect(verifyOfflineDisputeReceipt(input(), config(), verifier)).rejects.toThrow();
    expect(verifier).not.toHaveBeenCalled();

    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'true');

    await expect(verifyOfflineDisputeReceipt(input(), config(), async () => {
      vi.stubEnv('NODE_ENV', 'production');
      return true;
    })).rejects.toThrow();
  });

  it('retains malformed-money identity edges without private fields or money authority', async () => {
    const value = event();
    value.data.object.balance_transactions = [{ ...balance(), net: 99, description: 'PRIVATE_VALUE', metadata: { private: 'PRIVATE_VALUE' } }];
    const { dispute } = await verify(value);

    expect(dispute).toMatchObject({ classification: 'review', balanceTransactions: [], transactionReferenceCoverage: 'complete', transactionReferences: [{ id: 'txn_original', sourceId: 'dp_original' }] });
    expect(Object.isFrozen(dispute.transactionReferences)).toBe(true);
    expect(Object.isFrozen(dispute.transactionReferences[0])).toBe(true);
    expect(JSON.stringify(dispute)).not.toContain('PRIVATE_VALUE');
  });

  it('retains every edge beyond supported two entries and explicitly bounds overflow', async () => {
    const value = event();
    value.data.object.balance_transactions = Array.from({ length: 3 }, (_, i) => ({ ...balance(), id: `txn_${i}` }));
    const three = (await verify(value)).dispute;

    expect(three).toMatchObject({ classification: 'review', balanceTransactions: [], transactionReferenceCoverage: 'complete' });
    expect(three.transactionReferences).toHaveLength(3);

    value.data.object.balance_transactions = Array.from({ length: 257 }, (_, i) => ({ ...balance(), id: `txn_${i}` }));
    const overflow = (await verify(value)).dispute;

    expect(overflow).toMatchObject({ classification: 'review', balanceTransactions: [], transactionReferenceCoverage: 'overflow' });
    expect(overflow.transactionReferences).toHaveLength(256);
  });

  it('marks unknown identity coverage incomplete while preserving safe remaining edges', async () => {
    const value = event();
    value.data.object.balance_transactions = ['txn_known', { ...balance(), id: 'txn_x_secret_private', source: 'https://private.invalid' }];
    const { dispute } = await verify(value);

    expect(dispute).toMatchObject({ classification: 'review', transactionReferenceCoverage: 'incomplete', transactionReferences: [{ id: 'txn_known', sourceId: null }, { id: null, sourceId: null }] });
    expect(JSON.stringify(dispute)).not.toMatch(/secret_private|private.invalid/);
  });

  it('copies caller bytes, date and config across verification', async () => {
    const request = input();
    const fixed = config();
    const result = await verifyOfflineDisputeReceipt(request, fixed, async () => {
      request.rawBody.fill(0);
      request.receivedAt.setTime(0);
      fixed.accountScope = 'platform';
      return true;
    });

    expect(result.dispute).toMatchObject({ classification: 'correlatable', receivedAt: receivedAt.toISOString(), accountScope: 'connected' });
  });
});
