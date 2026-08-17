/**
 * SMS destination policy — Canada-only pilot foundation.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §9.5.
 *
 * PURE module: no schema, no database, no Env. The authoritative country
 * signal is an EXPLICITLY STORED recipient country supplied by the caller;
 * the vendored Canadian area-code dataset is secondary validation only.
 * Persisted country columns (client/contact records and
 * communication_intent.destination_country) are Gate B / Migration B work —
 * in Gate A every real recipient therefore resolves with a null stored
 * country, and the correct fail-closed answer is DESTINATION_NOT_SUPPORTED.
 *
 * Deliberately does NOT use src/libs/phone.ts normalizePhone for the
 * authoritative decision: that helper strips the +1 prefix and reduces
 * everything to bare digits, so a +44 number would degrade into meaningless
 * digits instead of a typed rejection. A proper phone library
 * (libphonenumber-js, contract §9.5) lands with the Gate B send path; until
 * then the strict NANP-shape parser below plus an injectable normalizer
 * keeps this module dependency-free.
 */

import {
  CA_GEOGRAPHIC_AREA_CODES,
  NANP_NON_GEOGRAPHIC_AREA_CODES,
} from './data/caNanpAreaCodes';

export type SmsDestinationRejectionDetail =
  | 'INVALID_NUMBER'
  | 'NO_STORED_COUNTRY'
  | 'UNSUPPORTED_COUNTRY'
  | 'NON_GEOGRAPHIC_AMBIGUOUS'
  | 'AREA_CODE_CONFLICT';

export type SmsDestinationDecision =
  | { supported: true; country: 'CA'; e164: string; areaCode: string }
  | { supported: false; reason: 'DESTINATION_NOT_SUPPORTED'; detail: SmsDestinationRejectionDetail };

export type NormalizedNanpNumber = { e164: string; areaCode: string };

export type NanpNormalizer = (rawPhone: string) => NormalizedNanpNumber | null;

/**
 * Strict NANP-shape parser: optional +1/1 country code followed by exactly
 * ten digits, NPA and exchange both [2-9]XX, NPA not an N11 service code.
 * Anything else — including any non-NANP international number — is null
 * (typed rejection upstream), never a digit-stripped guess.
 */
export function normalizeNanpNumber(rawPhone: string): NormalizedNanpNumber | null {
  const compact = rawPhone.replace(/[\s\-().]/g, '');
  const match = /^(?:\+?1)?([2-9]\d{2})([2-9]\d{2})(\d{4})$/.exec(compact);
  if (match === null) {
    return null;
  }
  const areaCode = match[1]!;
  if (areaCode.endsWith('11')) {
    return null;
  }
  return { e164: `+1${areaCode}${match[2]}${match[3]}`, areaCode };
}

export const SUPPORTED_DESTINATION_COUNTRIES: ReadonlySet<string> = new Set(['CA']);

export function resolveSmsDestination(
  input: { rawPhone: string; storedCountry: string | null },
  deps: { normalize: NanpNormalizer } = { normalize: normalizeNanpNumber },
): SmsDestinationDecision {
  const normalized = deps.normalize(input.rawPhone);
  if (normalized === null) {
    return { supported: false, reason: 'DESTINATION_NOT_SUPPORTED', detail: 'INVALID_NUMBER' };
  }

  if (NANP_NON_GEOGRAPHIC_AREA_CODES.has(normalized.areaCode)) {
    // Toll-free and service codes are shared across the whole numbering
    // plan — country-ambiguous regardless of any stored country.
    return { supported: false, reason: 'DESTINATION_NOT_SUPPORTED', detail: 'NON_GEOGRAPHIC_AMBIGUOUS' };
  }

  if (input.storedCountry === null || input.storedCountry.trim() === '') {
    // +1 is NOT proof of Canada. Without an explicit stored country the
    // pilot fails closed.
    return { supported: false, reason: 'DESTINATION_NOT_SUPPORTED', detail: 'NO_STORED_COUNTRY' };
  }

  const country = input.storedCountry.trim().toUpperCase();
  if (!SUPPORTED_DESTINATION_COUNTRIES.has(country)) {
    return { supported: false, reason: 'DESTINATION_NOT_SUPPORTED', detail: 'UNSUPPORTED_COUNTRY' };
  }

  if (!CA_GEOGRAPHIC_AREA_CODES.has(normalized.areaCode)) {
    // The stored country says Canada but the area code is not a Canadian
    // geographic NPA — a conflict is fail-closed, never guessed around.
    return { supported: false, reason: 'DESTINATION_NOT_SUPPORTED', detail: 'AREA_CODE_CONFLICT' };
  }

  return {
    supported: true,
    country: 'CA',
    e164: normalized.e164,
    areaCode: normalized.areaCode,
  };
}
