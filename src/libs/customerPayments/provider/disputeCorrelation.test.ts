import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderCorrelationInput } from './correlation';
import { correlateProviderFixture } from './correlation';
import type { ProviderDisputeCorrelationInput } from './disputeCorrelation';
import { correlateProviderDisputeFixture } from './disputeCorrelation';
import { verifyOfflineDisputeReceipt } from './disputeEvidence';
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

function transaction(reversal = false, overrides: Record<string, unknown> = {}) {
  return { id: reversal ? 'txn_reversal' : 'txn_withdrawal', object: 'balance_transaction', source: 'dp_fixture', amount: reversal ? 3000 : -3000, fee: reversal ? -150 : 150, net: reversal ? 3150 : -3150, currency: 'cad', exchange_rate: null, created: base / 1000 + (reversal ? 20 : 11), available_on: base / 1000 + 30, status: 'available', type: 'adjustment', reporting_category: reversal ? 'dispute_reversal' : 'dispute', ...overrides };
}
async function dispute(overrides: Record<string, unknown> = {}, eventCreated = base / 1000 + 25, type = 'charge.dispute.updated') {
  const event = { id: `evt_${randomUUID().replaceAll('-', '')}`, object: 'event', type, api_version: config.apiVersion, livemode: false, account: config.expectedAccountId, created: eventCreated, data: { object: { id: 'dp_fixture', object: 'dispute', livemode: false, amount: 3000, currency: 'cad', created: base / 1000 + 10, status: 'under_review', charge: 'ch_fixture', payment_intent: 'pi_fixture', balance_transactions: [transaction()], ...overrides } } };
  const verified = await verifyOfflineDisputeReceipt({ rawBody: new TextEncoder().encode(JSON.stringify(event)), signature: 'offlinefixture', receivedAt: new Date((eventCreated + 2) * 1000) }, config, fixedVerifier);
  return { inboxId: event.id, ...verified, hasConflict: false };
}
async function disputeFixture(overrides: Record<string, unknown> = {}): Promise<ProviderDisputeCorrelationInput> {
  const parent = await fixture();
  const d = await dispute(overrides);
  parent.receipts = [...parent.receipts, d];
  return { parent, disputes: [d], ownershipConflict: false };
}
function add(input: ProviderDisputeCorrelationInput, d: Awaited<ReturnType<typeof dispute>>) {
  input.disputes = [...input.disputes, d];
  input.parent.receipts = [...input.parent.receipts, d];
}

describe('offline dispute correlation', () => {
  it('proves withdrawal independently of lifecycle while preserving original capture hold', async () => {
    const input = await disputeFixture();
    const before = JSON.stringify(input);

    expect(correlateProviderFixture(input.parent).state).toBe('review');
    expect(correlateProviderDisputeFixture(input)).toMatchObject({ state: 'correlated', financialPostingAllowed: false, disputeCandidate: { status: 'under_review', amountCents: 3000 }, totals: { withdrawnCents: 3000, reinstatedCents: 0, feeCents: 150, netCents: -3150 } });
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(['needs_response', 'under_review', 'won', 'lost', 'warning_closed'])('never infers cash from %s with empty transactions', async (status) => {
    const result = correlateProviderDisputeFixture(await disputeFixture({ status, balance_transactions: [] }));

    expect(result).toMatchObject({ state: 'pending', totals: null, balanceCandidates: [] });
  });

  it('deduplicates event aliases and chronologically advances status independent arrival', async () => {
    const input = await disputeFixture();
    add(input, await dispute());
    add(input, await dispute({ status: 'won', balance_transactions: [transaction(), transaction(true)] }, base / 1000 + 30, 'charge.dispute.closed'));
    const result = correlateProviderDisputeFixture(input);

    expect(result).toMatchObject({ state: 'correlated', disputeCandidate: { status: 'won' }, totals: { withdrawnCents: 3000, reinstatedCents: 3000, netCents: 0, feeCents: 0 } });
    expect(result.balanceCandidates).toHaveLength(2);

    for (const disputes of permutations(input.disputes)) {
      expect(correlateProviderDisputeFixture({ ...input, disputes })).toEqual(result);
    }
  });

  it.each(['lost', 'under_review', 'warning_closed'])('retains contradiction after won (%s)', async (status) => {
    const input = await disputeFixture({ status: 'won' });
    add(input, await dispute({ status }, base / 1000 + 30));

    expect(correlateProviderDisputeFixture(input).state).toBe('review');
  });

  it('same-second different lifecycle is ambiguous, not latest-wins', async () => {
    const input = await disputeFixture();
    add(input, await dispute({ status: 'won' }));

    expect(correlateProviderDisputeFixture(input)).toMatchObject({ state: 'review', reasons: ['DISPUTE_LIFECYCLE_CONFLICT'] });
  });

  it.each([10, 11])('rejects reversal before/ambiguous with withdrawal (%s)', async (created) => {
    const input = await disputeFixture({ balance_transactions: [transaction(), transaction(true, { created: base / 1000 + created })] });

    expect(correlateProviderDisputeFixture(input).state).toBe('review');
  });

  it('holds reversal without withdrawal and excessive cumulative withdrawal', async () => {
    expect(correlateProviderDisputeFixture(await disputeFixture({ balance_transactions: [transaction(true)] })).state).toBe('review');
    expect(correlateProviderDisputeFixture(await disputeFixture({ balance_transactions: [transaction(), transaction(false, { id: 'txn_other' })] })).state).toBe('review');
  });

  it('holds same transaction ID with changed immutable facts', async () => {
    const input = await disputeFixture();
    add(input, await dispute({ balance_transactions: [transaction(false, { fee: 200, net: -3200 })] }));

    expect(correlateProviderDisputeFixture(input)).toMatchObject({ state: 'review', reasons: ['DISPUTE_BALANCE_IDENTITY_CONFLICT'] });
  });

  it.each([{ charge: 'ch_other' }, { payment_intent: 'pi_other' }, { currency: 'usd' }, { amount: 13000 }, { id: 'dp_other' }])('rejects wrong parent/identity %j', async (patch) => {
    const input = await disputeFixture();
    add(input, await dispute(patch));

    expect(correlateProviderDisputeFixture(input).state).toBe('review');
  });

  it('does not partition refund/aggregate evidence or hide original capture money contradiction', async () => {
    const input = await disputeFixture();
    changeReceipt(input.parent, 'charge', { amountRefundedCents: 1 }, true);

    expect(correlateProviderDisputeFixture(input).state).toBe('review');

    const original = await disputeFixture();
    const charge = original.parent.receipts.find(r => r.inboxId === 'charge')!;
    original.parent.receipts = [...original.parent.receipts, { ...charge, inboxId: 'aggregate', receipt: { ...charge.receipt, eventType: 'charge.refunded' } }];

    expect(correlateProviderDisputeFixture(original).state).toBe('review');
  });

  it('missing supplement remains unknown but cannot hide known foreign PI', async () => {
    const input = await disputeFixture();
    input.disputes = [{ ...input.disputes[0]!, dispute: null }];

    expect(correlateProviderDisputeFixture(input)).toMatchObject({ state: 'pending', totals: null });

    const foreign = { ...await dispute({ payment_intent: 'pi_other' }), dispute: null };
    input.parent.receipts = [...input.parent.receipts, foreign];
    input.disputes = [...input.disputes, foreign];
    for (const disputes of permutations(input.disputes)) {
      expect(correlateProviderDisputeFixture({ ...input, disputes }).state).toBe('review');
    }
  });

  it('keeps inquiry with balance cash and missing/forged closure under review', async () => {
    expect(correlateProviderDisputeFixture(await disputeFixture({ status: 'warning_under_review' })).state).toBe('review');

    const input = await disputeFixture();

    expect(correlateProviderDisputeFixture({ ...input, disputes: [] }).state).toBe('review');
    expect(correlateProviderDisputeFixture({ ...input, ownershipConflict: true }).state).toBe('review');
    expect(correlateProviderDisputeFixture({ ...input, disputes: [{ ...input.disputes[0]!, dispute: { ...input.disputes[0]!.dispute!, payloadDigest: 'b'.repeat(64) } }] }).state).toBe('review');
  });
});

it('mutable balance availability does not change immutable movement identity', async () => {
  const input = await disputeFixture({ balance_transactions: [transaction(false, { status: 'pending' })] });
  const initial = correlateProviderDisputeFixture(input);
  add(input, await dispute({ balance_transactions: [transaction(false, { status: 'available', available_on: base / 1000 + 40 })] }, base / 1000 + 30));
  const final = correlateProviderDisputeFixture(input);

  expect(final.state).toBe('correlated');
  expect(final.balanceCandidates).toEqual(initial.balanceCandidates);
  expect(final.disputeCandidate?.fingerprint).toBe(initial.disputeCandidate?.fingerprint);
});

it.each(['platformId', 'accountId', 'mode', 'apiVersion'])('known %s mismatch stays review even without supplement or complete parent', async (field) => {
  const input = await disputeFixture();
  const original = input.disputes[0]!;
  const bad = { ...original, receipt: { ...original.receipt, [field]: field === 'mode' ? 'live' : 'different' } as typeof original.receipt, dispute: null };
  input.disputes = [bad];
  input.parent.receipts = [...input.parent.receipts.filter(r => r.inboxId !== original.inboxId && r.inboxId !== 'charge'), bad];

  expect(correlateProviderDisputeFixture(input)).toMatchObject({ state: 'review', totals: null });
});

it('does not rescue event time through later supplemental verification or quote expiry', async () => {
  const input = await disputeFixture();
  input.parent.now = new Date(base + 86400000);

  expect(correlateProviderDisputeFixture(input).state).toBe('correlated');

  const original = input.disputes[0]!;
  const future = { ...original, receipt: { ...original.receipt, receivedAt: new Date(base + 20000).toISOString() }, dispute: { ...original.dispute!, receivedAt: new Date(base + 86400000).toISOString() } };
  input.disputes = [future];
  input.parent.receipts = input.parent.receipts.map(r => r.inboxId === original.inboxId ? future : r);

  expect(correlateProviderDisputeFixture(input).state).toBe('review');
});

it('availability timestamp ordering never creates or rejects a cash movement', async () => {
  const input = await disputeFixture({ balance_transactions: [transaction(false, { available_on: base / 1000 })] });

  expect(correlateProviderDisputeFixture(input).state).toBe('correlated');
});

it('persisted nonterminal closed event cannot correlate even if supplemental classification is forged', async () => {
  const input = await disputeFixture();
  const original = input.disputes[0]!;
  const changed = { ...original, receipt: { ...original.receipt, eventType: 'charge.dispute.closed' }, dispute: { ...original.dispute!, eventType: 'charge.dispute.closed' } };
  input.disputes = [changed];
  input.parent.receipts = input.parent.receipts.map(r => r.inboxId === original.inboxId ? changed : r);

  expect(correlateProviderDisputeFixture(input).state).toBe('review');
});

it.each(['incomplete', 'overflow'])('incomplete transaction reference coverage %s cannot become money proof', async (coverage) => {
  const input = await disputeFixture();
  input.disputes = [{ ...input.disputes[0]!, dispute: { ...input.disputes[0]!.dispute!, transactionReferenceCoverage: coverage as 'incomplete' | 'overflow' } }];

  expect(correlateProviderDisputeFixture(input).state).toBe('review');
});

it('missing supplemental evidence cannot hide known excessive withdrawals in either arrival order', async () => {
  const input = await disputeFixture();
  add(input, await dispute({ balance_transactions: [transaction(false, { id: 'txn_other' })] }));
  const missing = { ...await dispute(), dispute: null };
  input.disputes = [...input.disputes, missing];
  input.parent.receipts = [...input.parent.receipts, missing];
  for (const disputes of permutations(input.disputes)) {
    expect(correlateProviderDisputeFixture({ ...input, disputes })).toMatchObject({ state: 'review', totals: null, reasons: ['DISPUTE_BALANCE_BOUND_EXCEEDED'] });
  }
});
