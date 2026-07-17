export const RETENTION_STAGES = [
  'rebook',
  'promo_6w',
  'promo_8w',
] as const;

export type RetentionStage = (typeof RETENTION_STAGES)[number];

export const CLIENT_COMMUNICATION_KINDS = [
  'generic_text',
  'rebook',
  'reminder',
  'appointment_details',
  'directions',
  'satisfaction',
  'google_review',
  'promo_6w',
  'promo_8w',
] as const;

export type ClientCommunicationKind = (typeof CLIENT_COMMUNICATION_KINDS)[number];

export const CLIENT_COMMUNICATION_STATUSES = [
  'prepared',
  'marked_sent',
  'not_sent',
  'snoozed',
  'dismissed',
  'converted',
] as const;

export type ClientCommunicationStatus = (typeof CLIENT_COMMUNICATION_STATUSES)[number];

/** Retention and win-back alerts intentionally stay out of the queue for a week. */
export const RETENTION_SNOOZE_DAYS = 7;

/** Appointment reminders return quickly enough to remain useful before the visit. */
export const REMINDER_SNOOZE_HOURS = 3;

export type RetentionDiscountType = 'percent' | 'fixed';

/**
 * A promotion is snapshotted onto each campaign so settings can be edited
 * without changing links that have already been sent to clients.
 */
export type RetentionPromotionSettings = {
  enabled: boolean;
  name: string;
  discountType: RetentionDiscountType;
  /** Percent (1-100) or fixed amount in cents, depending on discountType. */
  value: number;
  eligibleServiceIds: string[];
  expiryDays: number;
  code: string | null;
  messageTemplate: string;
  singleUse: boolean;
};

export type RetentionSettings = {
  defaultRebookDays: number;
  reminderLeadHours: number;
  googleReviewUrl: string | null;
  parkingInstructions: string | null;
  sixWeekPromotion: RetentionPromotionSettings;
  eightWeekPromotion: RetentionPromotionSettings;
};

export type RetentionCampaignSnapshot = {
  stage: Extract<RetentionStage, 'promo_6w' | 'promo_8w'>;
  promotion: RetentionPromotionSettings;
};

export type ClientCommunicationMetadata = {
  reason?: string;
  campaignId?: string;
  campaignStage?: RetentionStage;
  bookingUrl?: string;
  [key: string]: unknown;
};
