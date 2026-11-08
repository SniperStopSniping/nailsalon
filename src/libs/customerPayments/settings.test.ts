import { describe, expect, it } from 'vitest';

import { customerPaymentDraftResponse, customerPaymentDraftSettingsSchema, customerPaymentDraftWriteSchema, DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from './settings';

describe('test-only customer payment settings', () => {
  it('defaults off and never returns collection permission', () => {
    expect(customerPaymentDraftResponse(0, DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS)).toEqual({ testOnly: true, collectionEnabled: false, revision: 0, settings: { enabled: false, mode: 'optional_full', feePayer: 'salon', platformFeeCents: 100, cancellationPolicy: '' } });
    expect(customerPaymentDraftResponse(1, { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true }).collectionEnabled).toBe(false);
  });

  it.each([
    { mode: 'full_online_required' },
    { mode: 'required_deposit' },
    { feePayer: 'customer' },
    { platformFeeCents: -1 },
    { platformFeeCents: 10001 },
    { platformFeeCents: 1.5 },
    { collectionEnabled: true },
    { stripeAccountId: 'acct_arbitrary' },
    { cancellationPolicy: 'x'.repeat(5001) },
  ])('rejects unsupported policy or unsafe values: %j', (change) => {
    expect(customerPaymentDraftSettingsSchema.safeParse({ ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, ...change }).success).toBe(false);
  });

  it('requires explicit revision and request identity with no unknown fields', () => {
    const write = { expectedRevision: 0, requestId: '1cfb5245-a096-40fa-8fb5-689af6617d93', settings: DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS };

    expect(customerPaymentDraftWriteSchema.safeParse(write).success).toBe(true);
    expect(customerPaymentDraftWriteSchema.safeParse({ ...write, expectedRevision: -1 }).success).toBe(false);
    expect(customerPaymentDraftWriteSchema.safeParse({ ...write, requestId: '' }).success).toBe(false);
    expect(customerPaymentDraftWriteSchema.safeParse({ ...write, salonId: 'foreign' }).success).toBe(false);
  });
});
