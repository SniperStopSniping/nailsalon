import { describe, expect, it } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import { createDefaultPolicies } from './defaults';
import {
  deriveDepositPolicySummary,
  deriveDepositForfeitWording,
  derivePolicySuggestedWording,
  getDepositPolicyMode,
  getPolicyDisplayWording,
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

  it('uses one deposit mode for cancellation and no-show consequences', () => {
    const original = createDefaultPolicies();
    original.cancellations.notice = '24_hours';
    original.cancellations.consequence = 'deposit_lost';
    original.noShows.loseDeposit = true;

    const noDeposit = updateDepositPolicyMode(original, 'none');
    expect(deriveDepositForfeitWording(noDeposit, 'cancellation')).toBe('');
    expect(derivePolicySuggestedWording(noDeposit, 'cancellations'))
      .toBe('Please cancel or reschedule at least 24 hours before your appointment.');
    expect(derivePolicySuggestedWording(noDeposit, 'no_shows')).toBe('');

    const serviceDefined = updateDepositPolicyMode(noDeposit, 'depends_on_service');
    expect(derivePolicySuggestedWording(serviceDefined, 'cancellations'))
      .toContain('Any required deposit may be forfeited');
    expect(derivePolicySuggestedWording(serviceDefined, 'no_shows'))
      .toBe('Any required deposit may be forfeited after a missed appointment.');

    const generallyRequired = updateDepositPolicyMode(serviceDefined, 'generally_required');
    expect(derivePolicySuggestedWording(generallyRequired, 'cancellations'))
      .toContain('the deposit being lost');
    expect(derivePolicySuggestedWording(generallyRequired, 'no_shows'))
      .toBe('A missed appointment will forfeit the deposit.');
  });

  it('preserves stale overrides underneath while withholding contradictory deposit claims', () => {
    const policies = createDefaultPolicies();
    policies.cancellations.notice = '24_hours';
    policies.cancellations.consequence = 'deposit_lost';
    policies.copy.cancellations.useSuggestedWording = false;
    policies.copy.cancellations.wordingOverride = 'Late cancellations lose the deposit.';

    const noDeposit = updateDepositPolicyMode(policies, 'none');
    expect(noDeposit.copy.cancellations.wordingOverride)
      .toBe('Late cancellations lose the deposit.');
    expect(getPolicyDisplayWording(noDeposit, 'cancellations'))
      .toBe('Please cancel or reschedule at least 24 hours before your appointment.');

    const serviceDefined = updateDepositPolicyMode(noDeposit, 'depends_on_service');
    expect(getPolicyDisplayWording(serviceDefined, 'cancellations'))
      .toContain('Any required deposit may be forfeited');
    serviceDefined.copy.cancellations.wordingOverride =
      'Any required deposit may be forfeited after a late cancellation.';
    expect(getPolicyDisplayWording(serviceDefined, 'cancellations'))
      .toBe('Any required deposit may be forfeited after a late cancellation.');
  });

  it('withholds a contradictory deposit-card override whenever the shared mode changes', () => {
    const policies = createDefaultPolicies();
    policies.copy.deposits.useSuggestedWording = false;
    policies.copy.deposits.wordingOverride = 'A $50 deposit is required.';

    const noDeposit = updateDepositPolicyMode(policies, 'none');
    expect(noDeposit.copy.deposits.wordingOverride).toBe('A $50 deposit is required.');
    expect(getPolicyDisplayWording(noDeposit, 'deposits'))
      .toBe('No deposit is generally required.');

    const serviceDefined = updateDepositPolicyMode(noDeposit, 'depends_on_service');
    expect(getPolicyDisplayWording(serviceDefined, 'deposits'))
      .toBe('Deposit requirements depend on the service. Booking shows the deposit for each service.');

    const generallyRequired = updateDepositPolicyMode(serviceDefined, 'generally_required');
    expect(getPolicyDisplayWording(generallyRequired, 'deposits'))
      .toBe('A $50 deposit is required.');
  });

  it('withholds contradictory custom structured consequences in either editing order', () => {
    const policies = createDefaultPolicies();
    policies.cancellations.notice = '24_hours';
    policies.cancellations.consequence = 'custom';
    policies.cancellations.customConsequence = 'Late cancellations lose the deposit';
    policies.noShows.custom = 'A no-show forfeits the deposit';

    const noDeposit = updateDepositPolicyMode(policies, 'none');
    expect(noDeposit.cancellations.customConsequence)
      .toBe('Late cancellations lose the deposit');
    expect(noDeposit.noShows.custom).toBe('A no-show forfeits the deposit');
    expect(derivePolicySuggestedWording(noDeposit, 'cancellations'))
      .toBe('Please cancel or reschedule at least 24 hours before your appointment.');
    expect(derivePolicySuggestedWording(noDeposit, 'no_shows')).toBe('');

    const serviceDefined = updateDepositPolicyMode(noDeposit, 'depends_on_service');
    expect(derivePolicySuggestedWording(serviceDefined, 'cancellations'))
      .toContain('Any required deposit may be forfeited');
    expect(derivePolicySuggestedWording(serviceDefined, 'no_shows'))
      .toBe('Any required deposit may be forfeited after a missed appointment.');

    serviceDefined.cancellations.customConsequence =
      'Any required deposit may be forfeited after the deadline';
    serviceDefined.noShows.custom =
      'A deposit may be forfeited when the booked service required one';
    expect(derivePolicySuggestedWording(serviceDefined, 'cancellations'))
      .toContain('Any required deposit may be forfeited after the deadline.');
    expect(derivePolicySuggestedWording(serviceDefined, 'no_shows'))
      .toBe('A deposit may be forfeited when the booked service required one.');

    serviceDefined.cancellations.customConsequence =
      'When you cancel, the deposit is lost';
    serviceDefined.noShows.custom =
      'If you miss the appointment, your deposit is forfeited';
    expect(derivePolicySuggestedWording(serviceDefined, 'cancellations'))
      .toContain('Any required deposit may be forfeited');
    expect(derivePolicySuggestedWording(serviceDefined, 'cancellations'))
      .not.toContain('When you cancel');
    expect(derivePolicySuggestedWording(serviceDefined, 'no_shows'))
      .toBe('Any required deposit may be forfeited after a missed appointment.');
  });
});
