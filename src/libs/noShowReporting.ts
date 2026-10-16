import { z } from 'zod';

export const NO_SHOW_REASONS = [
  ['did_not_attend', 'Customer did not attend'],
  ['late_cancellation', 'Customer cancelled with insufficient notice'],
  ['confirmed_nonattendance', 'Customer confirmed they would not attend when contacted by the salon'],
  ['other', 'Other'],
] as const;

export const noShowReportSchema = z.object({
  reason: z.enum(['did_not_attend', 'late_cancellation', 'confirmed_nonattendance', 'other']),
  explanation: z.string().trim().max(500).optional(),
  privateNote: z.string().trim().max(1000).optional(),
}).strict().superRefine((value, context) => {
  if (value.reason === 'other' && !value.explanation?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['explanation'], message: 'Explain the other reason.' });
  }
});

export type NoShowReport = z.infer<typeof noShowReportSchema>;
const PRE_APPOINTMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Canonical UTC instants represent salon-local scheduling, including DST.
 * This is 24 elapsed hours, never the previous local calendar day.
 */
export function isNoShowWindowOpen(startTime: Date | string, now = new Date()): boolean {
  const startMs = new Date(startTime).getTime();
  return Number.isFinite(startMs) && startMs - now.getTime() <= PRE_APPOINTMENT_WINDOW_MS;
}

export class NoShowReportingError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function validateNoShowReport(startTime: Date, report: unknown, now: Date): NoShowReport {
  if (!isNoShowWindowOpen(startTime, now)) {
    throw new NoShowReportingError('NO_SHOW_TOO_EARLY', 'No-show reporting opens 24 hours before the scheduled appointment.');
  }
  const parsed = noShowReportSchema.safeParse(report);
  if (!parsed.success) {
    throw new NoShowReportingError('NO_SHOW_REASON_REQUIRED', 'Select a no-show reason. Other requires an explanation.');
  }
  if (now < startTime && !['late_cancellation', 'confirmed_nonattendance'].includes(parsed.data.reason)) {
    throw new NoShowReportingError('NO_SHOW_NONATTENDANCE_REQUIRED', 'Before the appointment starts, record an explicit late cancellation or confirmed nonattendance.');
  }
  return parsed.data;
}
