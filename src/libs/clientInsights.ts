import type { ClientInsightSegmentId } from '@/types/clientInsights';

export const CLIENT_INSIGHTS_RULES_VERSION = '2026-07-24';
export const CLIENT_INSIGHTS_ATTENTION_LIMIT = 12;

/**
 * One ordering owns both the attention queue priority and its displayed
 * primary reason. Segment membership itself is calculated by the canonical
 * tenant-scoped SQL projection in clientInsights.server.ts.
 */
export const CLIENT_INSIGHTS_ATTENTION_PRIORITY: ClientInsightSegmentId[] = [
  'recent_cancellation',
  'overdue',
  'due_now',
  'due_soon',
  'first_time_no_return',
  'completed_outstanding',
  'inactive_90',
  'no_future_appointment',
  'not_seen_60',
  'not_seen_30',
];
