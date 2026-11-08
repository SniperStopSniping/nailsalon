import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderCorrelationInput } from './correlation';
import { correlateProviderFixture, providerCorrelationFingerprint } from './correlation';
import { verifyOfflineProviderReceipt } from './evidence';
import { beginOperationDispatch, claimOperation, createOfflineOperationTransport, createOperation, createOperationIdentity, observeOperationDispatch } from './operations';
import { verifyOfflineCheckoutSessionReceipt } from './sessionEvidence';

const base = Date.parse('2026-11-08T12:00:00Z');
const quoteId = '00000000-0000-4000-8000-000000000001';
const config = { endpointId: 'we_fixture', platformId: 'acct_platform', accountScope: 'connected' as const, expectedAccountId: 'acct_salon', apiVersion: '2024-06-20', livemode: false as const };
const fixedVerifier = () => true; // Explicit injected offline fixture, never real signature/payment authority.

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
});

afterEach(() => vi.unstubAllEnvs());

async function fixture(feeCents = 100): Promise<ProviderCorrelationInput> {
  const identity = createOperationIdentity({
    id: '00000000-0000-4000-8000-000000000002',
    requestId: '00000000-0000-4000-8000-000000000003',
    salonId: 'salon',
    appointmentId: 'appointment',
    quoteId,
    contextHash: 'a'.repeat(64),
    platformId: 'acct_platform',
    mode: 'test',
    apiVersion: '2024-06-20',
    provenance: 'offline_fixture',
    kind: 'checkout_create',
    accountScope: 'connected',
    accountId: 'acct_salon',
    targetId: null,
    parameters: { mode: 'payment', payment_method_types: ['card'], client_reference_id: quoteId, success_url: 'https://example.test/success', cancel_url: 'https://example.test/cancel', line_items: [{ quantity: 1, price_data: { currency: 'cad', unit_amount: 12000, product_data: { name: 'Appointment payment and optional tip' } } }], payment_intent_data: { application_fee_amount: feeCents } },
  });
  const claim = claimOperation(createOperation(identity, base), { expectedVersion: 0, leaseToken: randomUUID(), leaseDurationMs: 10000, now: base + 1000, purpose: 'dispatch' });
  const dispatch = beginOperationDispatch(claim, { expectedVersion: claim.version, leaseToken: claim.leaseToken!, now: base + 1000 });
  const transport = createOfflineOperationTransport([{ identity, dispatch: { type: 'accepted', objectId: 'cs_test_fixture' }, reconciliation: { type: 'exists', objectId: 'cs_test_fixture' } }]);
  const operation = observeOperationDispatch(dispatch, { expectedVersion: dispatch.version, leaseToken: dispatch.leaseToken!, now: base + 1500, observation: await transport.execute(dispatch, base + 1500) });
  const event = (type: string, object: Record<string, unknown>, platform = false) => ({
    id: `evt_${type.replace(/[._]/g, '')}`,
    object: 'event',
    type,
    api_version: '2024-06-20',
    livemode: false,
    ...(platform ? {} : { account: 'acct_salon' }),
    created: base / 1000 + 3,
    data: { object },
  });
  const input = (value: unknown) => ({ rawBody: new TextEncoder().encode(JSON.stringify(value)), signature: 'offlinefixture', receivedAt: new Date(base + 4000) });
  const session = await verifyOfflineCheckoutSessionReceipt(input(event('checkout.session.completed', {
    id: 'cs_test_fixture',
    object: 'checkout.session',
    livemode: false,
    payment_intent: 'pi_fixture',
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 12000,
    currency: 'cad',
    client_reference_id: quoteId,
    created: base / 1000 + 2,
    expires_at: base / 1000 + 300,
  })), config, fixedVerifier);
  const intent = await verifyOfflineProviderReceipt(input(event('payment_intent.succeeded', {
    id: 'pi_fixture',
    object: 'payment_intent',
    livemode: false,
    status: 'succeeded',
    amount: 12000,
    amount_received: 12000,
    currency: 'cad',
    latest_charge: 'ch_fixture',
  })), config, fixedVerifier);
  const charge = await verifyOfflineProviderReceipt(input(event('charge.succeeded', {
    id: 'ch_fixture',
    object: 'charge',
    livemode: false,
    payment_intent: 'pi_fixture',
    paid: true,
    captured: true,
    amount: 12000,
    amount_captured: 12000,
    amount_refunded: 0,
    currency: 'cad',
    application_fee: feeCents > 0 ? 'fee_fixture' : null,
  })), config, fixedVerifier);
  const fee = await verifyOfflineProviderReceipt(input(event('application_fee.created', {
    id: 'fee_fixture',
    object: 'application_fee',
    livemode: false,
    charge: 'ch_fixture',
    account: 'acct_salon',
    amount: feeCents,
    currency: 'cad',
  }, true)), { ...config, accountScope: 'platform', expectedAccountId: null }, fixedVerifier);
  return {
    operation,
    quote: { id: quoteId, salonId: 'salon', appointmentId: 'appointment', stripeAccountId: 'acct_salon', mode: 'test', fingerprint: 'a'.repeat(64), createdAt: new Date(base), expiresAt: new Date(base + 300000), snapshot: { currency: 'cad', chargeCents: 12000, applicationFeeCents: feeCents } },
    receipts: [{ inboxId: 'session', receipt: session.receipt, hasConflict: false }, { inboxId: 'intent', receipt: intent, hasConflict: false }, { inboxId: 'charge', receipt: charge, hasConflict: false }, ...(feeCents ? [{ inboxId: 'fee', receipt: fee, hasConflict: false }] : [])],
    sessions: [{ inboxId: 'session', session: session.session }],
    now: new Date(base + 5000),
  };
}
function changeReceipt(input: ProviderCorrelationInput, inboxId: string, patch: Record<string, unknown>, facts = false) {
  input.receipts = input.receipts.map(row => row.inboxId === inboxId
    ? { ...row, receipt: facts
        ? { ...row.receipt, normalizedFacts: { ...row.receipt.normalizedFacts, ...patch } as never }
        : { ...row.receipt, ...patch } }
    : row);
}
function permutations<T>(rows: readonly T[]): T[][] {
  return rows.length === 0 ? [[]] : rows.flatMap((row, index) => permutations(rows.filter((_, i) => i !== index)).map(rest => [row, ...rest]));
}

describe('pure fixture capture correlation', () => {
  it('correlates all event orders without mutating inputs or upgrading original review receipts', async () => {
    const input = await fixture();
    const before = structuredClone(input);
    const result = correlateProviderFixture(input);

    expect(result).toMatchObject({ state: 'correlated', financialPostingAllowed: false, captureCandidate: {
      chargeKey: { platformId: 'acct_platform', accountId: 'acct_salon', mode: 'test', chargeId: 'ch_fixture' },
      amountCents: 12000,
      currency: 'cad',
    }, fee: { state: 'matched', feeId: 'fee_fixture' } });

    for (const receipts of permutations(input.receipts)) {
      expect(correlateProviderFixture({ ...input, receipts })).toEqual(result);
    }

    expect(input).toEqual(before);
    expect(input.receipts[0]!.receipt.classification).toBe('review');
    expect(Object.isFrozen(result.captureCandidate?.chargeKey)).toBe(true);
  });

  it('reserves the same charge candidate while fee is delayed; zero fee invents nothing', async () => {
    const input = await fixture();
    const ready = correlateProviderFixture(input);
    input.receipts = input.receipts.filter(row => row.inboxId !== 'fee');
    const pending = correlateProviderFixture(input);

    expect(pending).toMatchObject({ state: 'pending', fee: { state: 'pending' } });
    expect(pending.captureCandidate).toEqual(ready.captureCandidate);
    expect(correlateProviderFixture(await fixture(0))).toMatchObject({ state: 'correlated', fee: { state: 'not_required', feeId: null } });
  });

  it('aliases duplicate business facts across endpoints/events, excluding transport time/digest from candidate identity', async () => {
    const input = await fixture();
    const expected = correlateProviderFixture(input);
    const charge = input.receipts.find(row => row.inboxId === 'charge')!;
    input.receipts = [...input.receipts, { ...charge, inboxId: 'charge2', receipt: { ...charge.receipt, eventId: 'evt_other', receiptIdentity: 'evt_other', endpointId: 'we_other', payloadDigest: 'd'.repeat(64), receivedAt: new Date(base + 10000).toISOString(), normalizedFacts: { ...charge.receipt.normalizedFacts, created: base / 1000 + 4 } } }];

    expect(correlateProviderFixture(input).captureCandidate).toEqual(expected.captureCandidate);
  });

  it.each(['session', 'intent', 'charge'])('keeps missing %s evidence pending', async (missing) => {
    const input = await fixture();
    input.receipts = input.receipts.filter(row => row.inboxId !== missing);
    if (missing === 'session') {
      input.sessions = [];
    }

    expect(correlateProviderFixture(input)).toMatchObject({ state: 'pending', captureCandidate: null });
  });

  it('requires the supplemental raw-digest-bound Session projection, never metadata/client-reference alone', async () => {
    const input = await fixture();

    expect(correlateProviderFixture({ ...input, sessions: [] })).toMatchObject({ state: 'pending', captureCandidate: null });

    input.sessions = [{ ...input.sessions[0]!, session: { ...input.sessions[0]!.session, payloadDigest: 'f'.repeat(64) } }];

    expect(correlateProviderFixture(input).state).toBe('review');
  });

  it.each([
    ['platformId', 'acct_foreign'],
    ['accountId', 'acct_foreign'],
    ['mode', 'live'],
    ['apiVersion', '2025-01-01'],
    ['objectId', 'pi_foreign'],
    ['reviewReasons', ['MODE_MISMATCH']],
    ['classification', 'forged'],
  ])('rejects conflicting intent identity %s', async (field, value) => {
    const input = await fixture();
    changeReceipt(input, 'intent', { [field as string]: value });

    expect(correlateProviderFixture(input).state).toBe('review');
  });

  it.each([
    ['amountCents', 11000],
    ['objectAmountCents', 13000],
    ['currency', 'usd'],
    ['paymentIntentId', 'pi_foreign'],
    ['paid', false],
    ['captured', false],
    ['amountRefundedCents', 1],
  ])('rejects charge contradiction %s', async (field, value) => {
    const input = await fixture();
    changeReceipt(input, 'charge', { [field as string]: value }, true);

    expect(correlateProviderFixture(input)).toMatchObject({ state: 'review', captureCandidate: null });
  });

  it('never latest-wins conflicting duplicate captures or session ownership', async () => {
    const input = await fixture();
    const charge = input.receipts.find(row => row.inboxId === 'charge')!;
    input.receipts = [...input.receipts, { ...charge, inboxId: 'contradiction', receipt: { ...charge.receipt, normalizedFacts: { ...charge.receipt.normalizedFacts, amountCents: 1 } } }];
    for (const receipts of [input.receipts, [...input.receipts].reverse()]) {
      expect(correlateProviderFixture({ ...input, receipts }).state).toBe('review');
    }
  });

  it('keeps gross candidate held on foreign fee facts without claiming actual fee agreement', async () => {
    const input = await fixture();
    changeReceipt(input, 'fee', { connectedAccountId: 'acct_foreign' }, true);

    expect(correlateProviderFixture(input)).toMatchObject({ state: 'review', captureCandidate: { amountCents: 12000 }, fee: { state: 'review' } });
  });

  it('distinguishes late delivery from late or expiry-ambiguous money', async () => {
    const input = await fixture();
    input.now = new Date(base + 400000);

    expect(correlateProviderFixture(input).state).toBe('correlated');

    changeReceipt(input, 'charge', { receivedAt: input.now.toISOString() });
    changeReceipt(input, 'charge', { created: base / 1000 + 300 }, true);

    expect(correlateProviderFixture(input).state).toBe('review');

    const ambiguous = await fixture();
    ambiguous.quote.expiresAt = new Date(base + 3999);

    expect(correlateProviderFixture(ambiguous).state).toBe('review');
  });

  it('rejects stale quotes, operation mismatches, transport conflicts and unsupported refund/dispute evidence', async () => {
    for (const change of ['quote', 'dispatch', 'inbox', 'refund', 'dispute']) {
      const input = await fixture();
      if (change === 'quote') {
        input.quote.fingerprint = 'b'.repeat(64);
      }
      if (change === 'dispatch') {
        input.quote.expiresAt = new Date(base + 500);
      }
      if (change === 'inbox') {
        input.receipts = input.receipts.map(row => ({ ...row, hasConflict: true }));
      }
      if (change === 'refund' || change === 'dispute') {
        changeReceipt(input, 'charge', { eventType: change === 'refund' ? 'charge.refunded' : 'charge.dispute.created' });
      }

      expect(correlateProviderFixture(input).state).toBe('review');
    }
  });

  it('fingerprints canonical facts deterministically and rejects lossy values', () => {
    expect(providerCorrelationFingerprint({ a: 1, b: 2 })).toBe(providerCorrelationFingerprint({ b: 2, a: 1 }));
    expect(() => providerCorrelationFingerprint({ missing: undefined })).toThrow();
    expect(() => providerCorrelationFingerprint(new Date())).toThrow();
  });
});

it('handles earlier unpaid then paid evidence independent of arrival order, but holds later or ambiguous unpaid facts', async () => {
  for (const offset of [2, 3, 4]) {
    const input = await fixture();
    const paid = input.sessions[0]!;
    const original = input.receipts[0]!;
    const receipt = { ...original.receipt, eventId: 'evt_unpaid', receiptIdentity: 'evt_unpaid', payloadDigest: 'e'.repeat(64), normalizedFacts: { ...original.receipt.normalizedFacts, created: base / 1000 + offset } };
    const session = { ...paid.session, eventId: receipt.eventId, receiptIdentity: receipt.receiptIdentity, payloadDigest: receipt.payloadDigest, eventCreated: base / 1000 + offset, paymentStatus: 'unpaid' as const };
    input.receipts = [...input.receipts, { ...original, inboxId: 'unpaid', receipt }];
    input.sessions = [...input.sessions, { inboxId: 'unpaid', session }];

    expect(correlateProviderFixture(input).state).toBe(offset < 3 ? 'correlated' : 'review');
    expect(correlateProviderFixture({ ...input, receipts: [...input.receipts].reverse(), sessions: [...input.sessions].reverse() }).state).toBe(offset < 3 ? 'correlated' : 'review');
  }
});

it('keeps unproven unpaid completion pending and expired or failed sessions held', async () => {
  for (const state of ['unpaid', 'expired', 'failed']) {
    const input = await fixture();
    const eventType = state === 'expired' ? 'checkout.session.expired' : state === 'failed' ? 'checkout.session.async_payment_failed' : 'checkout.session.completed';
    changeReceipt(input, 'session', { eventType });
    input.sessions = [{ ...input.sessions[0]!, session: { ...input.sessions[0]!.session, eventType, paymentStatus: 'unpaid', status: state === 'expired' ? 'expired' : 'complete' } }];

    expect(correlateProviderFixture(input)).toMatchObject({ state: state === 'unpaid' ? 'pending' : 'review', captureCandidate: null });
  }
});

it('allows later supplement verification without using later arrival to rescue future evidence', async () => {
  const input = await fixture();
  input.sessions = [{ ...input.sessions[0]!, session: { ...input.sessions[0]!.session, receivedAt: new Date(base + 10000).toISOString() } }];

  expect(correlateProviderFixture(input).state).toBe('correlated');

  changeReceipt(input, 'session', { receivedAt: new Date(base + 2000).toISOString() });

  expect(correlateProviderFixture(input).state).toBe('review');
});

it('cannot correlate metadata/reference-only ownership with another successful operation session', async () => {
  const input = await fixture();
  input.operation = { ...input.operation, result: { provenance: 'offline_fixture', objectId: 'cs_test_foreign' } };

  expect(correlateProviderFixture(input)).toMatchObject({ state: 'review', captureCandidate: null });
});

it.each(['objectAmountCents', 'amountReceivedCents'])('rejects intent monetary inconsistency %s', async (field) => {
  const input = await fixture();
  changeReceipt(input, 'intent', { [field]: 13000 }, true);

  expect(correlateProviderFixture(input)).toMatchObject({ state: 'review', captureCandidate: null });
});
