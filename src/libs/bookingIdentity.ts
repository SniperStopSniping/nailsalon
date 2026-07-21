import { normalizePhone } from '@/libs/phone';

/**
 * Canonical customer-matching policy for the duplicate-booking gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * The gate used to key on a single phone number that the server had quietly
 * replaced with the signed-in account's phone. A customer could therefore be
 * blocked by an appointment they could not see, and editing the form changed
 * nothing. Matching is now explicit, documented, and computed from the contact
 * details the request is actually booking under.
 *
 * PRECEDENCE (highest first)
 * --------------------------
 *  1. IDENTITY CONFLICT — the normalized phone matches one set of active
 *     appointments and the email matches a *different* set. Two different
 *     people are implicated, so the server refuses rather than guessing which
 *     one is booking. Records are never merged automatically.
 *  2. PHONE — an exact normalized-phone match is the primary duplicate signal.
 *     A phone match blocks even when the email has changed.
 *  3. EMAIL — an exact, case-insensitive email match is a secondary signal. It
 *     blocks only when the matched appointment carries no phone (legacy rows
 *     predating phone capture) or carries the same phone. An email match whose
 *     appointment has a *different* phone is treated as a shared household
 *     address and does NOT block.
 *  4. ALLOW — nothing matched.
 *
 * Every lookup that feeds this is scoped to a single salon and to active,
 * non-deleted appointments; cancelled, completed, no-show and past rows can
 * never reach here. The caller re-runs the check immediately before insert, so
 * this is always evaluated against fresh rows — a client-supplied id, cookie
 * or flag is never an input.
 */

/** The only appointment fields the policy is allowed to see. */
export type ActiveAppointmentMatch = {
  id: string;
  clientPhone: string | null;
  clientEmail: string | null;
};

export type DuplicateBookingDecision =
  | { decision: 'allow' }
  | { decision: 'block'; signal: 'phone' | 'email' }
  | { decision: 'identity_conflict' };

function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || null;
}

function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizePhone(a ?? '');
  const right = normalizePhone(b ?? '');
  return Boolean(left) && left === right;
}

/**
 * Classify a prospective booking against the active appointments that matched
 * its phone and its email. Both lists come from salon-scoped queries over
 * active statuses only.
 */
export function classifyDuplicateBooking(args: {
  normalizedPhone: string;
  email: string | null;
  phoneMatches: ActiveAppointmentMatch[];
  emailMatches: ActiveAppointmentMatch[];
}): DuplicateBookingDecision {
  const { normalizedPhone, phoneMatches, emailMatches } = args;
  const email = normalizeEmail(args.email);

  // Email matches that plausibly belong to THIS person: either the row predates
  // phone capture, or it carries the same number. Anything else is somebody
  // else who shares the address.
  const ownEmailMatches = email
    ? emailMatches.filter(match => !normalizePhone(match.clientPhone ?? '') || samePhone(match.clientPhone, normalizedPhone))
    : [];
  const otherPersonEmailMatches = email
    ? emailMatches.filter(match => !ownEmailMatches.some(own => own.id === match.id))
    : [];

  // 1. Phone points at one person, email at another. Refuse to pick.
  if (phoneMatches.length > 0 && otherPersonEmailMatches.length > 0) {
    return { decision: 'identity_conflict' };
  }

  // 2. Phone is the primary signal — a changed email does not escape it.
  if (phoneMatches.length > 0) {
    return { decision: 'block', signal: 'phone' };
  }

  // 3. Email is secondary, and only for rows that are plausibly this person.
  if (ownEmailMatches.length > 0) {
    return { decision: 'block', signal: 'email' };
  }

  // 4. Shared household email with a different phone, or nothing at all.
  return { decision: 'allow' };
}

/**
 * Who a booking request is FOR. Validated server-side; never inferred from a
 * client-supplied customer id.
 *
 * - `self`  — the signed-in account books for itself. The account's phone is
 *   authoritative and is never overwritten by the form.
 * - `guest` — an explicit "book for someone else" (or a plain visitor). The
 *   typed contact details are used verbatim and the signed-in identity is not
 *   attached.
 */
export type BookingSubjectMode = 'self' | 'guest';

export type BookingSubjectResolution =
  | { ok: true; mode: BookingSubjectMode }
  /**
   * A session exists, the form carries a different phone, and the client did
   * not say which it meant. Older clients that predate the mode flag land here
   * instead of having their identity silently swapped.
   */
  | { ok: false; reason: 'identity_conflict' };

/**
 * Decide which identity a request books under.
 *
 * The safe default matters most: when a signed-in browser submits a phone that
 * is not the account's and does not declare a mode, the server refuses and
 * asks the customer to choose, rather than booking as the account holder.
 */
export function resolveBookingSubject(args: {
  hasClientSession: boolean;
  sessionPhone: string | null;
  requestedMode: BookingSubjectMode | undefined;
  typedPhone: string | null;
}): BookingSubjectResolution {
  if (!args.hasClientSession) {
    return { ok: true, mode: 'guest' };
  }
  if (args.requestedMode) {
    return { ok: true, mode: args.requestedMode };
  }
  // No declared mode: infer only when it is unambiguous.
  if (!args.typedPhone || samePhone(args.typedPhone, args.sessionPhone)) {
    return { ok: true, mode: 'self' };
  }
  return { ok: false, reason: 'identity_conflict' };
}
