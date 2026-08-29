import { formatMoney } from '../../booking/helpers';
import { bookingPreferencesPort } from '../integrations/adapters/booking-preferences';
import type { DepositDraft } from '../integrations/contracts/booking-preferences';
import type {
  DepositPolicyMode,
  PoliciesDraft,
  PolicySectionId,
} from './types';

export type { DepositPolicyMode } from './types';

const DEPOSIT_REFERENCE_PATTERN = /\bdeposits?\b/iu;
const sentence = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
};

const joinSentences = (values: Array<string | null | undefined>): string => values
  .map((value) => value?.trim() ?? '')
  .filter(Boolean)
  .map(sentence)
  .join(' ');

export const getDepositPolicyMode = (
  policies: PoliciesDraft,
): DepositPolicyMode => policies.deposits.mode;

export const deriveDepositForfeitWording = (
  policies: PoliciesDraft,
  context: 'cancellation' | 'no_show',
): string => {
  const mode = getDepositPolicyMode(policies);
  if (mode === 'fixed') {
    return context === 'cancellation'
      ? 'Cancellations after the deadline will result in the deposit being lost'
      : 'A missed appointment will forfeit the deposit';
  }
  return '';
};

/**
 * Preserves structured/custom owner text while preventing the customer-facing
 * wording from contradicting the one shared deposit mode.
 */
const resolveDepositAwareWording = (
  policies: PoliciesDraft,
  value: string,
  fallback = '',
): string => {
  const trimmed = value.trim();
  if (!DEPOSIT_REFERENCE_PATTERN.test(trimmed)) return trimmed;

  const mode = getDepositPolicyMode(policies);
  if (mode === 'none') return fallback;
  return trimmed;
};

const cancellationNotice = (policies: PoliciesDraft): string => {
  switch (policies.cancellations.notice) {
    case 'same_day': return 'the same day';
    case '12_hours': return '12 hours';
    case '24_hours': return '24 hours';
    case '48_hours': return '48 hours';
    case '72_hours': return '72 hours';
    case 'custom': return policies.cancellations.customNotice.trim();
    default: return '';
  }
};

const cancellationConsequence = (policies: PoliciesDraft): string => {
  switch (policies.cancellations.consequence) {
    case 'deposit_lost': return deriveDepositForfeitWording(policies, 'cancellation');
    case 'cancellation_fee': return 'Cancellations after the deadline will incur a cancellation fee';
    case 'full_service_charge': return 'Cancellations after the deadline will be charged the full service amount';
    case 'custom': return resolveDepositAwareWording(
      policies,
      policies.cancellations.customConsequence,
      deriveDepositForfeitWording(policies, 'cancellation'),
    );
    default: return '';
  }
};

const deriveCancellations = (policies: PoliciesDraft): string => {
  const notice = cancellationNotice(policies);
  return joinSentences([
    policies.cancellations.notice === 'same_day'
      ? 'Please cancel or reschedule before the day of your appointment'
      : notice ? `Please cancel or reschedule at least ${notice} before your appointment` : '',
    cancellationConsequence(policies),
  ]);
};

const formatDepositAmount = (deposits: PoliciesDraft['deposits']): string =>
  deposits.amountCents === null ? '' : formatMoney(deposits.amountCents);

export const deriveDepositPolicySummary = (policies: PoliciesDraft): string => {
  const mode = getDepositPolicyMode(policies);
  if (mode === 'none') return 'No deposit';
  const amount = formatDepositAmount(policies.deposits);
  return amount ? `${amount} deposit` : 'Fixed deposit';
};

const deriveDeposits = (policies: PoliciesDraft): string => {
  const mode = getDepositPolicyMode(policies);
  if (mode === 'none') return 'No deposit is required.';

  const { deposits } = policies;
  const formattedAmount = formatDepositAmount(deposits);

  return joinSentences([
    formattedAmount
      ? `A ${formattedAmount} deposit is required and is applied to your appointment`
      : 'A deposit is required to reserve your appointment',
    deposits.refundable === null
      ? ''
      : deposits.refundable
        ? 'Deposits are refundable'
        : 'Deposits are non-refundable',
    deposits.transferable === null
      ? ''
      : deposits.transferable
        ? 'Deposits may be transferred to a rescheduled appointment'
        : 'Deposits cannot be transferred to another appointment',
  ]);
};

const deriveLateArrivals = (policies: PoliciesDraft): string => {
  const { gracePeriodMinutes, rescheduleAfterLimit, shortenService } = policies.lateArrivals;
  const minutes = gracePeriodMinutes.trim();
  return joinSentences([
    minutes ? `A ${minutes}-minute grace period is available` : '',
    shortenService === true ? 'Arriving late may shorten your service' : '',
    rescheduleAfterLimit === true
      ? minutes
        ? 'Appointments may need to be rescheduled after that limit'
        : 'Late arrivals may need to be rescheduled'
      : '',
  ]);
};

const deriveNoShows = (policies: PoliciesDraft): string => {
  const depositConsequence = policies.noShows.loseDeposit
    ? deriveDepositForfeitWording(policies, 'no_show')
    : '';
  return joinSentences([
    depositConsequence,
    policies.noShows.fullCharge ? 'The full service amount may be charged' : '',
    policies.noShows.paymentRequiredToRebook
      ? 'Payment is required before another appointment can be booked'
      : '',
    resolveDepositAwareWording(
      policies,
      policies.noShows.custom,
      depositConsequence ? '' : deriveDepositForfeitWording(policies, 'no_show'),
    ),
  ]);
};

const deriveRepairs = (policies: PoliciesDraft): string => {
  if (policies.repairs.noRepairPolicy) return 'Repairs are not offered.';
  const days = policies.repairs.freeRepairWindowDays.trim();
  return joinSentences([
    days ? `Please get in touch within ${days} days if your service needs a repair` : '',
    policies.repairs.conditions,
  ]);
};

const deriveOther = (policies: PoliciesDraft): string => joinSentences([
  policies.other.guests ? `Guests: ${policies.other.guests}` : '',
  policies.other.children ? `Children: ${policies.other.children}` : '',
  policies.other.appointmentPreparation
    ? `Appointment preparation: ${policies.other.appointmentPreparation}`
    : '',
  policies.other.outsideRemoval
    ? `Removal from another salon: ${policies.other.outsideRemoval}`
    : '',
  policies.other.custom,
]);

export const derivePolicySuggestedWording = (
  policies: PoliciesDraft,
  sectionId: PolicySectionId,
): string => {
  switch (sectionId) {
    case 'cancellations': return deriveCancellations(policies);
    case 'deposits': return deriveDeposits(policies);
    case 'late_arrivals': return deriveLateArrivals(policies);
    case 'no_shows': return deriveNoShows(policies);
    case 'repairs': return deriveRepairs(policies);
    case 'other': return deriveOther(policies);
  }
};

/**
 * Returns customer-facing copy without discarding an owner's saved override.
 * A stale deposit-dependent override is withheld when the shared deposit mode
 * makes it contradictory; the refreshed structured suggestion is used instead.
 */
export const getResolvedPolicyWording = (
  policies: PoliciesDraft,
  sectionId: PolicySectionId,
): string => {
  const copy = policies.copy[sectionId];
  const suggested = derivePolicySuggestedWording(policies, sectionId).trim();
  if (copy.useSuggestedWording) return suggested;

  const override = sectionId === 'deposits'
    ? policies.deposits.wordingOverride.trim()
    : copy.wordingOverride.trim();
  return sectionId === 'cancellations'
    || sectionId === 'deposits'
    || sectionId === 'no_shows'
    ? resolveDepositAwareWording(policies, override, suggested)
    : override;
};

export const getPolicyDisplayWording = (
  policies: PoliciesDraft,
  sectionId: PolicySectionId,
): string => policies.copy[sectionId].visible
  ? getResolvedPolicyWording(policies, sectionId)
  : '';

export const refreshPolicySuggestedWording = (
  policies: PoliciesDraft,
): PoliciesDraft => {
  const copy = { ...policies.copy };
  (Object.keys(copy) as PolicySectionId[]).forEach((sectionId) => {
    copy[sectionId] = {
      ...copy[sectionId],
      suggestedWording: derivePolicySuggestedWording(policies, sectionId),
    };
  });
  return { ...policies, copy };
};

export const updateDepositPolicyMode = (
  policies: PoliciesDraft,
  mode: DepositPolicyMode,
): PoliciesDraft => {
  return updateDepositDraft(policies, { mode });
};

export const updateDepositDraft = (
  policies: PoliciesDraft,
  patch: Partial<Omit<DepositDraft, 'legacyV5Archive'>>,
): PoliciesDraft => refreshPolicySuggestedWording({
  ...policies,
  deposits: bookingPreferencesPort.updateDepositDraft(policies.deposits, patch),
});
