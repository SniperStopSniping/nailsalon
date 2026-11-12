import { requireCustomerPaymentProviderFixtureEnabled } from '../providerTestGate';
import type { ProviderJournal } from '../server/providerJournal';

type Journal = Pick<ProviderJournal, 'getInbox' | 'ensureDelivery' | 'claimDelivery' | 'finishDelivery'>;
type Delivery = Awaited<ReturnType<ProviderJournal['ensureDelivery']>>;

/** Inspection only: none of these consumer names is registered with a webhook. */
export const PROVIDER_FIXTURE_CONSUMERS = Object.freeze([
  Object.freeze({ name: 'customer_capture_fixture', version: 1, types: Object.freeze(['payment_intent.succeeded', 'charge.succeeded']) }),
  Object.freeze({ name: 'customer_refund_fixture', version: 1, types: Object.freeze(['refund.created', 'refund.updated']) }),
  Object.freeze({ name: 'application_fee_fixture', version: 1, types: Object.freeze(['application_fee.created', 'application_fee.refund.updated']) }),
]);

/**
 * Exercises independent consumer delivery without a financial bridge. Matching
 * money always remains under review. An irrelevant consumer may finish its own
 * inspection; that never finishes another consumer or changes canonical money.
 */
export async function inspectProviderFixtureInbox(journal: Journal, inboxId: string, worker: { workerId: string; leaseMs: number }): Promise<Delivery[]> {
  requireCustomerPaymentProviderFixtureEnabled();
  const inbox = await journal.getInbox(inboxId);
  if (!inbox) {
    throw new Error('CUSTOMER_PAYMENT_PROVIDER_INBOX_NOT_FOUND');
  }
  const results: Delivery[] = [];
  for (const consumer of PROVIDER_FIXTURE_CONSUMERS) {
    requireCustomerPaymentProviderFixtureEnabled();
    const delivery = await journal.ensureDelivery(inboxId, consumer.name, consumer.version);
    if (delivery.state === 'review' || delivery.state === 'completed') {
      results.push(delivery);
      continue;
    }
    const claimed = await journal.claimDelivery(delivery.id, worker);
    const eventType = typeof inbox.receipt.eventType === 'string' ? inbox.receipt.eventType : '';
    const requiresReview = inbox.hasConflict || inbox.receipt.source !== 'offline_signed_fixture'
      || inbox.receipt.classification !== 'accepted' || consumer.types.includes(eventType);
    const saved = await journal.finishDelivery(delivery.id, {
      expectedVersion: claimed.version,
      leaseToken: claimed.leaseToken!,
      outcome: requiresReview ? 'review' : 'completed',
      detail: requiresReview ? 'Fixture money retained; financial bridge not installed' : 'Fixture inspection only; event is for a different consumer',
    });
    results.push(saved);
  }
  return results;
}
