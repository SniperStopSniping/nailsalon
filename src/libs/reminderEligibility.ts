import 'server-only';

import { and, eq, isNull, or, type SQL } from 'drizzle-orm';

import { appointmentSchema } from '@/models/Schema';

/**
 * Luster L1 PR5 — F. Reminder eligibility for the `appointmentReminders.ts`
 * pipeline.
 *
 * Before this module, "does this appointment get reminders?" was answered by
 * a bare `status IN ('pending', 'confirmed')` membership test at three call
 * sites in `appointmentReminders.ts`: the candidate QUERY
 * (`loadReminderCandidates`), the per-candidate freshness RE-CHECK
 * (`isCurrentReminderCandidate`), and the `markReminderSent` CAS. That
 * predicate was always correct because, exactly as `appointmentBlocking.ts`
 * documents, every `'pending'` row in production has a NULL
 * `request_expires_at` — "status is pending" and "status is pending AND
 * unapproved" have always meant the same thing.
 *
 * L1's request-approval flow can now populate `request_expires_at` on a
 * `'pending'` row. An unapproved explicit request has NOT been accepted by
 * the salon yet — sending "see you tomorrow!" before anyone confirmed it
 * would be actively misleading, independent of whether the deadline has
 * already lapsed (an expired-but-not-yet-swept request is even less
 * appropriate to remind about, not more). A LEGACY `pending` row
 * (`request_expires_at IS NULL`) is completely unaffected: it keeps
 * receiving reminders exactly as it always has — this module changes
 * nothing for it.
 *
 * THE PREDICATE (both forms below MUST agree — see the differential test in
 * `reminderEligibility.test.ts`):
 *
 *   status = 'confirmed'
 *   OR (status = 'pending' AND request_expires_at IS NULL)
 *
 * Deliberately does NOT reuse `appointmentBlocking.ts`'s predicate: that
 * module answers "does this occupy the slot right now" (an explicit pending
 * request blocks right up until its deadline, expiry or no); this module
 * answers a stricter question — "has a human at the salon actually accepted
 * this" — which an explicit pending request never satisfies, deadline
 * notwithstanding.
 */
export function isReminderEligibleAppointment(
  appointment: { status: string; requestExpiresAt: Date | string | null },
): boolean {
  if (appointment.status === 'confirmed') {
    return true;
  }
  if (appointment.status !== 'pending') {
    return false;
  }
  return appointment.requestExpiresAt === null;
}

/**
 * SQL form — the SAME semantics as `isReminderEligibleAppointment`, as a
 * drizzle `SQL` fragment, so the query, the freshness re-check, and the
 * `markReminderSent` CAS can never diverge.
 */
export function reminderEligibleAppointmentCondition(): SQL {
  return or(
    eq(appointmentSchema.status, 'confirmed'),
    and(
      eq(appointmentSchema.status, 'pending'),
      isNull(appointmentSchema.requestExpiresAt),
    ),
  )!;
}
