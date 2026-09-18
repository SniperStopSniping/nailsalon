/**
 * Public-booking SMS reminder preference rules.  This is intentionally
 * separate from promotional consent: every event written by this module uses
 * the existing `appointment_transactional` purpose.
 */
export const BOOKING_SMS_MODES = ['default_on', 'default_off', 'disabled'] as const;
export type BookingSmsMode = (typeof BOOKING_SMS_MODES)[number];

export const BOOKING_SMS_SELECTIONS = [
  'default_on',
  'default_off',
  'explicit_on',
  'explicit_off',
] as const;
export type BookingSmsSelection = (typeof BOOKING_SMS_SELECTIONS)[number];

export type BookingSmsConsentInput = {
  granted: boolean;
  wordingVersion: string;
  selection: BookingSmsSelection;
  /** Only for payloads emitted by the retired default-off confirm control. */
  legacyDefaultOff?: boolean;
};

export type BookingSmsConsentDecision = {
  status: 'granted' | 'revoked';
  selection: BookingSmsSelection;
  isExplicit: boolean;
};
/** New salons, and malformed legacy settings, start with transactional SMS on. */
export function resolveBookingSmsMode(settings: unknown): BookingSmsMode {
  const value = (settings as {
    communications?: { sms?: { bookingDefault?: unknown } };
  } | null | undefined)?.communications?.sms?.bookingDefault;
  return BOOKING_SMS_MODES.includes(value as BookingSmsMode)
    ? value as BookingSmsMode
    : 'default_on';
}

/**
 * Reject mismatched client payloads.  The server owns the salon default; the
 * browser may only report whether that default was left alone or changed.
 */
export function resolveBookingSmsConsentDecision(
  mode: BookingSmsMode,
  input: BookingSmsConsentInput | undefined,
): BookingSmsConsentDecision | null {
  if (mode === 'disabled' || input === undefined) {
    return null;
  }

  const isExplicit = input.selection === 'explicit_on' || input.selection === 'explicit_off';
  const expectedGranted = input.selection === 'default_on' || input.selection === 'explicit_on';
  const selectionMatchesMode = isExplicit
    || (mode === 'default_on' && input.selection === 'default_on')
    || (mode === 'default_off' && input.selection === 'default_off')
    || (input.legacyDefaultOff === true && input.selection === 'default_off');

  if (!selectionMatchesMode || input.granted !== expectedGranted) {
    return null;
  }

  return {
    status: expectedGranted ? 'granted' : 'revoked',
    selection: input.selection,
    isExplicit,
  };
}

/** Submitted booking preferences can never replace provider suppression. */
export function shouldRecordBookingSmsConsent(input: {
  decision: BookingSmsConsentDecision;
  providerOptedOut: boolean;
}): boolean {
  return !input.providerOptedOut;
}
