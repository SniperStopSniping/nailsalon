import { describe, expect, it } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import { createDefaultPolicies } from './defaults';
import {
  deriveDepositsAndCancellationsSuggestedWording,
  deriveDepositsAndCancellationsSummary,
  deriveDepositForfeitWording,
  deriveDepositPolicySummary,
  derivePolicySuggestedWording,
  getDepositsAndCancellationsDisplayWording,
  getDepositPolicyMode,
  getLateCancellationChoice,
  getPolicyDisplayWording,
  getPublicDepositsAndCancellationsDisplayWording,
  getPublicPolicyDisplayWording,
  getResolvedPolicyWording,
  hasMeaningfulPublishablePolicies,
  isDepositsAndCancellationsComplete,
  isPolicySectionComplete,
  LATE_CANCELLATION_CUSTOM_WORDING,
  refreshPolicySuggestedWording,
  updateDepositDraft,
  updateDepositPolicyMode,
} from './policies';

describe('policy suggested wording', () => {
  it('withholds partially configured public policies without deleting draft wording', () => {
    const policies = createDefaultPolicies();
    policies.cancellations.notice = '24_hours';
    policies.lateArrivals.gracePeriodMinutes = '15';
    policies.repairs.conditions = 'Bring a photo of the affected nail';
    const savedDraft = structuredClone(policies);

    expect(getPublicDepositsAndCancellationsDisplayWording(policies)).toBe('');

    expect(getPublicPolicyDisplayWording(policies, 'late_arrivals')).toBe('');

    expect(getPublicPolicyDisplayWording(policies, 'repairs')).toBe('');

    expect(getResolvedPolicyWording(policies, 'late_arrivals')).toContain('15-minute');

    expect(getResolvedPolicyWording(policies, 'repairs')).toContain('Bring a photo');

    expect(getPolicyDisplayWording(policies, 'deposits')).toBe('No deposit is required.');

    expect(policies).toEqual(savedDraft);

    policies.cancellations.consequence = 'cancellation_fee';
    policies.lateArrivals.shortenService = false;
    policies.lateArrivals.rescheduleAfterLimit = true;
    policies.repairs.freeRepairWindowDays = '3';

    expect(getPublicDepositsAndCancellationsDisplayWording(policies)).toContain('24 hours');

    expect(getPublicPolicyDisplayWording(policies, 'late_arrivals')).toContain('15-minute');

    expect(getPublicPolicyDisplayWording(policies, 'repairs')).toContain('within 3 days');
  });

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

  it('derives one complete fixed-deposit and cancellation policy', () => {
    const policies = updateDepositDraft(createDefaultPolicies(), {
      amountCents: 1_500,
      mode: 'fixed',
      refundable: false,
      transferable: false,
    });
    policies.cancellations.notice = '24_hours';
    policies.cancellations.consequence = 'deposit_lost';

    expect(isDepositsAndCancellationsComplete(policies)).toBe(true);
    expect(deriveDepositsAndCancellationsSummary(policies)).toBe(
      '$15 deposit · 24 hours’ notice · deposit kept after late cancellation',
    );
    expect(deriveDepositsAndCancellationsSuggestedWording(policies)).toBe(
      'A $15 deposit is required to book. Please provide at least 24 hours’ notice when cancelling or rescheduling. Deposits are kept after late cancellations. Before the deadline, deposits are non-refundable. Before the deadline, deposits cannot be moved to another appointment.',
    );
  });

  it('hides deposit-only rules in no-deposit mode without deleting legacy answers', () => {
    const policies = createDefaultPolicies();
    policies.cancellations.notice = '24_hours';
    policies.cancellations.consequence = 'deposit_lost';
    policies.deposits.refundable = false;
    policies.deposits.transferable = false;

    expect(getLateCancellationChoice(policies)).toBe('');
    expect(isDepositsAndCancellationsComplete(policies)).toBe(false);
    expect(deriveDepositsAndCancellationsSummary(policies)).toBe(
      'Finish your deposit and cancellation rules',
    );
    expect(deriveDepositsAndCancellationsSuggestedWording(policies))
      .toBe('No deposit is required. Please provide at least 24 hours’ notice when cancelling or rescheduling.');
    expect(policies.cancellations.consequence).toBe('deposit_lost');
    expect(policies.deposits.refundable).toBe(false);

    policies.cancellations.consequence = 'cancellation_fee';
    expect(isDepositsAndCancellationsComplete(policies)).toBe(true);
    expect(deriveDepositsAndCancellationsSummary(policies))
      .toBe('No deposit · 24 hours’ notice');
  });

  it('maps richer late-cancellation choices onto existing custom consequence storage', () => {
    const policies = updateDepositDraft(createDefaultPolicies(), {
      amountCents: 1_500,
      mode: 'fixed',
    });
    policies.cancellations.consequence = 'custom';
    policies.cancellations.customConsequence =
      LATE_CANCELLATION_CUSTOM_WORDING.move_deposit;

    expect(getLateCancellationChoice(policies)).toBe('move_deposit');
    expect(deriveDepositsAndCancellationsSuggestedWording(policies))
      .toContain('the deposit can be moved to a new appointment');

    policies.deposits.mode = 'none';
    expect(getLateCancellationChoice(policies)).toBe('');
    expect(policies.cancellations.customConsequence)
      .toBe(LATE_CANCELLATION_CUSTOM_WORDING.move_deposit);
  });

  it('combines distinct legacy overrides without collapsing either copy record', () => {
    const policies = createDefaultPolicies();
    policies.deposits.mode = 'fixed';
    policies.copy.deposits.useSuggestedWording = false;
    policies.copy.cancellations.useSuggestedWording = false;
    policies.deposits.wordingOverride = 'Legacy deposit wording.';
    policies.copy.cancellations.wordingOverride = 'Legacy cancellation wording.';

    expect(getDepositsAndCancellationsDisplayWording(policies)).toBe(
      'Legacy deposit wording. Legacy cancellation wording.',
    );
    expect(policies.copy.deposits.wordingOverride).toBe('');
    expect(policies.deposits.wordingOverride).toBe('Legacy deposit wording.');
    expect(policies.copy.cancellations.wordingOverride)
      .toBe('Legacy cancellation wording.');
  });

  it('retains but withholds a contradictory no-deposit override after Booking enables a fixed deposit', () => {
    const policies = createDefaultPolicies();
    policies.copy.deposits.useSuggestedWording = false;
    policies.deposits.wordingOverride = 'No deposit is required.';

    const fixedPolicies = updateDepositDraft(policies, {
      amountCents: 1_500,
      mode: 'fixed',
      refundable: false,
      transferable: false,
    });

    expect(getResolvedPolicyWording(fixedPolicies, 'deposits'))
      .toBe('A $15 deposit is required and is applied to your appointment. Deposits are non-refundable. Deposits cannot be transferred to another appointment.');
    expect(fixedPolicies.deposits.wordingOverride).toBe('No deposit is required.');
    expect(fixedPolicies.copy.deposits.useSuggestedWording).toBe(false);
  });

  it('retains but withholds a fixed-deposit override after Booking changes the amount', () => {
    const policies = updateDepositDraft(createDefaultPolicies(), {
      amountCents: 1_500,
      mode: 'fixed',
      refundable: false,
      transferable: false,
    });
    policies.copy.deposits.useSuggestedWording = false;
    policies.deposits.wordingOverride = 'A $15 deposit is required to book.';

    const updatedPolicies = updateDepositDraft(policies, { amountCents: 5_000 });

    expect(getResolvedPolicyWording(updatedPolicies, 'deposits'))
      .toBe('A $50 deposit is required and is applied to your appointment. Deposits are non-refundable. Deposits cannot be transferred to another appointment.');
    expect(updatedPolicies.deposits.wordingOverride)
      .toBe('A $15 deposit is required to book.');
  });

  it('only treats visible, meaningful client wording as publishable', () => {
    const policies = createDefaultPolicies();
    expect(hasMeaningfulPublishablePolicies(policies)).toBe(false);

    policies.cancellations.notice = '24_hours';
    policies.cancellations.consequence = 'cancellation_fee';
    expect(hasMeaningfulPublishablePolicies(policies)).toBe(true);

    policies.copy.cancellations.visible = false;
    policies.copy.deposits.visible = false;
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
