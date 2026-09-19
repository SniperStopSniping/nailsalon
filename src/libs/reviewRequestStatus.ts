import type { ReviewAutomationMode } from '@/libs/reviewAutomationPolicy';

export type ReviewRequestDisplayStatus = 'not_eligible' | 'eligible' | 'awaiting_trigger' | 'scheduled' | 'sent' | 'delivered' | 'suppressed' | 'failed' | 'cancelled' | 'sending' | 'unknown' | 'skipped' | 'reported_sent';

/** Read-only owner projection. A reported send is not provider delivery evidence. */
export type ReviewRequestDisplay = {
  status: ReviewRequestDisplayStatus;
  reason: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  message: string | null;
  phone: string | null;
  clientId: string | null;
  source: 'automatic' | 'manual' | 'owner_reported' | null;
  channel: 'sms' | 'owner_device' | null;
  canSendManually: boolean;
  automationMode: ReviewAutomationMode;
};

export type ClientReviewHistoryItem = ReviewRequestDisplay & {
  id: string;
  appointmentId: string | null;
  occurredAt: string;
};

export type ClientReviewOverview = {
  timeZone: string;
  reviewRequestsSuppressed: boolean;
  history: ClientReviewHistoryItem[];
  hasMore: boolean;
};
