import { z } from 'zod';

import type { InactiveStripeCheckoutOperation } from './checkoutContract';
import { checkoutAdapterError, freezeCheckoutValue } from './checkoutContract';

const id = (prefix: string) => z.string().max(255).regex(new RegExp(`^${prefix}_[A-Za-z0-9]+$`)).refine(value => value.trim() === value);
const money = z.number().int().min(0).max(50_000_000);
const chargeSchema = z.object({
  id: id('ch'),
  object: z.literal('charge'),
  livemode: z.literal(false),
  payment_intent: id('pi'),
  amount: money,
  amount_captured: money,
  amount_refunded: money,
  currency: z.literal('cad'),
  paid: z.boolean(),
  captured: z.boolean(),
  refunded: z.boolean(),
  status: z.enum(['succeeded', 'pending', 'failed']),
  application_fee_amount: money.nullable(),
  application_fee: z.union([id('fee'), z.object({ id: id('fee'), object: z.literal('application_fee') })]).nullable(),
  transfer_data: z.null(),
  on_behalf_of: z.null(),
});
const intentSchema = z.object({
  id: id('pi'),
  object: z.literal('payment_intent'),
  livemode: z.literal(false),
  amount: money,
  amount_received: money,
  currency: z.literal('cad'),
  application_fee_amount: money.nullable(),
  capture_method: z.literal('automatic'),
  payment_method_types: z.tuple([z.literal('card')]),
  status: z.enum(['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'canceled', 'succeeded']),
  transfer_data: z.null(),
  on_behalf_of: z.null(),
  latest_charge: z.union([id('ch'), chargeSchema]).nullable(),
});
const sessionSchema = z.object({
  id: id('cs_test'),
  object: z.literal('checkout.session'),
  livemode: z.literal(false),
  mode: z.literal('payment'),
  client_reference_id: z.string().uuid(),
  currency: z.literal('cad'),
  amount_total: money,
  amount_subtotal: money,
  created: z.number().int().nonnegative(),
  expires_at: z.number().int().nonnegative(),
  payment_method_types: z.tuple([z.literal('card')]),
  automatic_tax: z.object({ enabled: z.literal(false) }),
  total_details: z.object({ amount_discount: z.literal(0), amount_shipping: z.literal(0), amount_tax: z.literal(0) }),
  status: z.enum(['open', 'complete', 'expired']),
  payment_status: z.enum(['unpaid', 'paid']),
  payment_intent: z.union([id('pi'), intentSchema]).nullable(),
});
export type InactiveStripeSessionProjection = {
  sessionId: string;
  status: 'open' | 'complete' | 'expired';
  paymentStatus: 'unpaid' | 'paid';
  paymentIntentId: string | null;
  chargeId: string | null;
  feeCheck: 'awaiting_intent' | 'intent_amount_matches' | 'captured_charge_amount_matches';
  financialPostingAllowed: false;
};

/** A scoped SDK result, never webhook authority, settlement, or an ownership claim from metadata. */
export function inspectInactiveStripeSession(
  raw: unknown,
  operation: InactiveStripeCheckoutOperation,
  previous: InactiveStripeSessionProjection | null,
): InactiveStripeSessionProjection {
  const parsed = sessionSchema.safeParse(raw);
  if (!parsed.success) {
    return checkoutAdapterError('SESSION_SHAPE_MISMATCH');
  }
  const session = parsed.data;
  const { chargeCents, applicationFeeCents } = operation.snapshot;
  if (session.client_reference_id !== operation.material.quoteId
    || session.amount_total !== chargeCents || session.amount_subtotal !== chargeCents
    || session.expires_at !== operation.params.expires_at
    || session.created < Math.floor(operation.material.createdAt / 1000)
    || session.created > Math.floor(operation.material.quoteExpiresAt / 1000)
    || (session.payment_status === 'paid' && session.status !== 'complete')) {
    return checkoutAdapterError('SESSION_MONEY_MISMATCH');
  }
  let feeCheck: InactiveStripeSessionProjection['feeCheck'] = 'awaiting_intent';
  const intent = session.payment_intent;
  const paymentIntentId = typeof intent === 'string' ? intent : intent?.id ?? null;
  let chargeId: string | null = null;
  if (intent && typeof intent !== 'string') {
    if (intent.amount !== chargeCents || (intent.application_fee_amount ?? 0) !== applicationFeeCents
      || intent.amount_received > chargeCents
      || (intent.status === 'succeeded' && (intent.amount_received !== chargeCents || session.payment_status !== 'paid'))
      || (session.payment_status === 'paid' && intent.status !== 'succeeded')
      || intent.status === 'requires_capture') {
      return checkoutAdapterError('INTENT_MONEY_MISMATCH');
    }
    feeCheck = 'intent_amount_matches';
    const charge = intent.latest_charge;
    chargeId = typeof charge === 'string' ? charge : charge?.id ?? null;
    if (charge && typeof charge !== 'string') {
      if (charge.payment_intent !== intent.id || charge.amount !== chargeCents
        || (charge.application_fee_amount !== null && charge.application_fee_amount !== applicationFeeCents)
        || charge.amount_refunded !== 0 || charge.refunded) {
        return checkoutAdapterError('CHARGE_RELATIONSHIP_MISMATCH');
      }
      if (intent.status === 'succeeded') {
        if (!charge.paid || !charge.captured || charge.status !== 'succeeded' || charge.amount_captured !== chargeCents
          || (charge.application_fee_amount ?? 0) !== applicationFeeCents
          || (applicationFeeCents > 0) !== (charge.application_fee !== null)) {
          return checkoutAdapterError('CHARGE_CAPTURE_MISMATCH');
        }
        feeCheck = 'captured_charge_amount_matches';
      } else if (charge.captured || charge.paid || charge.amount_captured !== 0 || charge.application_fee !== null || charge.status === 'succeeded') {
        return checkoutAdapterError('UNSETTLED_CHARGE_CONFLICT');
      }
    }
  }
  if (session.payment_status === 'paid' && paymentIntentId === null) {
    return checkoutAdapterError('PAID_SESSION_WITHOUT_INTENT');
  }
  if (previous && (session.id !== previous.sessionId
    || (previous.paymentIntentId !== null && previous.paymentIntentId !== paymentIntentId)
    || (previous.feeCheck === 'captured_charge_amount_matches' && previous.chargeId !== chargeId)
    || (previous.paymentStatus === 'paid' && session.payment_status !== 'paid')
    || (previous.status !== 'open' && previous.status !== session.status)
    || (previous.feeCheck === 'captured_charge_amount_matches' && feeCheck !== previous.feeCheck))) {
    return checkoutAdapterError('SESSION_HISTORY_CONFLICT');
  }
  return freezeCheckoutValue({
    sessionId: session.id,
    status: session.status,
    paymentStatus: session.payment_status,
    paymentIntentId,
    chargeId,
    feeCheck,
    financialPostingAllowed: false,
  });
}
