import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderCorrelationInput } from './correlation';
import { correlateProviderFixture } from './correlation';
import { verifyOfflineProviderReceipt } from './evidence';
import { beginOperationDispatch, claimOperation, createOfflineOperationTransport, createOperation, createOperationIdentity, observeOperationDispatch } from './operations';
import type { ProviderRefundCorrelationInput } from './refundCorrelation';
import { correlateProviderRefundFixture } from './refundCorrelation';
import { verifyOfflineRefundReceipt } from './refundEvidence';
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

async function movement(fee = false, overrides: Record<string, unknown> = {}, eventCreated = base / 1000 + 12, type?: string) {
  const event = { id: `evt_${randomUUID().replaceAll('-', '')}`, object: 'event', type: type ?? (fee ? 'application_fee.refund.updated' : 'refund.updated'), api_version: config.apiVersion, livemode: false, ...(fee ? {} : { account: config.expectedAccountId }), created: eventCreated, data: { object: { id: fee ? 'fr_fixture' : 're_fixture', object: fee ? 'fee_refund' : 'refund', amount: fee ? 40 : 3000, currency: 'cad', created: base / 1000 + 11, ...(fee ? { fee: 'fee_fixture' } : { livemode: false, status: 'succeeded', payment_intent: 'pi_fixture', charge: 'ch_fixture' }), ...overrides } } };
  const verified = await verifyOfflineRefundReceipt({ rawBody: new TextEncoder().encode(JSON.stringify(event)), signature: 'offlinefixture', receivedAt: new Date(Math.max(base + 20000, (eventCreated + 1) * 1000)) }, fee ? { ...config, accountScope: 'platform', expectedAccountId: null } : config, fixedVerifier);
  return { inboxId: event.id, ...verified, hasConflict: false };
}
async function refundFixture(fee = false): Promise<ProviderRefundCorrelationInput> {
  const parent = await fixture();
  const { parameterHash: _hash, idempotencyKey: _key, ...common } = parent.operation.identity;
  const identity = createOperationIdentity({ ...common, id: randomUUID(), requestId: randomUUID(), ...(fee
    ? { kind: 'application_fee_refund' as const, accountScope: 'platform' as const, accountId: null, targetId: 'fee_fixture', parameters: { amount: 40 } }
    : { kind: 'customer_refund' as const, accountScope: 'connected' as const, accountId: 'acct_salon', targetId: 'pi_fixture', parameters: { payment_intent: 'pi_fixture', amount: 3000 } }) });
  const claim = claimOperation(createOperation(identity, base + 9000), { expectedVersion: 0, leaseToken: randomUUID(), leaseDurationMs: 10000, now: base + 10000, purpose: 'dispatch' });
  const dispatch = beginOperationDispatch(claim, { expectedVersion: claim.version, leaseToken: claim.leaseToken!, now: base + 10000 });
  const objectId = fee ? 'fr_fixture' : 're_fixture';
  const transport = createOfflineOperationTransport([{ identity, dispatch: { type: 'accepted', objectId }, reconciliation: { type: 'exists', objectId } }]);
  const operation = observeOperationDispatch(dispatch, { expectedVersion: dispatch.version, leaseToken: dispatch.leaseToken!, now: base + 11000, observation: await transport.execute(dispatch, base + 11000) });
  const m = await movement(fee);
  parent.receipts = [...parent.receipts, m];
  parent.now = new Date(base + 20000);
  return { parent, operation, movements: [m], ownershipConflict: false };
}
function add(input: ProviderRefundCorrelationInput, m: Awaited<ReturnType<typeof movement>>) {
  input.movements = [...input.movements, m];
  input.parent.receipts = [...input.parent.receipts, m];
}

describe('offline refund correlation', () => {
  it.each([false, true])('correlates exact successful movement, fee=%s, without altering original capture hold', async (fee) => {
    const input = await refundFixture(fee);
    const before = JSON.stringify(input);

    expect(correlateProviderFixture(input.parent).state).toBe('review');
    expect(correlateProviderRefundFixture(input)).toMatchObject({ state: 'correlated', financialPostingAllowed: false, candidate: { kind: fee ? 'application_fee_refund' : 'customer_refund', amountCents: fee ? 40 : 3000 }, totals: { customerRefundCents: fee ? 0 : 3000, applicationFeeRefundCents: fee ? 40 : 0 } });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('deduplicates successful movements across transports and event order', async () => {
    const input = await refundFixture();
    add(input, await movement());
    add(input, await movement(true));
    const baseline = correlateProviderRefundFixture(input);
    for (const movements of permutations(input.movements)) {
      expect(correlateProviderRefundFixture({ ...input, movements })).toEqual(baseline);
    }

    expect(baseline).toMatchObject({ state: 'correlated', totals: { customerRefundCents: 3000, applicationFeeRefundCents: 40 } });
  });

  it.each(['pending', 'failed', 'canceled', 'requires_action'])('never treats %s refund as success', async (status) => {
    const input = await refundFixture();
    const m = await movement(false, { status });
    input.parent.receipts = [...input.parent.receipts.filter(r => !input.movements.some(v => v.inboxId === r.inboxId)), m];
    input.movements = [m];

    expect(correlateProviderRefundFixture(input).state).toBe(status === 'pending' ? 'pending' : 'review');
  });

  it.each([11, 12, 13])('allows only strictly earlier pending history (%s)', async (created) => {
    const input = await refundFixture();
    add(input, await movement(false, { status: 'pending' }, base / 1000 + created));

    expect(correlateProviderRefundFixture(input).state).toBe(created < 12 ? 'correlated' : 'review');
  });

  it.each([false, true])('counts distinct unclaimed siblings and rejects cumulative overflow fee=%s', async (fee) => {
    const input = await refundFixture(fee);
    add(input, await movement(fee, { id: fee ? 'fr_other' : 're_other', amount: fee ? 70 : 10000 }));

    expect(correlateProviderRefundFixture(input)).toMatchObject({ state: 'review', reasons: ['CUMULATIVE_REFUND_EXCEEDS_PARENT'] });
  });

  it.each(['amount', 'charge', 'payment_intent', 'currency'])('holds contradictory movement %s', async (field) => {
    const input = await refundFixture();
    add(input, await movement(false, { [field]: field === 'amount' ? 2000 : field === 'currency' ? 'usd' : `${field === 'charge' ? 'ch' : 'pi'}_other` }));

    expect(correlateProviderRefundFixture(input).state).toBe('review');
  });

  it.each(['amountRefundedCents', 'amountCents'])('does not hide current parent capture contradiction %s', async (field) => {
    const input = await refundFixture();
    changeReceipt(input.parent, 'charge', { [field]: 1 }, true);

    expect(correlateProviderRefundFixture(input)).toMatchObject({ state: 'review', reasons: ['PARENT_CAPTURE_UNPROVEN'] });
  });

  it('does not hide charge.refunded aggregate or unknown events', async () => {
    const input = await refundFixture();
    const charge = input.parent.receipts.find(r => r.inboxId === 'charge')!;
    input.parent.receipts = [...input.parent.receipts, { ...charge, inboxId: 'aggregate', receipt: { ...charge.receipt, eventType: 'charge.refunded' } }];

    expect(correlateProviderRefundFixture(input).state).toBe('review');
  });

  it('rejects missing closure, conflicting ownership, and forged supplement digest', async () => {
    const input = await refundFixture();

    expect(correlateProviderRefundFixture({ ...input, movements: [] }).state).toBe('review');
    expect(correlateProviderRefundFixture({ ...input, ownershipConflict: true }).state).toBe('review');
    expect(correlateProviderRefundFixture({ ...input, movements: [{ ...input.movements[0]!, refund: { ...input.movements[0]!.refund!, payloadDigest: 'b'.repeat(64) } }] }).state).toBe('review');
  });

  it('requires exact own result and operation amount', async () => {
    const input = await refundFixture();

    expect(correlateProviderRefundFixture({ ...input, operation: { ...input.operation, result: { provenance: 'offline_fixture', objectId: 're_other' } } }).state).toBe('pending');

    const { parameterHash: _hash, idempotencyKey: _key, ...identity } = input.operation.identity;
    const modified = createOperationIdentity({ ...identity, kind: 'customer_refund', accountScope: 'connected', accountId: 'acct_salon', targetId: 'pi_fixture', parameters: { payment_intent: 'pi_fixture', amount: 4000 } });

    expect(correlateProviderRefundFixture({ ...input, operation: { ...input.operation, identity: modified } }).state).toBe('review');
  });
});

it.each([false, true])('rejects movement before proven parent occurrence fee=%s', async (fee) => {
  const input = await refundFixture(fee);
  const m = await movement(fee, { created: base / 1000 + 2 });
  input.parent.receipts = [...input.parent.receipts.filter(r => !input.movements.some(v => v.inboxId === r.inboxId)), m];
  input.movements = [m];

  expect(correlateProviderRefundFixture(input)).toMatchObject({ state: 'review', reasons: ['MOVEMENT_TIME_INVALID'] });
});

it('permits refund long after original quote expiry and keeps fee actual return independent', async () => {
  const input = await refundFixture();
  const m = await movement(false, { created: base / 1000 + 86400 }, base / 1000 + 86401);
  input.parent.now = new Date(base + 86400000);
  input.movements = [m];
  input.parent.receipts = [...input.parent.receipts.filter(r => !r.receipt.eventType?.startsWith('refund.')), m];

  expect(correlateProviderRefundFixture(input)).toMatchObject({ state: 'correlated', totals: { customerRefundCents: 3000, applicationFeeRefundCents: 0 } });
});

it.each([
  ['mode', 'live'],
  ['platformId', 'acct_other'],
  ['accountId', 'acct_other'],
  ['apiVersion', '2025-01-01'],
])('rejects movement envelope %s mismatch even when supplement agrees', async (field, value) => {
  const input = await refundFixture();
  const current = input.movements[0]!;
  const changed = { ...current, receipt: { ...current.receipt, [field]: value } as typeof current.receipt, refund: { ...current.refund!, [field]: value } as NonNullable<typeof current.refund> };
  input.movements = [changed];
  input.parent.receipts = input.parent.receipts.map(r => r.inboxId === current.inboxId ? changed : r);

  expect(correlateProviderRefundFixture(input).state).toBe('review');
});

it('missing supplement stays pending and cannot hide original unsupported review', async () => {
  const input = await refundFixture();

  expect(correlateProviderRefundFixture({ ...input, movements: [{ ...input.movements[0]!, refund: null }] }).state).toBe('pending');

  const current = input.movements[0]!;
  const changed = { ...current, receipt: { ...current.receipt, reviewReasons: ['MODE_MISMATCH'] } };
  input.movements = [changed];
  input.parent.receipts = input.parent.receipts.map(r => r.inboxId === current.inboxId ? changed : r);

  expect(correlateProviderRefundFixture(input)).toMatchObject({ state: 'review', reasons: ['MOVEMENT_ORIGINAL_REVIEW'] });
});

it('later supplement verification cannot rescue original future-timestamp evidence', async () => {
  const input = await refundFixture();
  const current = input.movements[0]!;
  const changed = { ...current, receipt: { ...current.receipt, receivedAt: new Date(base + 11000).toISOString() }, refund: { ...current.refund!, receivedAt: new Date(base + 86400000).toISOString() } };
  input.movements = [changed];
  input.parent.receipts = input.parent.receipts.map(r => r.inboxId === current.inboxId ? changed : r);

  expect(correlateProviderRefundFixture(input)).toMatchObject({ state: 'review', reasons: ['MOVEMENT_TIME_INVALID'] });
});

it.each(['charge', 'payment_intent'])('rejects explicit contradictory fee-return relationship %s', async (field) => {
  const input = await refundFixture(true);
  const m = await movement(true, { [field]: field === 'charge' ? 'ch_other' : 'pi_other' });
  input.parent.receipts = [...input.parent.receipts.filter(r => !input.movements.some(v => v.inboxId === r.inboxId)), m];
  input.movements = [m];

  expect(correlateProviderRefundFixture(input).state).toBe('review');
});

it.each(['scope', 'amount', 'parent', 'failed'])('missing supplement never hides known %s contradiction in either order', async (problem) => {
  const input = await refundFixture();
  const missing = { ...await movement(false, { id: 're_missing', status: 'pending' }), refund: null };
  const other = await movement(false, problem === 'amount' ? { amount: 2000 } : problem === 'parent' ? { charge: 'ch_other' } : problem === 'failed' ? { status: 'failed' } : {});
  const bad = problem === 'scope' ? { ...other, receipt: { ...other.receipt, accountId: 'acct_other' }, refund: { ...other.refund, accountId: 'acct_other' } } : other;
  input.movements = [...input.movements, missing, bad];
  input.parent.receipts = [...input.parent.receipts, missing, bad];
  for (const movements of permutations(input.movements)) {
    expect(correlateProviderRefundFixture({ ...input, movements })).toMatchObject({ state: 'review', candidate: null, totals: null });
  }
});

it('known wrong scope in the missing supplement itself is review and incomplete valid evidence has no totals/candidate', async () => {
  const input = await refundFixture();
  const missing = { ...await movement(false, { id: 're_missing', status: 'pending' }), refund: null };
  input.movements = [...input.movements, missing];
  input.parent.receipts = [...input.parent.receipts, missing];

  expect(correlateProviderRefundFixture(input)).toMatchObject({ state: 'pending', candidate: null, totals: null });

  const bad = { ...missing, receipt: { ...missing.receipt, accountId: 'acct_other' } };
  input.movements = input.movements.map(m => m.inboxId === missing.inboxId ? bad : m);
  input.parent.receipts = input.parent.receipts.map(m => m.inboxId === missing.inboxId ? bad : m);

  expect(correlateProviderRefundFixture(input).state).toBe('review');
});

it.each(['scope', 'failed'])('independent known %s blocker overrides incomplete parent and missing supplement', async (problem) => {
  const input = await refundFixture();
  const m = await movement(false, problem === 'failed' ? { status: 'failed' } : {});
  const missing = { ...m, refund: null, receipt: problem === 'scope' ? { ...m.receipt, accountId: 'acct_other' } : m.receipt };
  input.parent.receipts = [...input.parent.receipts.filter(r => r.inboxId !== 'charge' && !r.receipt.eventType?.startsWith('refund.')), missing];
  input.movements = [missing];

  expect(correlateProviderRefundFixture(input)).toMatchObject({ state: 'review', candidate: null, totals: null });
});

it.each(['charge', 'payment_intent'])('missing fee supplement still rejects known %s contradiction', async (field) => {
  const input = await refundFixture(true);
  const m = { ...await movement(true, { [field]: field === 'charge' ? 'ch_other' : 'pi_other' }), refund: null };
  input.parent.receipts = [...input.parent.receipts.filter(r => !input.movements.some(v => v.inboxId === r.inboxId)), m];
  input.movements = [m];

  expect(correlateProviderRefundFixture(input)).toMatchObject({ state: 'review', candidate: null, totals: null });
});
