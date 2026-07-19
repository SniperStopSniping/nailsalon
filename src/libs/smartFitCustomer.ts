import type { SelectedAddOnParam } from '@/libs/bookingParams';
import { SMART_FIT_DISCOUNT_LABEL, SMART_FIT_DISCOUNT_TYPE } from '@/libs/smartFit';

/**
 * Customer-facing Smart Fit helpers (P7.3) — the browser-side counterpart of
 * the P7.2 server seams. Everything here is presentation plumbing: the server
 * remains the only authority on eligibility and pricing. The client never
 * evaluates Smart Fit itself; it only relays the server-derived
 * `slot.smartFit` availability metadata and echoes the approved expectation
 * fields (`expectedDiscountType`/`expectedTotalCents`) back on the booking
 * request so a displayed price can be protected by the 409 SMART_FIT_CHANGED
 * contract.
 */

/**
 * The only Smart Fit fields the customer UI keeps from an availability slot.
 * Deliberately excludes evaluator internals (qualifying sides, improvement
 * minutes) and config details (percent/fixed, configured value) — none of
 * those belong in customer-facing state.
 */
export type CustomerSmartFitOffer = {
  discountAmountCents: number;
  originalPriceCents: number;
  discountedPriceCents: number;
};

/** Section heading for qualifying slots (approved customer copy). */
export const SMART_FIT_SECTION_TITLE = 'Save with a Smart Fit';

/** Supporting copy under the section heading (approved customer copy). */
export const SMART_FIT_SECTION_DESCRIPTION
  = 'Choose a time that fits neatly into the salon’s schedule and save on your appointment.';

/** Badge text on a qualifying slot (approved customer copy). */
export const SMART_FIT_BADGE_LABEL = 'Smart Fit';

/** Heading for the non-Smart-Fit group when the Smart Fit section renders. */
export const SMART_FIT_OTHER_TIMES_TITLE = 'Other available times';

/** Review-step discount line label — shared with the server snapshot label. */
export const SMART_FIT_REVIEW_DISCOUNT_LABEL = SMART_FIT_DISCOUNT_LABEL;

/**
 * Fallback for the stale-offer alert. Must stay byte-identical to
 * SMART_FIT_STALE_MESSAGE in `src/app/api/appointments/route.ts` (the server
 * message is preferred at runtime; this covers a missing message field only).
 */
export const SMART_FIT_STALE_FALLBACK_MESSAGE
  = 'This discounted time is no longer available. Please choose from the latest times.';

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * Whitelist-parse the server's `slot.smartFit` annotation into the minimal
 * customer offer. Anything malformed or internally inconsistent (a discount
 * that doesn't reconcile with the two prices) is treated as "no offer" — the
 * slot then renders as a plain time.
 */
export function parseCustomerSmartFitOffer(value: unknown): CustomerSmartFitOffer | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as {
    eligible?: unknown;
    discountAmountCents?: unknown;
    originalPriceCents?: unknown;
    discountedPriceCents?: unknown;
  };
  if (candidate.eligible !== true) {
    return null;
  }
  if (
    !isPositiveInteger(candidate.discountAmountCents)
    || !isPositiveInteger(candidate.originalPriceCents)
    || !isNonNegativeInteger(candidate.discountedPriceCents)
  ) {
    return null;
  }
  if (candidate.originalPriceCents - candidate.discountAmountCents !== candidate.discountedPriceCents) {
    return null;
  }
  return {
    discountAmountCents: candidate.discountAmountCents,
    originalPriceCents: candidate.originalPriceCents,
    discountedPriceCents: candidate.discountedPriceCents,
  };
}

/** Parse an integer-cents URL param; null unless a plain non-negative integer. */
export function parseSmartFitCentsParam(value: string | null): number | null {
  if (!value || !/^\d{1,9}$/.test(value)) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

type SmartFitGroupableSlot = {
  time: string;
  smartFit?: CustomerSmartFitOffer | null;
};

/**
 * Split availability slots into the "Save with a Smart Fit" group and the
 * regular group. Input order (chronological) is preserved inside both groups
 * and no slot appears in both. Slots the caller marks unavailable stay in the
 * regular group so they keep their existing disabled presentation.
 */
export function splitSmartFitSlots<T extends SmartFitGroupableSlot>(
  slots: T[],
  options?: { isSlotUnavailable?: (slot: T) => boolean },
): { smartFitSlots: T[]; regularSlots: T[] } {
  const smartFitSlots: T[] = [];
  const regularSlots: T[] = [];
  for (const slot of slots) {
    if (slot.smartFit && !options?.isSlotUnavailable?.(slot)) {
      smartFitSlots.push(slot);
    } else {
      regularSlots.push(slot);
    }
  }
  return { smartFitSlots, regularSlots };
}

/** Parse the grid's 24h `H:MM`/`HH:MM` time into minutes since midnight. */
export function parseTimeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) {
    return null;
  }
  const hours = Number.parseInt(match[1]!, 10);
  const minutes = Number.parseInt(match[2]!, 10);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

/**
 * Pick at most ONE nearby Smart Fit alternative for a selected regular slot,
 * from the SAME already-loaded availability response (same date, technician
 * context, and location by construction — the caller passes only currently
 * selectable slots from that response). Smallest absolute time difference
 * wins; an exact-distance tie prefers the earlier slot; the selected slot
 * itself is never suggested.
 */
export function selectNearbySmartFitSuggestion<T extends SmartFitGroupableSlot>(args: {
  selectedTime: string;
  slots: T[];
}): T | null {
  const selectedMinutes = parseTimeToMinutes(args.selectedTime);
  if (selectedMinutes === null) {
    return null;
  }

  let best: T | null = null;
  let bestMinutes = 0;
  for (const slot of args.slots) {
    if (!slot.smartFit || slot.time === args.selectedTime) {
      continue;
    }
    const slotMinutes = parseTimeToMinutes(slot.time);
    if (slotMinutes === null || slotMinutes === selectedMinutes) {
      continue;
    }
    if (best === null) {
      best = slot;
      bestMinutes = slotMinutes;
      continue;
    }
    const bestDistance = Math.abs(bestMinutes - selectedMinutes);
    const slotDistance = Math.abs(slotMinutes - selectedMinutes);
    if (slotDistance < bestDistance || (slotDistance === bestDistance && slotMinutes < bestMinutes)) {
      best = slot;
      bestMinutes = slotMinutes;
    }
  }
  return best;
}

/**
 * Human copy for the suggestion's time delta, e.g. "30 minutes earlier",
 * "1 hour later", "1 hour 15 minutes earlier". Null when the times cannot be
 * compared or are identical (no honest sentence exists).
 */
export function describeSmartFitTimeDifference(
  selectedTime: string,
  suggestedTime: string,
): string | null {
  const selectedMinutes = parseTimeToMinutes(selectedTime);
  const suggestedMinutes = parseTimeToMinutes(suggestedTime);
  if (selectedMinutes === null || suggestedMinutes === null || selectedMinutes === suggestedMinutes) {
    return null;
  }
  const delta = Math.abs(suggestedMinutes - selectedMinutes);
  const hours = Math.floor(delta / 60);
  const minutes = delta % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(hours === 1 ? '1 hour' : `${hours} hours`);
  }
  if (minutes > 0) {
    parts.push(minutes === 1 ? '1 minute' : `${minutes} minutes`);
  }
  const direction = suggestedMinutes < selectedMinutes ? 'earlier' : 'later';
  return `${parts.join(' ')} ${direction}`;
}

/**
 * The ONLY booking-request fields the client may attach for a Smart Fit slot —
 * the P7.2-approved expectation contract. The server re-derives everything
 * else and rejects a mismatch with 409 SMART_FIT_CHANGED.
 */
export function buildSmartFitExpectationFields(offer: CustomerSmartFitOffer): {
  expectedDiscountType: typeof SMART_FIT_DISCOUNT_TYPE;
  expectedTotalCents: number;
} {
  return {
    expectedDiscountType: SMART_FIT_DISCOUNT_TYPE,
    expectedTotalCents: offer.discountedPriceCents,
  };
}

/**
 * Resolve the review-step Smart Fit offer from the URL expectation params.
 * Inactive whenever a higher-priority discount already applies (campaign,
 * reward, first visit — winner-take-all, no stacking) or the params don't
 * reconcile with the server-computed subtotal (stale or edited URL). Inactive
 * means the review shows regular pricing and NO expectation fields are sent —
 * the server then prices the booking honestly on its own.
 */
export function resolveSmartFitReviewOffer(args: {
  subtotalCents: number;
  discountCentsParam: number | null;
  totalCentsParam: number | null;
  hasOtherDiscount: boolean;
}): CustomerSmartFitOffer | null {
  if (
    args.hasOtherDiscount
    || args.discountCentsParam === null
    || args.totalCentsParam === null
    || args.discountCentsParam <= 0
    || !Number.isInteger(args.subtotalCents)
    || args.subtotalCents <= 0
    || args.subtotalCents - args.discountCentsParam !== args.totalCentsParam
  ) {
    return null;
  }
  return {
    discountAmountCents: args.discountCentsParam,
    originalPriceCents: args.subtotalCents,
    discountedPriceCents: args.totalCentsParam,
  };
}

/**
 * Identity of "the current booking flow" for suggestion dismissal. Any
 * material change (service, add-ons, technician, location, date) produces a
 * different key, which resets the dismissal.
 */
export function buildSmartFitSuggestionContextKey(args: {
  salonSlug: string;
  dateKey: string;
  techId: string | null;
  locationId: string | null;
  baseServiceId: string | null;
  serviceIds: string[];
  selectedAddOns: SelectedAddOnParam[];
}): string {
  const services = [...args.serviceIds].sort().join(',');
  const addOns = [...args.selectedAddOns]
    .map(addOn => `${addOn.addOnId}x${addOn.quantity ?? 1}`)
    .sort()
    .join(',');
  return [
    args.salonSlug,
    args.dateKey,
    args.techId || 'any',
    args.locationId || '',
    args.baseServiceId || '',
    services,
    addOns,
  ].join('|');
}

// Per-tab, per-flow suggestion dismissal. sessionStorage mirrors the existing
// guest-contact pattern in BookConfirmClient: temporary, dies with the tab,
// and degrades silently when storage is unavailable.
const SMART_FIT_DISMISSAL_STORAGE_KEY = 'luster_smart_fit_dismissal';

// One-shot marker: the stale-offer screen sets it before returning to the
// time step so the refreshed time list can receive focus. Stores the salon
// slug so a stranded flag can never affect another salon's booking flow.
const SMART_FIT_REFRESH_STORAGE_KEY = 'luster_smart_fit_refresh';

// Per-tab marker that the server told us (via a 409 breakdown) that a
// higher-priority discount outranks Smart Fit for this visitor at this salon.
// While set, the flow stops promising Smart Fit savings it cannot honor —
// the server still grants whichever discount truly applies at booking time.
const SMART_FIT_OUTRANKED_STORAGE_KEY = 'luster_smart_fit_outranked';

/** The honest current pricing carried on a 409 SMART_FIT_CHANGED response. */
export type SmartFitStaleBreakdown = {
  discountType: string | null;
  discountLabel: string | null;
  discountAmountCents: number;
  finalTotalCents: number;
};

/** Whitelist-parse the 409 details.breakdown; null when absent or malformed. */
export function parseSmartFitStaleBreakdown(value: unknown): SmartFitStaleBreakdown | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const breakdown = (value as { breakdown?: unknown }).breakdown;
  if (typeof breakdown !== 'object' || breakdown === null) {
    return null;
  }
  const candidate = breakdown as {
    discountType?: unknown;
    discountLabel?: unknown;
    discountAmountCents?: unknown;
    finalTotalCents?: unknown;
  };
  if (
    !isNonNegativeInteger(candidate.finalTotalCents)
    || !isNonNegativeInteger(candidate.discountAmountCents)
  ) {
    return null;
  }
  return {
    discountType: typeof candidate.discountType === 'string' ? candidate.discountType : null,
    discountLabel: typeof candidate.discountLabel === 'string' ? candidate.discountLabel : null,
    discountAmountCents: candidate.discountAmountCents,
    finalTotalCents: candidate.finalTotalCents,
  };
}

/**
 * True when the breakdown proves a higher-priority discount replaced Smart
 * Fit for this visitor (campaign/reward/first-visit precedence) — as opposed
 * to plain schedule staleness (discountType null or still smart_fit).
 */
export function smartFitReplacedByHigherPriorityDiscount(
  breakdown: SmartFitStaleBreakdown | null,
): boolean {
  return Boolean(
    breakdown
    && breakdown.discountType
    && breakdown.discountType !== SMART_FIT_DISCOUNT_TYPE
    && breakdown.discountAmountCents > 0,
  );
}

/**
 * Remember that this visitor's identity out-ranks Smart Fit at this salon.
 * Prevents the availability display from re-promising a saving the booking
 * API has already refused once — without it, a first-visit-eligible guest
 * would loop through the same 409 on every annotated slot.
 */
export function markSmartFitOutrankedForSession(salonSlug: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    sessionStorage.setItem(SMART_FIT_OUTRANKED_STORAGE_KEY, salonSlug);
  } catch {
    // Storage unavailable — the server keeps rejecting stale expectations.
  }
}

/** Whether Smart Fit promises are suppressed for this salon this session. */
export function isSmartFitOutrankedForSession(salonSlug: string): boolean {
  if (typeof window === 'undefined' || !salonSlug) {
    return false;
  }
  try {
    return sessionStorage.getItem(SMART_FIT_OUTRANKED_STORAGE_KEY) === salonSlug;
  } catch {
    return false;
  }
}

/**
 * Returns whether the nearby suggestion is dismissed for THIS booking
 * context. A dismissal recorded under a different context key means the
 * booking context materially changed since — the dismissal is cleared (reset)
 * and no longer applies.
 */
export function syncSmartFitSuggestionDismissal(contextKey: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const stored = sessionStorage.getItem(SMART_FIT_DISMISSAL_STORAGE_KEY);
    if (!stored) {
      return false;
    }
    if (stored === contextKey) {
      return true;
    }
    sessionStorage.removeItem(SMART_FIT_DISMISSAL_STORAGE_KEY);
    return false;
  } catch {
    return false;
  }
}

/** Record that the client kept their time for this booking context. */
export function dismissSmartFitSuggestion(contextKey: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    sessionStorage.setItem(SMART_FIT_DISMISSAL_STORAGE_KEY, contextKey);
  } catch {
    // Storage unavailable — the in-memory dismissal still applies this render.
  }
}

/** Flag that the next time-step mount follows a stale Smart Fit response. */
export function markSmartFitAvailabilityRefresh(salonSlug: string): void {
  if (typeof window === 'undefined' || !salonSlug) {
    return;
  }
  try {
    sessionStorage.setItem(SMART_FIT_REFRESH_STORAGE_KEY, salonSlug);
  } catch {
    // Storage unavailable — focus management degrades to browser default.
  }
}

/**
 * Consume the stale-refresh flag (read once, then cleared). Only a flag set
 * for THIS salon counts; a stranded flag from another salon's flow is cleared
 * without effect so it can never steal focus elsewhere.
 */
export function consumeSmartFitAvailabilityRefresh(salonSlug: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const stored = sessionStorage.getItem(SMART_FIT_REFRESH_STORAGE_KEY);
    if (stored === null) {
      return false;
    }
    sessionStorage.removeItem(SMART_FIT_REFRESH_STORAGE_KEY);
    return Boolean(salonSlug) && stored === salonSlug;
  } catch {
    return false;
  }
}
