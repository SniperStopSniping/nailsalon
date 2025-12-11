/**
 * Booking Flow Utilities
 *
 * Helpers for customizable booking step order.
 * Default flow: service → tech → time → confirm
 *
 * Rules:
 * - `service` and `time` must always exist
 * - `confirm` is always last
 * - `tech` can be turned on/off
 */

export type BookingStep = 'service' | 'tech' | 'time' | 'confirm';

export const DEFAULT_BOOKING_FLOW: BookingStep[] = [
  'service',
  'tech',
  'time',
  'confirm',
];

const ALLOWED_STEPS: BookingStep[] = ['service', 'tech', 'time', 'confirm'];

/**
 * Normalize a booking flow array to ensure validity.
 * - Filters out invalid/duplicate steps
 * - Ensures `service` exists (prepends if missing)
 * - Ensures `time` exists (inserts after service if missing)
 * - Ensures `confirm` is always last
 */
export function normalizeBookingFlow(
  flow: BookingStep[] | string[] | null | undefined,
): BookingStep[] {
  let steps: BookingStep[] = Array.isArray(flow)
    ? (flow
        .filter((s, i, arr) => ALLOWED_STEPS.includes(s as BookingStep) && arr.indexOf(s) === i)
        .map(s => s as BookingStep))
    : [...DEFAULT_BOOKING_FLOW];

  // Ensure service exists (must be first)
  if (!steps.includes('service')) {
    steps.unshift('service');
  }

  // Ensure time exists (usually after service)
  if (!steps.includes('time')) {
    const serviceIndex = steps.indexOf('service');
    const insertAt = serviceIndex >= 0 ? serviceIndex + 1 : 1;
    steps.splice(insertAt, 0, 'time');
  }

  // Confirm always last - remove and re-add at end
  steps = steps.filter(s => s !== 'confirm');
  steps.push('confirm');

  return steps;
}

/**
 * Get the next step in the booking flow.
 * Returns null if current step is the last or not found.
 */
export function getNextStep(
  current: BookingStep,
  flow: BookingStep[],
): BookingStep | null {
  const idx = flow.indexOf(current);
  if (idx === -1 || idx === flow.length - 1) {
    return null;
  }
  return flow[idx + 1] ?? null;
}

/**
 * Get the previous step in the booking flow.
 * Returns null if current step is the first or not found.
 */
export function getPrevStep(
  current: BookingStep,
  flow: BookingStep[],
): BookingStep | null {
  const idx = flow.indexOf(current);
  if (idx <= 0) {
    return null;
  }
  return flow[idx - 1] ?? null;
}

/**
 * Check if a step is included in the flow.
 */
export function isStepEnabled(
  step: BookingStep,
  flow: BookingStep[],
): boolean {
  return flow.includes(step);
}

/**
 * Get the step index (1-based for UI display).
 * Returns 0 if step not found.
 */
export function getStepIndex(
  step: BookingStep,
  flow: BookingStep[],
): number {
  const idx = flow.indexOf(step);
  return idx >= 0 ? idx + 1 : 0;
}

/**
 * Get human-readable step label.
 */
export function getStepLabel(step: BookingStep): string {
  const labels: Record<BookingStep, string> = {
    service: 'Service',
    tech: 'Artist',
    time: 'Time',
    confirm: 'Confirm',
  };
  return labels[step] || step;
}

/**
 * Get the first step in the booking flow.
 * Normalizes the flow first to ensure validity.
 * Used for canonical entry points (e.g., /book redirects to /book/{firstStep})
 */
export function getFirstStep(
  flow: BookingStep[] | string[] | null | undefined,
): BookingStep {
  const normalized = normalizeBookingFlow(flow);
  // normalizeBookingFlow guarantees at least service and time exist
  return normalized[0]!;
}
