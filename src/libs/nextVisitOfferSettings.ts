export const NEXT_VISIT_OFFER_WINDOW_PRESETS = [14, 21, 28, 30, 42] as const;

export type NextVisitOfferSettings = {
  enabled: boolean;
  windowDays: number;
  discountType: 'percent' | 'fixed';
  /** Percent or cents, according to discountType. */
  value: number;
  /** An empty array means every base service is eligible. */
  eligibleServiceIds: string[];
  /** Shown alongside the offer; it does not need to contain a booking link. */
  messageTemplate: string;
};

export const DEFAULT_NEXT_VISIT_OFFER_SETTINGS: NextVisitOfferSettings = {
  enabled: false,
  windowDays: 30,
  discountType: 'percent',
  value: 5,
  eligibleServiceIds: [],
  messageTemplate: 'We look forward to seeing you for your next visit.',
};
