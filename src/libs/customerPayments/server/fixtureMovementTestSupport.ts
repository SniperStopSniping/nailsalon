/** Injected-database, closed fake fixtures only. */
import { randomUUID } from 'node:crypto';

import { dispatchProviderFixture } from '../provider/dispatchFixture';
import { verifyOfflineDisputeReceipt } from '../provider/disputeEvidence';
import { createOfflineOperationTransport, createOperationIdentity } from '../provider/operations';
import { verifyOfflineRefundReceipt } from '../provider/refundEvidence';
import { createProviderFixtureCaptureApplication } from './applyProviderFixtureCapture';
import { createFixtureCaptureGraph, signFixtureCapturePayload } from './fixtureApplicationTestSupport';
import { createProviderDisputeCorrelation } from './providerDisputeCorrelation';
import { createProviderRefundCorrelation } from './providerRefundCorrelation';

type Database = Parameters<typeof createFixtureCaptureGraph>[0];
export async function createFixtureMovementGraph(database: Database) {
  const f = await createFixtureCaptureGraph(database);
  const applied = await createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id });
  if (!applied.applicationId) {
    throw new Error('FIXTURE_CAPTURE_NOT_APPLIED');
  }
  return { ...f, database, applied, captureApplicationId: applied.applicationId };
}
type Fixture = Awaited<ReturnType<typeof createFixtureMovementGraph>>;
const nonce = () => randomUUID().replaceAll('-', '');
export async function addFixtureRefund(f: Fixture, options: { kind?: 'customer_refund' | 'application_fee_refund'; amountCents?: number; status?: 'pending' | 'succeeded' | 'failed' | 'canceled'; withOperation?: boolean; movementId?: string } = {}) {
  const kind = options.kind ?? 'customer_refund';
  const amountCents = options.amountCents ?? (kind === 'customer_refund' ? 1000 : 100);
  const movementId = options.movementId ?? `${kind === 'customer_refund' ? 're_' : 'fr_'}${nonce()}`;
  const common = { id: randomUUID(), salonId: f.salonId, appointmentId: f.appointmentId, quoteId: f.quote.id, requestId: randomUUID(), contextHash: f.quote.fingerprint, platformId: f.config.platformId, mode: 'test' as const, apiVersion: '2024-06-20' as const, provenance: 'offline_fixture' as const };
  const identity = kind === 'customer_refund'
    ? createOperationIdentity({ ...common, accountScope: 'connected', accountId: f.config.expectedAccountId!, kind, targetId: f.ids.intent, parameters: { payment_intent: f.ids.intent, amount: amountCents } })
    : createOperationIdentity({ ...common, accountScope: 'platform', accountId: null, kind, targetId: f.ids.fee, parameters: { amount: amountCents } });
  if (options.withOperation !== false) {
    await f.journal.prepareOperation(identity);
    const transport = createOfflineOperationTransport([{ identity, dispatch: { type: 'accepted', objectId: movementId }, reconciliation: { type: 'unresolved' } }]);
    await dispatchProviderFixture(f.journal, transport, identity.id, { workerId: 'offline_movement_worker', leaseMs: 60000 });
  }
  const receivedAt = new Date();
  const created = Math.floor(receivedAt.getTime() / 1000);
  const object = kind === 'customer_refund'
    ? { id: movementId, object: 'refund', livemode: false, amount: amountCents, currency: 'cad', payment_intent: f.ids.intent, charge: f.ids.charge, status: options.status ?? 'succeeded', created }
    : { id: movementId, object: 'fee_refund', amount: amountCents, currency: 'cad', fee: f.ids.fee, created };
  const payload = { id: `evt_${nonce()}`, object: 'event', type: kind === 'customer_refund' ? 'refund.updated' : 'application_fee.refund.updated', created, ...(kind === 'customer_refund' ? { account: f.config.expectedAccountId } : {}), api_version: f.config.apiVersion, livemode: false, data: { object } };
  const config = kind === 'customer_refund' ? f.config : { ...f.config, accountScope: 'platform' as const, expectedAccountId: null };
  const signed = signFixtureCapturePayload(payload, receivedAt);
  const pair = await verifyOfflineRefundReceipt(signed.input, config, signed.verifier);
  const inbox = await f.journal.ingestReceipt(pair.receipt);
  const projection = await createProviderRefundCorrelation(f.database).persistRefundProjection(inbox.id, pair.receipt, pair.refund);
  return { identity, operation: options.withOperation !== false ? await f.journal.getOperation(identity.id) : null, movementId, payload, pair, config, inbox, projection };
}
export async function addFixtureDispute(f: Fixture, options: { status?: 'needs_response' | 'under_review' | 'won' | 'lost'; disputeId?: string; transactions?: Record<string, unknown>[]; amountCents?: number; objectCreated?: number } = {}) {
  const receivedAt = new Date();
  const created = Math.floor(receivedAt.getTime() / 1000);
  const disputeId = options.disputeId ?? `dp_${nonce()}`;
  const amountCents = options.amountCents ?? 2000;
  const transactionId = `txn_${nonce()}`;
  const transactions = options.transactions ?? [{ id: transactionId, object: 'balance_transaction', source: disputeId, amount: -amountCents, fee: 1500, net: -amountCents - 1500, currency: 'cad', exchange_rate: null, created, available_on: created + 86400, status: 'pending', type: 'adjustment', reporting_category: 'dispute' }];
  const object = { id: disputeId, object: 'dispute', livemode: false, amount: amountCents, currency: 'cad', charge: f.ids.charge, payment_intent: f.ids.intent, status: options.status ?? 'needs_response', created: options.objectCreated ?? created, balance_transactions: transactions };
  const payload = { id: `evt_${nonce()}`, object: 'event', type: 'charge.dispute.updated', created, account: f.config.expectedAccountId, api_version: f.config.apiVersion, livemode: false, data: { object } };
  const signed = signFixtureCapturePayload(payload, receivedAt);
  const pair = await verifyOfflineDisputeReceipt(signed.input, f.config, signed.verifier);
  const inbox = await f.journal.ingestReceipt(pair.receipt);
  const projection = await createProviderDisputeCorrelation(f.database).persistDisputeProjection(inbox.id, pair.receipt, pair.dispute);
  return { disputeId, transactionId, transactions, payload, pair, config: f.config, inbox, projection };
}
