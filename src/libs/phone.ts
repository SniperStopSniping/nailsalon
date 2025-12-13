/**
 * Phone Number Utilities
 *
 * Pure helper module for phone normalization.
 * No DB imports, no side effects - safe to import from scripts/tests.
 *
 * CONTRACT: normalizePhone() is IDEMPOTENT.
 * - Calling it on raw input returns normalized 10-digit.
 * - Calling it on already-normalized 10-digit returns the same value.
 * - This guarantees double-normalization is safe (but discouraged).
 */

/**
 * Normalize phone number to 10 digits (US format).
 * Strips country code (+1) and all non-digit characters.
 *
 * IDEMPOTENT: normalizePhone(normalizePhone(x)) === normalizePhone(x)
 *
 * @param phone - Raw or pre-normalized phone string
 * @returns 10-digit string, or shorter if invalid input
 *
 * @example
 * normalizePhone('+1 (416) 555-1234') // '4165551234'
 * normalizePhone('14165551234')       // '4165551234'
 * normalizePhone('4165551234')        // '4165551234' (already normalized)
 * normalizePhone('555-1234')          // '5551234' (invalid - too short)
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // If 11 digits starting with 1, strip the leading 1 (US country code)
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Validate that a phone string is a valid 10-digit US number.
 *
 * @param phone - Raw or normalized phone string
 * @returns true if valid 10-digit after normalization
 */
export function isValidPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  return normalized.length === 10;
}

/**
 * Format a 10-digit phone for display.
 *
 * @param phone - 10-digit normalized phone
 * @returns Formatted string like (416) 555-1234
 */
export function formatPhoneForDisplay(phone: string): string {
  if (phone.length === 10) {
    return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
  }
  return phone;
}
