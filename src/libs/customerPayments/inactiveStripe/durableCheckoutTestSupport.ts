/** Disposable database test support only. Never imported by application code. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { db } from '@/libs/DB';
import { buildBookingTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { createCustomerPaymentPreparationRepository } from '../server/preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from '../server/prepareQuoteForToken';
import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import type { InactiveStripeCheckoutOperation } from './checkoutContract';
import { buildInactiveStripeCheckoutOperation } from './checkoutContract';

type Database = Pick<typeof db, 'select' | 'insert' | 'transaction'>;
export async function createDurableCheckoutFixture(database: Database) {
  const suffix = randomUUID().replaceAll('-', '');
  const salonId = `binding_salon_${suffix}`;
  const appointmentId = `binding_appt_${suffix}`;
  const tokenId = `binding_token_${suffix}`;
  const bindingId = `binding_account_${suffix}`;
  const itemId = `binding_item_${suffix}`;
  const technicianId = `binding_tech_${suffix}`;
  const serviceId = `binding_service_${suffix}`;
  const accountId = `acct_${suffix}`;
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const future = (offset: number) => new Date(now.getTime() + offset);
  await database.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Closed quote fixture', status: 'active', publicationStatus: 'published' });
  await database.insert(schema.technicianSchema).values({ id: technicianId, salonId, name: 'Fixture technician' });
  await database.insert(schema.serviceSchema).values({ id: serviceId, salonId, name: 'Fixture service', price: 10000, durationMinutes: 60, category: 'manicure' });
  await database.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, technicianId, clientPhone: '4165550111', clientName: 'Private fixture name', startTime: future(86400000), endTime: future(90000000), totalPrice: 10000, basePriceCents: 10000, addOnsPriceCents: 0, subtotalBeforeDiscountCents: 10000, totalDurationMinutes: 60, status: 'confirmed', invoiceCurrency: 'CAD', bookingTaxSnapshot: buildBookingTaxSnapshot({ taxConfig: DISABLED_TAX_CONFIG, totals: { finalPriceCents: 10000, taxableSubtotalCents: 0, taxAmountCents: 0, taxApplied: false }, currency: 'CAD', capturedAt: now }) });
  await database.insert(schema.appointmentServicesSchema).values({ id: itemId, appointmentId, serviceId, priceAtBooking: 10000, durationAtBooking: 60 });
  await database.insert(schema.salonStripeAccountSchema).values({ id: bindingId, salonId, stripeAccountId: accountId, livemode: false, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, lastSyncedAt: now });
  await database.insert(schema.appointmentAccessTokenSchema).values({ id: tokenId, salonId, appointmentId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: future(3600000) });
  const repository = createCustomerPaymentPreparationRepository(database);
  const policyInput = { salonId, actorId: 'closed_fixture_owner', expectedRevision: 0, requestId: randomUUID(), settings: { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true } };
  await repository.saveCustomerPaymentSettingsDraft(policyInput);
  const quote = await prepareCustomerPaymentQuoteForToken(database, token, { requestId: randomUUID(), tipCents: 2000 });
  const s = quote.snapshot;
  const operation = buildInactiveStripeCheckoutOperation({
    operationId: randomUUID(),
    requestId: randomUUID(),
    salonId,
    appointmentId,
    quoteId: quote.id,
    contextHash: quote.fingerprint,
    createdAt: quote.createdAt.getTime(),
    quoteExpiresAt: quote.expiresAt.getTime(),
    sessionExpiresAt: Math.ceil(quote.expiresAt.getTime() / 1000) * 1000 + 1800000,
    successUrl: 'https://closed.invalid/success',
    cancelUrl: 'https://closed.invalid/cancel',
    quote: { currency: 'cad', collection: 'full', servicesCents: s.servicesCents, discountCents: s.discountCents, taxCents: s.taxCents, tipCents: s.tipCents, feePolicy: { payer: 'salon', feeCents: s.configuredFeeCents, taxTreatment: 'not_collected_in_test_mode' } },
  }, { platformAccountId: 'acct_closedPlatform', connectedAccountId: accountId, mode: 'test', returnOrigin: 'https://closed.invalid' });
  return { salonId, appointmentId, tokenId, bindingId, itemId, quote, operation, repository, policyInput };
}

export function closedCheckoutSession(operation: InactiveStripeCheckoutOperation, overrides: Record<string, unknown> = {}) {
  return {
    id: `cs_test_${operation.material.operationId.replaceAll('-', '')}`,
    object: 'checkout.session',
    livemode: false,
    mode: 'payment',
    client_reference_id: operation.material.quoteId,
    currency: 'cad',
    amount_total: operation.snapshot.chargeCents,
    amount_subtotal: operation.snapshot.chargeCents,
    created: Math.floor(operation.material.createdAt / 1000),
    expires_at: operation.params.expires_at,
    payment_method_types: ['card'],
    automatic_tax: { enabled: false },
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
    status: 'open',
    payment_status: 'unpaid',
    payment_intent: null,
    url: 'https://checkout.invalid/private-url',
    customer_details: { email: 'private@example.invalid' },
    ...overrides,
  };
}
