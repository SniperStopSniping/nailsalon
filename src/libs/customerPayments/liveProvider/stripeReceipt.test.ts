import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { assertVerifiedStripeCustomerPaymentReceipt, verifyStripeCustomerPaymentReceipt } from './stripeReceipt';

vi.mock('server-only', () => ({}));

const now = Date.parse('2026-11-09T17:00:00Z');
const binding = { endpointId: 'we_example', platformAccountId: 'acct_platform', livemode: false, apiVersion: '2024-06-20' as const, signingSecret: `whsec_${'publictestfixture'.repeat(2)}` };

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_example',
    object: 'event',
    account: 'acct_salon',
    api_version: '2024-06-20',
    livemode: false,
    type: 'checkout.session.completed',
    created: now / 1000 - 10,
    data: { object: { id: 'cs_test_example', object: 'checkout.session', currency: 'cad', amount_total: 12000, payment_status: 'paid', payment_intent: 'pi_example', customer_email: 'private@example.invalid', url: 'https://checkout.stripe.com/private', metadata: { secret: 'private-customer-data' } } },
    ...overrides,
  };
}

function sign(event = fixture(), seconds = now / 1000) {
  const body = Buffer.from(JSON.stringify(event));
  const digest = createHmac('sha256', binding.signingSecret).update(`${seconds}.`).update(body).digest('hex');
  return { body, signature: `t=${seconds},v1=${digest}` };
}

describe('Stripe customer payment receipt boundary', () => {
  it('verifies raw bytes and returns only bounded correlation facts, never payment authority', () => {
    const signed = sign();
    const receipt = verifyStripeCustomerPaymentReceipt(signed.body, signed.signature, binding, now);

    expect(receipt).toMatchObject({ source: 'stripe_signature_verified', disposition: 'candidate', accountId: 'acct_salon', eventId: 'evt_example', financialPostingAllowed: false, facts: { currency: 'cad', amount_total: 12000, payment_intent: 'pi_example' } });
    expect(() => assertVerifiedStripeCustomerPaymentReceipt(receipt)).not.toThrow();
    expect(JSON.stringify(receipt)).not.toMatch(/private|customer_email|whsec_|checkout\.stripe/);
    expect(Object.isFrozen(receipt.facts)).toBe(true);
  });

  it('does not accept a deserialized provenance claim', () => {
    const signed = sign();
    const receipt = verifyStripeCustomerPaymentReceipt(signed.body, signed.signature, binding, now);

    expect(() => assertVerifiedStripeCustomerPaymentReceipt(JSON.parse(JSON.stringify(receipt)))).toThrow('STRIPE_RECEIPT_PROVENANCE_REQUIRED');
  });

  it('rejects modified content and the wrong endpoint secret', () => {
    const signed = sign();

    expect(() => verifyStripeCustomerPaymentReceipt(Buffer.from(JSON.stringify(fixture({ id: 'evt_other' }))), signed.signature, binding, now)).toThrow('STRIPE_RECEIPT_SIGNATURE_INVALID');
    expect(() => verifyStripeCustomerPaymentReceipt(signed.body, signed.signature, { ...binding, signingSecret: `whsec_${'wrongtestsecret'.repeat(2)}` }, now)).toThrow('STRIPE_RECEIPT_SIGNATURE_INVALID');
  });

  it.each([-301, 6])('rejects signed timestamps outside the receipt window: %s', (delta) => {
    const signed = sign(fixture(), now / 1000 + delta);

    expect(() => verifyStripeCustomerPaymentReceipt(signed.body, signed.signature, binding, now)).toThrow('STRIPE_RECEIPT_SIGNATURE_INVALID');
  });

  it('rejects duplicate timestamps rather than choosing one', () => {
    const signed = sign();

    expect(() => verifyStripeCustomerPaymentReceipt(signed.body, `${signed.signature},t=${now / 1000}`, binding, now)).toThrow('STRIPE_RECEIPT_SIGNATURE_INVALID');
  });

  it.each([{ livemode: true }, { account: 'acct_platform' }])('rejects wrong provider scope: %o', (override) => {
    const signed = sign(fixture(override));

    expect(() => verifyStripeCustomerPaymentReceipt(signed.body, signed.signature, binding, now)).toThrow('STRIPE_RECEIPT_SCOPE_MISMATCH');
  });

  it('does not manufacture a connected account for platform events', () => {
    const signed = sign(fixture({ account: undefined }));

    expect(() => verifyStripeCustomerPaymentReceipt(signed.body, signed.signature, binding, now)).toThrow('STRIPE_RECEIPT_ENVELOPE_INVALID');
  });

  it.each([{ api_version: '2025-01-27.acacia' }, { type: 'charge.dispute.created' }])('retains authenticated unsupported evidence for review: %o', (override) => {
    const signed = sign(fixture(override));

    expect(verifyStripeCustomerPaymentReceipt(signed.body, signed.signature, binding, now)).toMatchObject({ disposition: 'review', financialPostingAllowed: false });
  });

  it('accepts a fresh delivery of an older event, allowing idempotent journal reconciliation', () => {
    const signed = sign(fixture({ created: now / 1000 - 86400 }));

    expect(verifyStripeCustomerPaymentReceipt(signed.body, signed.signature, binding, now).occurredAt).toBe(now - 86400000);
  });

  it('bounds raw payload size before JSON parsing', () => {
    expect(() => verifyStripeCustomerPaymentReceipt(new Uint8Array(512 * 1024 + 1), 't=1,v1=x', binding, now)).toThrow('STRIPE_RECEIPT_INVALID_INPUT');
  });
});
