import { describe, expect, it } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import { createDefaultPolicies } from './defaults';
import {
  deriveDepositForfeitWording,
  deriveDepositPolicySummary,
  derivePolicySuggestedWording,
  getDepositPolicyMode,
  getPolicyDisplayWording,
  hasMeaningfulPublishablePolicies,
  isPolicySectionComplete,
  refreshPolicySuggestedWording,
  updateDepositDraft,
  updateDepositPolicyMode,
} from './policies';

describe('policy suggested wording', () => {
  it('defaults to no deposit without inventing a charge', () => {
    const policies = createDefaultPolicies();

    expect(getDepositPolicyMode(policies)).toBe('none');
    expect(deriveDepositPolicySummary(policies)).toBe('No deposit');
    expect(derivePolicySuggestedWording(policies, 'deposits'))
      .toBe('No deposit is required.');
  });

  it('derives one fixed-dollar deposit from the shared normalized draft', () => {
    const original = createDefaultPolicies();
    original.copy.cancellations.useSuggestedWording = false;
    original.copy.cancellations.wordingOverride = 'Please message me if plans change.';

    const refreshed = refreshPolicySuggestedWording({
      ...updateDepositDraft(original, {
        amountCents: 3_000,
        mode: 'fixed',
        refundable: false,
        transferable: true,
      }),
      cancellations: {
        consequence: 'cancellation_fee',
        customConsequence: '',
        customNotice: '',
        notice: '48_hours',
      },
    });

    expect(refreshed.copy.cancellations.suggestedWording).toContain('48 hours');
    expect(refreshed.copy.cancellations.wordingOverride)
      .toBe('Please message me if plans change.');
    expect(refreshed.copy.deposits.suggestedWording).toContain('$30 deposit');
    expect(refreshed.copy.deposits.suggestedWording).toContain('non-refundable');
    expect(deriveDepositPolicySummary(refreshed)).toBe('$30 deposit');
  });

  it('keeps the Daniela fixture seeded with the fixed Production-compatible shape', () => {
    const policies = createDanielaFixtureState().profile.policies;

    expect(policies.cancellations.notice).toBe('24_hours');
    expect(getDepositPolicyMode(policies)).toBe('fixed');
    expect(policies.deposits).toMatchObject({ amountCents: 5_000, mode: 'fixed' });
    expect(deriveDepositPolicySummary(policies)).toBe('$50 deposit');
  });

  it('uses the same deposit mode for cancellation and no-show consequences', () => {
    const original = createDefaultPolicies();
    original.cancellations.notice = '24_hours';
    original.cancellations.consequence = 'deposit_lost';
    original.noShows.loseDeposit = true;

    const noDeposit = updateDepositPolicyMode(original, 'none');
    expect(deriveDepositForfeitWording(noDeposit, 'cancellation')).toBe('');
    expect(derivePolicySuggestedWording(noDeposit, 'cancellations'))
      .toBe('Please cancel or reschedule at least 24 hours before your appointment.');
    expect(derivePolicySuggestedWording(noDeposit, 'no_shows')).toBe('');

    const fixed = updateDepositPolicyMode(noDeposit, 'fixed');
    expect(derivePolicySuggestedWording(fixed, 'cancellations'))
      .toContain('the deposit being lost');
    expect(derivePolicySuggestedWording(fixed, 'no_shows'))
      .toBe('A missed appointment will forfeit the deposit.');
  });

  it('keeps an owner override saved while withholding it under no-deposit mode', () => {
    const policies = createDefaultPolicies();
    policies.copy.deposits.useSuggestedWording = false;
    policies.deposits.wordingOverride = 'A $50 deposit is required.';

    const noDeposit = updateDepositPolicyMode(policies, 'none');
    expect(noDeposit.deposits.wordingOverride).toBe('A $50 deposit is required.');
    expect(getPolicyDisplayWording(noDeposit, 'deposits'))
      .toBe('No deposit is required.');

    const fixed = updateDepositPolicyMode(noDeposit, 'fixed');
    expect(getPolicyDisplayWording(fixed, 'deposits'))
      .toBe('A $50 deposit is required.');
  });

  it('never derives a service-level or percentage deposit claim', () => {
    const policies = updateDepositDraft(createDefaultPolicies(), {
      amountCents: 2_500,
      mode: 'fixed',
    });
    const wording = derivePolicySuggestedWording(policies, 'deposits');

    expect(wording).toContain('$25 deposit');
    expect(wording).not.toMatch(/depending on the service|percentage/iu);
  });

  it('requires every answer needed for meaningful client wording', () => {
    const policies = createDefaultPolicies();
    policies.cancellations.notice = '24_hours';
    expect(isPolicySectionComplete(policies, 'cancellations')).toBe(false);

    policies.cancellations.consequence = 'custom';
    expect(isPolicySectionComplete(policies, 'cancellations')).toBe(false);

    policies.cancellations.customConsequence = 'Please contact me directly.';
    expect(isPolicySectionComplete(policies, 'cancellations')).toBe(true);

    policies.lateArrivals.gracePeriodMinutes = '15';
    expect(isPolicySectionComplete(policies, 'late_arrivals')).toBe(false);
    policies.lateArrivals.shortenService = true;
    policies.lateArrivals.rescheduleAfterLimit = false;
    expect(isPolicySectionComplete(policies, 'late_arrivals')).toBe(true);
  });

  it('only treats visible, meaningful client wording as publishable', () => {
    const policies = createDefaultPolicies();
    expect(hasMeaningfulPublishablePolicies(policies)).toBe(false);

    policies.cancellations.notice = '24_hours';
    policies.cancellations.consequence = 'cancellation_fee';
    expect(hasMeaningfulPublishablePolicies(policies)).toBe(true);

    policies.copy.cancellations.visible = false;
    expect(hasMeaningfulPublishablePolicies(policies)).toBe(false);
  });

  it('turns guest and children facts into natural client sentences', () => {
    const policies = createDefaultPolicies();
    policies.other.guests = 'Guests welcome';
    policies.other.children = 'Children welcome';
    policies.other.appointmentPreparation = 'Please come with bare nails';
    policies.other.outsideRemoval = 'Removing another salon’s work costs an additional $10';

    expect(derivePolicySuggestedWording(policies, 'other')).toBe(
      'Guests and children are welcome. Please come with bare nails. Removing another salon’s work costs an additional $10.',
    );
    expect(derivePolicySuggestedWording(policies, 'other'))
      .not.toMatch(/Guests:|Children:|Appointment preparation:/u);
  });

  it('does not mark an empty custom answer complete', () => {
    const policies = createDefaultPolicies();
    policies.noShows.custom = '';
    policies.repairs.freeRepairWindowDays = '';

    expect(isPolicySectionComplete(policies, 'no_shows')).toBe(false);
    expect(isPolicySectionComplete(policies, 'repairs')).toBe(false);
    expect(isPolicySectionComplete(policies, 'other')).toBe(false);
  });
});
