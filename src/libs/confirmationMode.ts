/**
 * Luster L1 PR3 — effective public booking/confirmation behaviour.
 *
 * PURE and BROWSER-COMPATIBLE: no `@/libs/DB`, no `server-only`, no I/O.
 * This module answers exactly one question — "given what is stored on a
 * service (and, if it is a variant, its parent), what confirmation mode is
 * effectively in force?" — and answers it as a plain, deterministic function
 * of its arguments.
 *
 * WHAT THIS MODULE IS NOT
 *
 * It does not gate a booking, does not write `appointment.status`,
 * `appointment.request_expires_at`, or any other request-lifecycle field,
 * and is not called from any booking path in this PR. Resolving a value of
 * `'request_approval'` here is a DESCRIPTION of stored data, not an
 * ACTIVATION of the request-approval workflow — nothing in Luster today
 * branches on this module's output, and that stays true until a later PR
 * wires a caller to it. "Must not activate request approval" is a
 * constraint on the SYSTEM (no production caller exists yet), not on this
 * function's honesty about what the data says.
 *
 * `service.confirmation_mode` is nullable, and every legacy row is NULL
 * (migration 0072). NULL has always meant "the original, always-instant
 * booking flow" — there is no separate `'legacy'` value in the vocabulary,
 * because legacy behaviour and `'instant'` are the same behaviour. Resolving
 * NULL to `'instant'` is therefore not a change in meaning; it is naming the
 * behaviour legacy rows already have.
 */

export const EFFECTIVE_CONFIRMATION_MODES = [
  'instant',
  'request_approval',
  'consultation',
] as const;

export type EffectiveConfirmationMode = typeof EFFECTIVE_CONFIRMATION_MODES[number];

/** What every legacy (NULL) service resolves to — today's always-instant behaviour. */
export const DEFAULT_EFFECTIVE_CONFIRMATION_MODE: EffectiveConfirmationMode = 'instant';

function normalize(value: string | null | undefined): EffectiveConfirmationMode | null {
  if (value === 'instant' || value === 'request_approval' || value === 'consultation') {
    return value;
  }
  // Covers null, undefined, '', and any value that predates or falls outside
  // the current vocabulary. Fail closed to "no opinion" rather than trusting
  // an unrecognized stored string — the caller falls through to the parent
  // or the default, exactly as it would for a genuinely NULL column.
  return null;
}

/**
 * Resolves the effective confirmation mode for one service.
 *
 * Precedence: the service's own `confirmationMode`, then — for a variant
 * child only — its parent's `confirmationMode`, then the default. A
 * `parentConfirmationMode` passed for a service that is not actually a
 * child is simply never consulted, since `ownConfirmationMode` already
 * takes precedence whenever it is set; callers do not need to branch on
 * `parentServiceId` themselves before calling this.
 */
export function resolveEffectivePublicConfirmationMode(input: {
  ownConfirmationMode: string | null | undefined;
  parentConfirmationMode?: string | null | undefined;
}): EffectiveConfirmationMode {
  const own = normalize(input.ownConfirmationMode);
  if (own) {
    return own;
  }

  const parent = normalize(input.parentConfirmationMode);
  if (parent) {
    return parent;
  }

  return DEFAULT_EFFECTIVE_CONFIRMATION_MODE;
}
