import { describe, expect, it } from 'vitest';

import { customerReviewRequestSchema } from './reviewContracts';

const request = {
  conversation: 'signed conversation',
  contact: { name: 'Customer', email: 'customer@example.test', phone: '4165550101' },
};

describe('customer review SMS consent contract', () => {
  it('accepts an omitted v3 promotional choice as a false-by-default separate consent', () => {
    expect(customerReviewRequestSchema.parse({
      ...request,
      smsConsent: {
        granted: true,
        selection: 'default_on',
        wordingVersion: 'booking-sms-separated-v3',
      },
    }).smsConsent).toEqual({
      granted: true,
      selection: 'default_on',
      wordingVersion: 'booking-sms-separated-v3',
    });
  });

  it('accepts promotionsGranted only for the separated v3 wording', () => {
    expect(customerReviewRequestSchema.safeParse({
      ...request,
      smsConsent: {
        granted: true,
        selection: 'default_on',
        wordingVersion: 'booking-sms-separated-v3',
        promotionsGranted: true,
      },
    }).success).toBe(true);
    expect(customerReviewRequestSchema.safeParse({
      ...request,
      smsConsent: {
        granted: true,
        selection: 'default_on',
        wordingVersion: 'booking-sms-all-v2',
        promotionsGranted: true,
      },
    }).success).toBe(false);
  });

  it('accepts the combined v4 choice but rejects a split promotional payload or default-on', () => {
    expect(customerReviewRequestSchema.safeParse({
      ...request,
      smsConsent: {
        granted: false,
        selection: 'default_off',
        wordingVersion: 'booking-sms-combined-v4',
      },
    }).success).toBe(true);
    expect(customerReviewRequestSchema.safeParse({
      ...request,
      smsConsent: {
        granted: false,
        selection: 'default_off',
        wordingVersion: 'booking-sms-combined-v4',
        promotionsGranted: false,
      },
    }).success).toBe(false);
    expect(customerReviewRequestSchema.safeParse({
      ...request,
      smsConsent: {
        granted: true,
        selection: 'default_on',
        wordingVersion: 'booking-sms-combined-v4',
      },
    }).success).toBe(false);
  });
});
