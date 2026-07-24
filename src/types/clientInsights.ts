import type { RetentionStage } from '@/types/retention';

export const CLIENT_INSIGHT_SEGMENT_IDS = [
  'active',
  'new_this_month',
  'rebooked',
  'due_to_return',
  'due_soon',
  'due_now',
  'overdue',
  'needs_rebooking',
  'no_future_appointment',
  'first_time_no_return',
  'recent_cancellation',
  'not_seen_30',
  'not_seen_60',
  'inactive_90',
  'completed_outstanding',
] as const;

export type ClientInsightSegmentId = (typeof CLIENT_INSIGHT_SEGMENT_IDS)[number];

export const CLIENT_INSIGHT_SEGMENT_LABELS: Record<ClientInsightSegmentId, string> = {
  active: 'Active clients',
  new_this_month: 'New this month',
  rebooked: 'Rebooked',
  due_to_return: 'Due to return',
  due_soon: 'Due soon',
  due_now: 'Due now',
  overdue: 'Overdue',
  needs_rebooking: 'Needs rebooking',
  no_future_appointment: 'No future appointment',
  first_time_no_return: 'First-time clients who did not return',
  recent_cancellation: 'Recent cancellations to reschedule',
  not_seen_30: 'Not seen in 30 days',
  not_seen_60: 'Not seen in 60 days',
  inactive_90: 'Inactive 90+ days',
  completed_outstanding: 'Completed outstanding balance',
};

export type ClientInsightKpiId =
  | 'active'
  | 'new_this_month'
  | 'due_to_return'
  | 'overdue';

export type ClientInsightAttentionItem = {
  clientId: string;
  clientName: string | null;
  phone: string;
  email: string | null;
  primaryReason: ClientInsightSegmentId;
  reasons: ClientInsightSegmentId[];
  lastVisitAt: string | null;
  expectedReturnAt: string | null;
  completedOutstandingCents: number;
  outreachStage: RetentionStage | null;
};

export type ClientInsightsData = {
  generatedAt: string;
  timeZone: string;
  rulesVersion: string;
  kpis: Record<ClientInsightKpiId, number>;
  segments: Array<{
    id: ClientInsightSegmentId;
    label: string;
    count: number;
  }>;
  attention: {
    total: number;
    items: ClientInsightAttentionItem[];
  };
};
