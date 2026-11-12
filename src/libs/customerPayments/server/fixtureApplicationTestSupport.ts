/** Shared test fixture only: injected database and closed offline fake transport. */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

import { computeCheckoutTotals, type ResolvedTaxConfig } from '@/libs/checkoutTotals';
import type { db } from '@/libs/DB';
import { buildBookingTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

import { dispatchProviderFixture } from '../provider/dispatchFixture';
import { type ProviderFixtureConfig, verifyOfflineProviderReceipt } from '../provider/evidence';
import { createOfflineOperationTransport, createOperationIdentity } from '../provider/operations';
import { verifyOfflineCheckoutSessionReceipt } from '../provider/sessionEvidence';
import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository } from './preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from './prepareQuoteForToken';
import { createProviderCorrelation } from './providerCorrelation';
import { createProviderJournal } from './providerJournal';

type Database = Pick<typeof db, 'insert' | 'select' | 'transaction'>;
const nonce = () => randomUUID().replaceAll('-', '');
export function signFixtureCapturePayload(payload: Record<string, unknown>, receivedAt = new Date()) {
  const rawBody = new TextEncoder().encode(JSON.stringify(payload));
  const signature = createHmac('sha256', 'offline_canonical_fixture_only').update(rawBody).digest('hex');
  return {
    input: { rawBody, signature, receivedAt },
    verifier: async (input: { rawBody: Uint8Array; signature: string }) => createHmac('sha256', 'offline_canonical_fixture_only').update(input.rawBody).digest('hex') === input.signature,
  };
}
export async function createFixtureCaptureGraph(database: Database, options: { tipCents?: number; platformId?: string; taxConfig?: ResolvedTaxConfig; salonSettings?: SalonSettings } = {}) {
  const suffix = nonce();
  const salonId = `fixture_application_salon_${suffix}`;
  const appointmentId = `fixture_application_appointment_${suffix}`;
  const tokenId = `fixture_application_token_${suffix}`;
  const bindingId = `fixture_application_binding_${suffix}`;
  const serviceId = `fixture_application_service_${suffix}`;
  const serviceSnapshotId = `fixture_application_item_${suffix}`;
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const future = (offset: number) => new Date(now.getTime() + offset);
  const taxConfig = options.taxConfig ?? DISABLED_TAX_CONFIG;
  const taxTotals = computeCheckoutTotals({ items: [{ lineTotalCents: 10000, taxable: taxConfig.taxServicesByDefault }], taxConfig });
  const accountId = `acct_${suffix}`;
  const config: ProviderFixtureConfig = { endpointId: `endpoint_${suffix}`, platformId: options.platformId ?? `acct_${nonce()}`, accountScope: 'connected', expectedAccountId: accountId, apiVersion: '2024-06-20', livemode: false };
  await database.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Offline canonical fixture', settings: options.salonSettings, status: 'active', publicationStatus: 'published' });
  await database.insert(schema.technicianSchema).values({ id: `tech_${suffix}`, salonId, name: 'Offline technician' });
  await database.insert(schema.serviceSchema).values({ id: serviceId, salonId, name: 'Fixed fixture service', price: 10000, durationMinutes: 60, category: 'manicure' });
  await database.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, technicianId: `tech_${suffix}`, clientPhone: '4165550111', clientName: 'Offline fixture', startTime: future(86400000), endTime: future(90000000), totalPrice: 10000, basePriceCents: 10000, addOnsPriceCents: 0, subtotalBeforeDiscountCents: 10000, totalDurationMinutes: 60, status: 'confirmed', invoiceCurrency: 'CAD', bookingTaxSnapshot: buildBookingTaxSnapshot({ taxConfig, totals: taxTotals, currency: 'CAD', capturedAt: now }) });
  await database.insert(schema.appointmentServicesSchema).values({ id: serviceSnapshotId, appointmentId, serviceId, priceAtBooking: 10000, durationAtBooking: 60 });
  await database.insert(schema.salonStripeAccountSchema).values({ id: bindingId, salonId, stripeAccountId: accountId, livemode: false, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, lastSyncedAt: now });
  await database.insert(schema.appointmentAccessTokenSchema).values({ id: tokenId, salonId, appointmentId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: future(3600000) });
  await createCustomerPaymentPreparationRepository(database).saveCustomerPaymentSettingsDraft({ salonId, actorId: 'fixture_owner', expectedRevision: 0, requestId: randomUUID(), settings: { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true } });
  const quote = await prepareCustomerPaymentQuoteForToken(database, token, { requestId: randomUUID(), tipCents: options.tipCents ?? 2000 });
  const snapshot = quote.snapshot;
  const ids = { session: `cs_test_${suffix}`, intent: `pi_${suffix}`, charge: `ch_${suffix}`, fee: `fee_${suffix}` };
  const identity = createOperationIdentity({ id: randomUUID(), salonId, appointmentId, quoteId: quote.id, requestId: randomUUID(), contextHash: quote.fingerprint, platformId: config.platformId, accountScope: 'connected', accountId, mode: 'test', apiVersion: '2024-06-20', provenance: 'offline_fixture', kind: 'checkout_create', targetId: null, parameters: { mode: 'payment', payment_method_types: ['card'], client_reference_id: quote.id, success_url: 'https://fixture.invalid/success', cancel_url: 'https://fixture.invalid/cancel', line_items: [{ quantity: 1, price_data: { currency: 'cad', unit_amount: snapshot.chargeCents, product_data: { name: 'Appointment payment and optional tip' } } }], payment_intent_data: { application_fee_amount: snapshot.applicationFeeCents } } });
  const journal = createProviderJournal(database);
  await journal.prepareOperation(identity);
  const transport = createOfflineOperationTransport([{ identity, dispatch: { type: 'accepted', objectId: ids.session }, reconciliation: { type: 'unresolved' } }]);
  await dispatchProviderFixture(journal, transport, identity.id, { workerId: 'offline_application_worker', leaseMs: 60000 });
  const operation = (await journal.getOperation(identity.id))!;
  // Signed events have second resolution. Avoid ambiguous pre-quote seconds.
  const earliestSecond = Math.ceil(quote.createdAt.getTime() / 1000) * 1000;
  if (Date.now() < earliestSecond) {
    await new Promise(resolve => setTimeout(resolve, earliestSecond - Date.now() + 2));
  }
  const observedAt = new Date();
  const created = Math.floor(observedAt.getTime() / 1000);
  const event = (type: string, object: Record<string, unknown>, platform = false): Record<string, unknown> => ({ id: `evt_${nonce()}`, object: 'event', type, created, ...(platform ? {} : { account: accountId }), api_version: config.apiVersion, livemode: false, data: { object } });
  const sessionPayload = event('checkout.session.completed', { id: ids.session, object: 'checkout.session', livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid', payment_intent: ids.intent, amount_total: snapshot.chargeCents, currency: 'cad', client_reference_id: quote.id, created: Math.floor(operation.firstDispatchedAt! / 1000), expires_at: Math.floor(quote.expiresAt.getTime() / 1000) });
  const intentPayload = event('payment_intent.succeeded', { id: ids.intent, object: 'payment_intent', livemode: false, status: 'succeeded', amount: snapshot.chargeCents, amount_received: snapshot.chargeCents, currency: 'cad', latest_charge: ids.charge });
  const chargePayload = event('charge.succeeded', { id: ids.charge, object: 'charge', livemode: false, amount: snapshot.chargeCents, amount_captured: snapshot.chargeCents, amount_refunded: 0, currency: 'cad', payment_intent: ids.intent, application_fee: ids.fee, paid: true, captured: true });
  const feePayload = event('application_fee.created', { id: ids.fee, object: 'application_fee', livemode: false, amount: snapshot.applicationFeeCents, currency: 'cad', charge: ids.charge, account: accountId }, true);
  const sessionSigned = signFixtureCapturePayload(sessionPayload, observedAt);
  const pair = await verifyOfflineCheckoutSessionReceipt(sessionSigned.input, config, sessionSigned.verifier);
  const sessionInbox = await journal.ingestReceipt(pair.receipt);
  const receipts = [];
  const descriptions = [
    { payload: intentPayload, cfg: { ...config, expectedObject: { id: ids.intent, type: 'payment_intent', amountCents: snapshot.chargeCents, currency: 'cad', chargeId: ids.charge } } },
    { payload: chargePayload, cfg: { ...config, expectedObject: { id: ids.charge, type: 'charge', amountCents: snapshot.chargeCents, currency: 'cad', paymentIntentId: ids.intent } } },
    { payload: feePayload, cfg: { ...config, accountScope: 'platform' as const, expectedAccountId: null, expectedObject: { id: ids.fee, type: 'application_fee', amountCents: snapshot.applicationFeeCents, currency: 'cad', chargeId: ids.charge, connectedAccountId: accountId } } },
  ];
  for (const description of descriptions) {
    const signed = signFixtureCapturePayload(description.payload, observedAt);
    const receipt = await verifyOfflineProviderReceipt(signed.input, description.cfg, signed.verifier);
    const inbox = await journal.ingestReceipt(receipt);
    receipts.push({ receipt, inbox, cfg: description.cfg });
  }
  const correlation = createProviderCorrelation(database);
  await correlation.persistSessionProjection(sessionInbox.id, pair.receipt, pair.session);
  return { taxConfig, taxTotals, salonId, appointmentId, tokenId, bindingId, serviceSnapshotId, token, config, quote, snapshot, ids, identity, journal, transport, correlation, pair, sessionInbox, receipts, observedAt, event, sessionPayload, intentPayload, chargePayload, feePayload };
}
