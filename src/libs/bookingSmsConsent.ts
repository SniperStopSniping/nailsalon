/** Public-booking text preference and its auditable wording version. */
export const BOOKING_SMS_WORDING_VERSION = 'booking-sms-all-v2';
/** Appointment texts and salon promotions are separately consented in v3. */
export const BOOKING_SMS_SEPARATED_WORDING_VERSION = 'booking-sms-separated-v3';
/** One disclosed checkbox covers appointment and promotional texts in v4. */
export const BOOKING_SMS_COMBINED_WORDING_VERSION = 'booking-sms-combined-v4';
export const BOOKING_SMS_AUTHORITATIVE_WORDING_VERSIONS = [
  BOOKING_SMS_SEPARATED_WORDING_VERSION,
  BOOKING_SMS_COMBINED_WORDING_VERSION,
] as const;
export const BOOKING_SMS_EXPANDED_PURPOSES = ['appointment_transactional', 'salon_promotions'] as const;

export function includesExpandedBookingSmsPurposes(wordingVersion: string): boolean {
  return wordingVersion === BOOKING_SMS_WORDING_VERSION
    || usesAuthoritativeBookingSmsChoice(wordingVersion);
}

export function usesSeparatedBookingSmsConsent(wordingVersion: string): boolean {
  return wordingVersion === BOOKING_SMS_SEPARATED_WORDING_VERSION;
}

/**
 * These versions record a customer choice for every disclosed SMS purpose,
 * so their revoked default-off rows must never fall back to an active-client
 * default. v3 is independently split; v4 is one combined choice.
 */
export function usesAuthoritativeBookingSmsChoice(wordingVersion: string): boolean {
  return BOOKING_SMS_AUTHORITATIVE_WORDING_VERSIONS.includes(
    wordingVersion as (typeof BOOKING_SMS_AUTHORITATIVE_WORDING_VERSIONS)[number],
  );
}
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
  /** v3 only. Missing is an unselected promotional consent. */
  promotionsGranted?: boolean;
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

  if (input.wordingVersion === BOOKING_SMS_COMBINED_WORDING_VERSION) {
    // The combined control is always opt-in. It intentionally starts off even
    // if a historical salon setting would otherwise default appointment SMS on.
    // A v4 payload cannot claim an untouched default-on choice or split its
    // promotional consent from the one disclosed checkbox.
    if (
      input.selection === 'default_on'
      || input.promotionsGranted !== undefined
      || !['default_off', 'explicit_on', 'explicit_off'].includes(input.selection)
    ) {
      return null;
    }
    const expectedGranted = input.selection === 'explicit_on';
    if (input.granted !== expectedGranted) {
      return null;
    }
    return {
      status: expectedGranted ? 'granted' : 'revoked',
      selection: input.selection,
      isExplicit: input.selection !== 'default_off',
    };
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
