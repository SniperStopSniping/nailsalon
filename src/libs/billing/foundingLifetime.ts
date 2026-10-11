/** Public terms for the core-software offer. Usage purchases are independent. */
export const FOUNDING_LIFETIME_OFFER_KEY = 'founding_lifetime_2026' as const;
export const FOUNDING_LIFETIME_TERMS_VERSION = 2 as const;

export const FOUNDING_LIFETIME_TERMS = {
  coreSoftwareMonthlyPriceCents: 0,
  coreSoftwareAccess: 'lifetime',
  emails: 'unlimited',
  starterTextCredits: 100,
  starterTextCreditsFrequency: 'once_per_verified_business',
  additionalTexts: 'paid_separately',
  purchasedTextCreditsExpire: false,
  claimDeadline: null,
} as const;

// Stored v1 terms remain historical evidence; changing the current policy
// must never rewrite a salon's existing claim or reset its text allowance.
type LegacyFoundingLifetimeTerms = Omit<typeof FOUNDING_LIFETIME_TERMS, 'purchasedTextCreditsExpire' | 'claimDeadline'> & {
  aiReceptionist: 'paid_separately';
  phoneUsage: 'paid_separately';
  otherUsageServices: 'paid_separately';
  claimDeadline: string;
  deadlineTimeZone: 'America/Toronto';
};

export type FoundingLifetimeTerms = typeof FOUNDING_LIFETIME_TERMS | LegacyFoundingLifetimeTerms;

export type FoundingLifetimeAccess = {
  status: 'active';
  offerKey: typeof FOUNDING_LIFETIME_OFFER_KEY;
  claimedAt: string;
  expiresAt: null;
  monthlySoftwarePriceCents: 0;
  usageBilledSeparately: true;
};

export function isFoundingLifetimeOfferOpen(now: Date = new Date()): boolean {
  // Keep the existing API/offer identifier for saved setups. Free core access
  // has no acquisition deadline; only an invalid clock value is rejected.
  return Number.isFinite(now.getTime());
}
