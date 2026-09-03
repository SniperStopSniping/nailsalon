import { formatMoney } from '../../booking/helpers';
import { bookingPreferencesPort } from '../integrations/adapters/booking-preferences';
import type { DepositDraft } from '../integrations/contracts/booking-preferences';
import type {
  CancellationConsequence,
  DepositPolicyMode,
  PoliciesDraft,
  PolicySectionId,
} from './types';

export type { DepositPolicyMode } from './types';

const DEPOSIT_REFERENCE_PATTERN = /\bdeposits?\b/iu;
const NO_DEPOSIT_CLAIM_PATTERN = /(?:\bno\s+deposits?\b|\bwithout\s+(?:a\s+)?deposit\b|\bdo(?:es)?n['’]?t\s+require\s+(?:a\s+)?deposit\b|\bdeposits?\s+(?:is|are)\s+not\s+required\b)/iu;
const FIXED_DEPOSIT_AMOUNT_PATTERN = /\$(\d+(?:\.\d{1,2})?)\s+deposit\b/iu;
export const LATE_CANCELLATION_CUSTOM_WORDING = {
  case_by_case: 'Handle the late cancellation case by case',
  move_deposit: 'Move the deposit to a new appointment',
  refund_deposit: 'Refund the deposit after a late cancellation',
} as const;

export type LateCancellationChoice =
  | ''
  | CancellationConsequence
  | keyof typeof LATE_CANCELLATION_CUSTOM_WORDING;

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
  if (NO_DEPOSIT_CLAIM_PATTERN.test(trimmed)) return fallback;

  const statedAmount = trimmed.match(FIXED_DEPOSIT_AMOUNT_PATTERN)?.[1];
  if (statedAmount && policies.deposits.amountCents !== null) {
    const statedAmountCents = Math.round(Number(statedAmount) * 100);
    if (statedAmountCents !== policies.deposits.amountCents) return fallback;
  }
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

const noticeModifier = (value: string): string => {
  if (/^1\s+(?:hour|day)$/iu.test(value)) return `${value}’s`;
  if (/^\d+\s+(?:hours|days)$/iu.test(value)) return `${value}’`;
  return value;
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

export const getLateCancellationChoice = (
  policies: PoliciesDraft,
): LateCancellationChoice => {
  const consequence = policies.cancellations.consequence;
  if (!consequence) return '';
  if (consequence === 'deposit_lost') {
    return getDepositPolicyMode(policies) === 'fixed' ? consequence : '';
  }
  if (consequence !== 'custom') return consequence;

  const custom = policies.cancellations.customConsequence.trim();
  const preset = Object.entries(LATE_CANCELLATION_CUSTOM_WORDING).find(
    ([, wording]) => wording === custom,
  );
  if (preset) {
    const choice = preset[0] as keyof typeof LATE_CANCELLATION_CUSTOM_WORDING;
    return getDepositPolicyMode(policies) === 'none'
      && (choice === 'move_deposit' || choice === 'refund_deposit')
      ? ''
      : choice;
  }
  return resolveDepositAwareWording(policies, custom) ? 'custom' : '';
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

const cancellationNoticeSummary = (policies: PoliciesDraft): string => {
  switch (policies.cancellations.notice) {
    case 'same_day': return 'Same-day notice';
    case '12_hours': return '12 hours’ notice';
    case '24_hours': return '24 hours’ notice';
    case '48_hours': return '48 hours’ notice';
    case '72_hours': return '72 hours’ notice';
    case 'custom': return policies.cancellations.customNotice.trim();
    default: return '';
  }
};

const lateCancellationSummary = (policies: PoliciesDraft): string => {
  switch (getLateCancellationChoice(policies)) {
    case 'deposit_lost': return 'deposit kept after late cancellation';
    case 'move_deposit': return 'deposit moved after late cancellation';
    case 'refund_deposit': return 'deposit refunded after late cancellation';
    case 'case_by_case': return 'late cancellations handled case by case';
    case 'cancellation_fee': return 'cancellation fee after the deadline';
    case 'full_service_charge': return 'full service price after the deadline';
    case 'custom': return policies.cancellations.customConsequence.trim();
    default: return '';
  }
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

const deriveCombinedLateCancellation = (policies: PoliciesDraft): string => {
  switch (getLateCancellationChoice(policies)) {
    case 'deposit_lost': return 'Deposits are kept after late cancellations';
    case 'move_deposit': return 'After a late cancellation, the deposit can be moved to a new appointment';
    case 'refund_deposit': return 'Deposits are refunded after late cancellations';
    case 'case_by_case': return 'Late cancellations are handled case by case';
    case 'cancellation_fee': return 'Late cancellations incur a cancellation fee';
    case 'full_service_charge': return 'Late cancellations are charged the full service price';
    case 'custom': return resolveDepositAwareWording(
      policies,
      policies.cancellations.customConsequence,
    );
    default: return '';
  }
};

export const deriveDepositsAndCancellationsSuggestedWording = (
  policies: PoliciesDraft,
): string => {
  const mode = getDepositPolicyMode(policies);
  const notice = cancellationNotice(policies);
  const amount = formatDepositAmount(policies.deposits);
  return joinSentences([
    mode === 'none'
      ? 'No deposit is required'
      : amount
        ? `A ${amount} deposit is required to book`
        : 'A deposit is required to book',
    policies.cancellations.notice === 'same_day'
      ? 'Please cancel or reschedule before the day of your appointment'
      : notice
        ? `Please provide at least ${noticeModifier(notice)} notice when cancelling or rescheduling`
        : '',
    deriveCombinedLateCancellation(policies),
    mode === 'fixed' && policies.deposits.refundable !== null
      ? policies.deposits.refundable
        ? 'Before the deadline, deposits are refundable'
        : 'Before the deadline, deposits are non-refundable'
      : '',
    mode === 'fixed' && policies.deposits.transferable !== null
      ? policies.deposits.transferable
        ? 'Before the deadline, deposits can be moved to a rescheduled appointment'
        : 'Before the deadline, deposits cannot be moved to another appointment'
      : '',
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
  policies.other.guests === 'No guests'
    ? 'Please come to your appointment without guests'
    : policies.other.guests === 'One guest allowed'
      ? 'You’re welcome to bring one guest'
      : policies.other.guests === 'Guests welcome'
        ? policies.other.children === 'Children welcome'
          ? 'Guests and children are welcome'
          : 'Guests are welcome'
        : policies.other.guests,
  policies.other.children === 'Children welcome'
    ? policies.other.guests === 'Guests welcome' ? '' : 'Children are welcome'
    : policies.other.children === 'No children unless receiving a service'
      ? 'Please bring children only when they are receiving a service'
      : policies.other.children === 'Please arrange childcare'
        ? 'Please arrange childcare before your appointment'
        : policies.other.children,
  policies.other.appointmentPreparation,
  policies.other.outsideRemoval,
  policies.other.custom,
]);

const hasCancellationNotice = (policies: PoliciesDraft): boolean => {
  if (!policies.cancellations.notice) return false;
  return policies.cancellations.notice !== 'custom'
    || Boolean(policies.cancellations.customNotice.trim());
};

const hasCancellationConsequence = (policies: PoliciesDraft): boolean => {
  return Boolean(getLateCancellationChoice(policies));
};

/**
 * A policy is complete only when its structured answers can produce useful,
 * owner-approved client wording. This deliberately does not treat a lone
 * partial answer or an empty “Something else” choice as complete.
 */
export const isPolicySectionComplete = (
  policies: PoliciesDraft,
  sectionId: PolicySectionId,
): boolean => {
  switch (sectionId) {
    case 'cancellations':
      return hasCancellationNotice(policies) && hasCancellationConsequence(policies);
    case 'deposits':
      return getDepositPolicyMode(policies) === 'none'
        || (policies.deposits.amountCents !== null
          && policies.deposits.refundable !== null
          && policies.deposits.transferable !== null);
    case 'late_arrivals':
      return Boolean(policies.lateArrivals.gracePeriodMinutes.trim())
        && policies.lateArrivals.shortenService !== null
        && policies.lateArrivals.rescheduleAfterLimit !== null;
    case 'no_shows': {
      const hasPreset = policies.noShows.loseDeposit
        ? getDepositPolicyMode(policies) === 'fixed'
        : policies.noShows.fullCharge || policies.noShows.paymentRequiredToRebook;
      return hasPreset || Boolean(policies.noShows.custom.trim());
    }
    case 'repairs':
      return policies.repairs.noRepairPolicy
        || Boolean(policies.repairs.freeRepairWindowDays.trim());
    case 'other':
      return [
        policies.other.guests,
        policies.other.children,
        policies.other.appointmentPreparation,
        policies.other.outsideRemoval,
        policies.other.custom,
      ].some((value) => Boolean(value.trim()));
  }
};

export const isDepositsAndCancellationsComplete = (
  policies: PoliciesDraft,
): boolean => isPolicySectionComplete(policies, 'deposits')
  && isPolicySectionComplete(policies, 'cancellations');

export const deriveDepositsAndCancellationsSummary = (
  policies: PoliciesDraft,
): string => {
  if (!isDepositsAndCancellationsComplete(policies)) {
    return 'Finish your deposit and cancellation rules';
  }

  const summary = [
    deriveDepositPolicySummary(policies),
    cancellationNoticeSummary(policies),
  ];
  if (getDepositPolicyMode(policies) === 'fixed') {
    summary.push(lateCancellationSummary(policies));
  }
  return summary.filter(Boolean).join(' · ');
};

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

export const isDepositsAndCancellationsVisible = (
  policies: PoliciesDraft,
): boolean => policies.copy.deposits.visible || policies.copy.cancellations.visible;

/**
 * Reads the two legacy copy records as a single customer policy without
 * collapsing either record or discarding either owner-authored override.
 */
export const getDepositsAndCancellationsDisplayWording = (
  policies: PoliciesDraft,
): string => {
  const depositsVisible = policies.copy.deposits.visible;
  const cancellationsVisible = policies.copy.cancellations.visible;
  if (!depositsVisible && !cancellationsVisible) return '';

  if (
    depositsVisible
    && cancellationsVisible
    && policies.copy.deposits.useSuggestedWording
    && policies.copy.cancellations.useSuggestedWording
  ) {
    return deriveDepositsAndCancellationsSuggestedWording(policies);
  }

  return [
    depositsVisible ? getResolvedPolicyWording(policies, 'deposits') : '',
    cancellationsVisible ? getResolvedPolicyWording(policies, 'cancellations') : '',
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(' ');
};

/**
 * Customer policy presentation waits for all required answers. Draft editors
 * and the transactional Booking deposit disclosure retain their own wording.
 */
export const getPublicPolicyDisplayWording = (
  policies: PoliciesDraft,
  sectionId: PolicySectionId,
): string => isPolicySectionComplete(policies, sectionId)
  ? getPolicyDisplayWording(policies, sectionId)
  : '';

export const getPublicDepositsAndCancellationsDisplayWording = (
  policies: PoliciesDraft,
): string => isDepositsAndCancellationsComplete(policies)
  ? getDepositsAndCancellationsDisplayWording(policies)
  : '';

/**
 * Whether Save policies has at least one visible, customer-ready policy to
 * publish. The master recipe flag deliberately is not part of this decision:
 * saving meaningful content is what may turn that one existing flag back on.
 */
export const hasMeaningfulPublishablePolicies = (
  policies: PoliciesDraft,
): boolean => (
  isDepositsAndCancellationsComplete(policies)
  && isDepositsAndCancellationsVisible(policies)
  && Boolean(getDepositsAndCancellationsDisplayWording(policies).trim())
) || (
  ['late_arrivals', 'no_shows', 'repairs', 'other'] as const
).some((sectionId) => (
  policies.copy[sectionId].visible
  && isPolicySectionComplete(policies, sectionId)
  && Boolean(getResolvedPolicyWording(policies, sectionId).trim())
));

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
