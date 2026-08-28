import type {
  PoliciesDraft,
  PolicySectionId,
} from './types';

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

const cancellationNotice = (policies: PoliciesDraft): string => {
  switch (policies.cancellations.notice) {
    case '12_hours': return '12 hours';
    case '24_hours': return '24 hours';
    case '48_hours': return '48 hours';
    case 'custom': return policies.cancellations.customNotice.trim();
    default: return '';
  }
};

const cancellationConsequence = (policies: PoliciesDraft): string => {
  switch (policies.cancellations.consequence) {
    case 'deposit_lost': return 'Cancellations after the deadline will result in the deposit being lost';
    case 'cancellation_fee': return 'Cancellations after the deadline will incur a cancellation fee';
    case 'full_service_charge': return 'Cancellations after the deadline will be charged the full service amount';
    case 'custom': return policies.cancellations.customConsequence.trim();
    default: return '';
  }
};

const deriveCancellations = (policies: PoliciesDraft): string => {
  const notice = cancellationNotice(policies);
  return joinSentences([
    notice ? `Please cancel or reschedule at least ${notice} before your appointment` : '',
    cancellationConsequence(policies),
  ]);
};

const deriveDeposits = (policies: PoliciesDraft): string => {
  const { amount, amountType, refundable, required, transferable } = policies.deposits;
  if (required === null) return '';
  if (!required) return 'No deposit is required.';

  const cleanAmount = amount.trim().replace(/^[$%]/u, '').replace(/%$/u, '');
  const formattedAmount = cleanAmount
    ? amountType === 'percentage' ? `${cleanAmount}%` : `$${cleanAmount}`
    : '';

  return joinSentences([
    formattedAmount
      ? `A ${formattedAmount} deposit is required and is applied to your appointment`
      : 'A deposit is required to reserve your appointment',
    refundable === null ? '' : refundable ? 'Deposits are refundable' : 'Deposits are non-refundable',
    transferable === null
      ? ''
      : transferable
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

const deriveNoShows = (policies: PoliciesDraft): string => joinSentences([
  policies.noShows.loseDeposit ? 'A missed appointment will forfeit the deposit' : '',
  policies.noShows.fullCharge ? 'The full service amount may be charged' : '',
  policies.noShows.paymentRequiredToRebook
    ? 'Payment is required before another appointment can be booked'
    : '',
  policies.noShows.custom,
]);

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
