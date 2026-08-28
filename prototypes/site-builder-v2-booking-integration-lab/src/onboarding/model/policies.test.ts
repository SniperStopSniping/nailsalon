import { describe, expect, it } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import { createDefaultPolicies } from './defaults';
import {
  deriveDepositPolicySummary,
  derivePolicySuggestedWording,
  getDepositPolicyMode,
  refreshPolicySuggestedWording,
  updateDepositPolicyMode,
} from './policies';

describe('policy suggested wording', () => {
  it('does not invent policy claims for a blank owner', () => {
    const policies = createDefaultPolicies();

    expect(policies.cancellations.notice).toBeNull();
    expect(getDepositPolicyMode(policies)).toBeNull();
    expect(deriveDepositPolicySummary(policies)).toBe('');
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

    const withDepositMode = updateDepositPolicyMode(original, 'generally_required');
    const refreshed = refreshPolicySuggestedWording({
      ...withDepositMode,
      cancellations: {
        consequence: 'cancellation_fee',
        customConsequence: '',
        customNotice: '',
        notice: '48_hours',
      },
      deposits: {
        ...withDepositMode.deposits,
        amount: '30',
        amountType: 'percentage',
        refundable: false,
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
    expect(deriveDepositPolicySummary(refreshed)).toBe('30% deposit');
    expect(refreshed.copy.late_arrivals.suggestedWording).toContain('10-minute grace period');
  });

  it('keeps the Daniela fixture explicitly seeded with the review policy facts', () => {
    const policies = createDanielaFixtureState().profile.policies;

    expect(policies.cancellations.notice).toBe('24_hours');
    expect(getDepositPolicyMode(policies)).toBe('generally_required');
    expect(policies.deposits).toMatchObject({ amount: '50', amountType: 'fixed' });
    expect(deriveDepositPolicySummary(policies)).toBe('$50 deposit');
    expect(policies.lateArrivals.gracePeriodMinutes).toBe('15');
    expect(policies.copy.cancellations.suggestedWording).toContain('24 hours');
    expect(policies.copy.deposits.suggestedWording).toContain('$50 deposit');
    expect(policies.copy.late_arrivals.suggestedWording).toContain('15-minute grace period');
  });

  it('uses the same policy source for no-deposit and service-defined summaries and wording', () => {
    const original = createDefaultPolicies();
    const serviceDefined = updateDepositPolicyMode(original, 'depends_on_service');

    expect(getDepositPolicyMode(serviceDefined)).toBe('depends_on_service');
    expect(serviceDefined.deposits.amountType).toBe('service_defined');
    expect(deriveDepositPolicySummary(serviceDefined)).toBe('Deposit depends on the service');
    expect(serviceDefined.copy.deposits.suggestedWording)
      .toBe('Deposit requirements depend on the service. Booking shows the deposit for each service.');

    const none = updateDepositPolicyMode(serviceDefined, 'none');
    expect(getDepositPolicyMode(none)).toBe('none');
    expect(deriveDepositPolicySummary(none)).toBe('No general deposit');
    expect(none.copy.deposits.suggestedWording).toBe('No deposit is generally required.');
  });
});
