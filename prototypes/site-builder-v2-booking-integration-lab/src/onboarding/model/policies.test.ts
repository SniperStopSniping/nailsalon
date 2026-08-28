import { describe, expect, it } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import { createDefaultPolicies } from './defaults';
import {
  derivePolicySuggestedWording,
  refreshPolicySuggestedWording,
} from './policies';

describe('policy suggested wording', () => {
  it('does not invent policy claims for a blank owner', () => {
    const policies = createDefaultPolicies();

    expect(policies.cancellations.notice).toBeNull();
    expect(policies.deposits.required).toBeNull();
    expect(policies.lateArrivals.gracePeriodMinutes).toBe('');
    expect(Object.values(policies.copy).every((copy) => copy.suggestedWording === '')).toBe(true);
    expect(derivePolicySuggestedWording(policies, 'cancellations')).toBe('');
    expect(derivePolicySuggestedWording(policies, 'deposits')).toBe('');
    expect(derivePolicySuggestedWording(policies, 'late_arrivals')).toBe('');
  });

  it('derives wording from structured facts while preserving explicit overrides', () => {
    const original = createDefaultPolicies();
    original.copy.cancellations.useSuggestedWording = false;
    original.copy.cancellations.wordingOverride = 'Please message me if plans change.';

    const refreshed = refreshPolicySuggestedWording({
      ...original,
      cancellations: {
        consequence: 'cancellation_fee',
        customConsequence: '',
        customNotice: '',
        notice: '48_hours',
      },
      deposits: {
        amount: '30',
        amountType: 'percentage',
        refundable: false,
        required: true,
        transferable: true,
      },
      lateArrivals: {
        gracePeriodMinutes: '10',
        rescheduleAfterLimit: true,
        shortenService: true,
      },
    });

    expect(refreshed.copy.cancellations.suggestedWording).toContain('48 hours');
    expect(refreshed.copy.cancellations.suggestedWording).toContain('cancellation fee');
    expect(refreshed.copy.cancellations.wordingOverride).toBe('Please message me if plans change.');
    expect(refreshed.copy.cancellations.useSuggestedWording).toBe(false);
    expect(refreshed.copy.deposits.suggestedWording).toContain('30% deposit');
    expect(refreshed.copy.deposits.suggestedWording).toContain('non-refundable');
    expect(refreshed.copy.late_arrivals.suggestedWording).toContain('10-minute grace period');
  });

  it('keeps the Daniela fixture explicitly seeded with the review policy facts', () => {
    const policies = createDanielaFixtureState().profile.policies;

    expect(policies.cancellations.notice).toBe('24_hours');
    expect(policies.deposits).toMatchObject({ amount: '50', amountType: 'fixed', required: true });
    expect(policies.lateArrivals.gracePeriodMinutes).toBe('15');
    expect(policies.copy.cancellations.suggestedWording).toContain('24 hours');
    expect(policies.copy.deposits.suggestedWording).toContain('$50 deposit');
    expect(policies.copy.late_arrivals.suggestedWording).toContain('15-minute grace period');
  });
});
