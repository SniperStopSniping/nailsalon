/** Public terms for the core-software offer. Usage purchases are independent. */
export const FOUNDING_LIFETIME_OFFER_KEY = 'founding_lifetime_2026' as const;
export const FOUNDING_LIFETIME_TERMS_VERSION = 1 as const;

// "By January 1" includes the entire advertised date in Luster's Toronto
// business timezone. Store an instant so the server's timezone cannot alter it.
export const FOUNDING_LIFETIME_CLAIM_DEADLINE = '2027-01-02T05:00:00.000Z';

export const FOUNDING_LIFETIME_TERMS = {
  coreSoftwareMonthlyPriceCents: 0,
  coreSoftwareAccess: 'lifetime',
  emails: 'unlimited',
  starterTextCredits: 100,
  starterTextCreditsFrequency: 'once_per_verified_business',
  additionalTexts: 'paid_separately',
  aiReceptionist: 'paid_separately',
  phoneUsage: 'paid_separately',
  otherUsageServices: 'paid_separately',
  claimDeadline: FOUNDING_LIFETIME_CLAIM_DEADLINE,
  deadlineTimeZone: 'America/Toronto',
} as const;

export type FoundingLifetimeAccess = {
  status: 'active';
  offerKey: typeof FOUNDING_LIFETIME_OFFER_KEY;
  claimedAt: string;
  expiresAt: null;
  monthlySoftwarePriceCents: 0;
  usageBilledSeparately: true;
};

export function isFoundingLifetimeOfferOpen(now: Date = new Date()): boolean {
  return Number.isFinite(now.getTime())
    && now.getTime() < Date.parse(FOUNDING_LIFETIME_CLAIM_DEADLINE);
}
