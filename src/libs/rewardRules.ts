export const REFERRAL_REFEREE_PERCENT = 25;
export const REFERRAL_REFERRER_AMOUNT_CENTS = 2_500;
export const GOOGLE_REVIEW_REWARD_AMOUNT_CENTS = 1_500;

export const REFERRAL_REFEREE_EXPIRY_DAYS = 14;
export const REFERRAL_REFERRER_EXPIRY_DAYS = 365;

export type RewardDiscountType = 'fixed_amount' | 'percentage' | 'service';

export type RewardWithDiscountShape = {
  type: string;
  points?: number | null;
  eligibleServiceName?: string | null;
  discountType?: RewardDiscountType | null;
  discountAmountCents?: number | null;
  discountPercent?: number | null;
};

export function getRewardDisplayContent(reward: RewardWithDiscountShape): {
  title: string;
  subtitle: string;
  kindLabel: string;
  valueLabel: string | null;
} {
  switch (reward.type) {
    case 'referral_referee':
      return {
        title: `${REFERRAL_REFEREE_PERCENT}% Off Your First Appointment`,
        subtitle: 'Friend referral reward',
        kindLabel: 'Referral Welcome Reward',
        valueLabel: `${REFERRAL_REFEREE_PERCENT}% off`,
      };
    case 'referral_referrer':
      return {
        title: '$25 Off Any Appointment',
        subtitle: 'Earned after your friend completes their first visit',
        kindLabel: 'Referral Reward',
        valueLabel: '$25 off',
      };
    case 'google_review':
      return {
        title: '$15 Off Any Appointment',
        subtitle: 'Manual Google review reward',
        kindLabel: 'Google Review Reward',
        valueLabel: '$15 off',
      };
    default: {
      const fallbackTitle = reward.eligibleServiceName || 'Reward';
      const fallbackValue = reward.discountType === 'percentage'
        ? `${reward.discountPercent ?? 0}% off`
        : reward.discountType === 'fixed_amount'
          ? `$${((reward.discountAmountCents ?? 0) / 100).toFixed(0)} off`
          : reward.points && reward.points > 0
            ? `${reward.points.toLocaleString()} pts`
            : null;

      return {
        title: fallbackTitle,
        subtitle: 'Reward',
        kindLabel: 'Reward',
        valueLabel: fallbackValue,
      };
    }
  }
}

export function calculateRewardDiscountCents(args: {
  reward: RewardWithDiscountShape;
  subtotalBeforeDiscountCents: number;
  services?: Array<{ id: string; name: string; price: number }>;
}): {
  discountAmountCents: number;
  discountedServiceId: string | null;
} {
  const { reward, subtotalBeforeDiscountCents, services = [] } = args;

  if (subtotalBeforeDiscountCents <= 0) {
    return { discountAmountCents: 0, discountedServiceId: null };
  }

  if (reward.discountType === 'fixed_amount') {
    return {
      discountAmountCents: Math.min(reward.discountAmountCents ?? 0, subtotalBeforeDiscountCents),
      discountedServiceId: null,
    };
  }

  if (reward.discountType === 'percentage') {
    const discountAmountCents = Math.floor(
      subtotalBeforeDiscountCents * ((reward.discountPercent ?? 0) / 100),
    );

    return {
      discountAmountCents: Math.min(discountAmountCents, subtotalBeforeDiscountCents),
      discountedServiceId: null,
    };
  }

  const eligibleServiceName = reward.eligibleServiceName?.toLowerCase() || 'gel manicure';
  const matchingService = services.find(
    service => service.name.toLowerCase().includes(eligibleServiceName)
      || eligibleServiceName.includes(service.name.toLowerCase()),
  );

  if (matchingService) {
    return {
      discountAmountCents: Math.min(matchingService.price, subtotalBeforeDiscountCents),
      discountedServiceId: matchingService.id,
    };
  }

  // Legacy fallback for old point-backed rewards.
  const legacyDiscountAmountCents = Math.min(
    Math.floor((reward.points ?? 0) / 5),
    subtotalBeforeDiscountCents,
  );

  return {
    discountAmountCents: legacyDiscountAmountCents,
    discountedServiceId: null,
  };
}
