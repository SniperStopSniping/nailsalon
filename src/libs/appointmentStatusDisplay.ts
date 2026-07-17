/**
 * Single source of truth for appointment status presentation.
 *
 * Every screen that shows an appointment status must use these helpers so a
 * status always reads and colors the same across the owner dashboard,
 * calendars, and appointment sheets. (Was previously three diverging maps.)
 */

export type AppointmentDisplayStatus
  = | 'pending'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show'
    // Calendar pseudo-statuses
  | 'blocked'
  | 'google_busy'
  | 'google_free';

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentDisplayStatus, string> = {
  pending: 'Unconfirmed',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
  blocked: 'Blocked time',
  google_busy: 'Google Calendar (busy)',
  google_free: 'Google Calendar',
};

/**
 * Tailwind classes for a status chip: background, text, and border.
 * Colors intentionally pair with an explicit text label — status must never
 * be communicated by color alone.
 */
export const APPOINTMENT_STATUS_CHIP_CLASSES: Record<AppointmentDisplayStatus, string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  confirmed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  in_progress: 'bg-sky-50 text-sky-800 border-sky-200',
  completed: 'bg-neutral-100 text-neutral-600 border-neutral-200',
  cancelled: 'bg-neutral-100 text-neutral-500 border-neutral-200',
  no_show: 'bg-red-50 text-red-700 border-red-200',
  blocked: 'bg-neutral-200 text-neutral-600 border-neutral-300',
  google_busy: 'bg-violet-50 text-violet-700 border-violet-200',
  google_free: 'bg-violet-50 text-violet-500 border-violet-200',
};

/** Friendly label for any status string, falling back to a readable form. */
export function formatAppointmentStatus(status: string | null | undefined): string {
  if (!status) {
    return '';
  }
  return APPOINTMENT_STATUS_LABELS[status as AppointmentDisplayStatus]
    ?? status.replace(/_/g, ' ');
}

/** Chip classes for any status string, with a neutral fallback. */
export function appointmentStatusChipClasses(status: string | null | undefined): string {
  return APPOINTMENT_STATUS_CHIP_CLASSES[status as AppointmentDisplayStatus]
    ?? 'bg-neutral-100 text-neutral-600 border-neutral-200';
}
