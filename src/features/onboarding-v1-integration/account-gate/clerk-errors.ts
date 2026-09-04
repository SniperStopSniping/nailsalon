/**
 * Maps raw Clerk API errors to concise owner-facing messages. Raw Clerk
 * error prose is never shown; unknown codes fall back to the caller's
 * context-appropriate message.
 */

type ClerkApiErrorLike = {
  code?: unknown;
  longMessage?: unknown;
  message?: unknown;
};

const OWNER_MESSAGE_BY_CLERK_CODE: Record<string, string> = {
  captcha_invalid: 'We couldn’t confirm you’re human. Reload this page and try again.',
  captcha_unavailable: 'We couldn’t confirm you’re human. Reload this page and try again.',
  form_code_incorrect: 'That code doesn’t match. Check the newest email and try again.',
  form_identifier_exists: 'An account already exists for this email. Log in instead.',
  form_identifier_not_found: 'We couldn’t find a Luster account for this email.',
  form_param_format_invalid: 'Enter a valid email address.',
  form_password_incorrect: 'That password doesn’t match this account.',
  form_password_length_too_short: 'Choose a longer password of at least eight characters.',
  form_password_pwned: 'That password has appeared in a known data breach. Choose a different one.',
  form_password_validation_failed: 'That password doesn’t match this account.',
  session_exists: 'You’re already signed in on this device.',
  too_many_requests: 'Too many attempts. Wait a moment and try again.',
  verification_expired: 'That code has expired. Send a new code and try again.',
  verification_failed: 'Too many incorrect attempts. Send a new code and try again.',
};

export const getClerkErrorCode = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const errors = (error as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return null;
  }
  const first = errors[0] as ClerkApiErrorLike;
  return typeof first.code === 'string' && first.code ? first.code : null;
};

export const describeClerkError = (
  error: unknown,
  fallback: string,
): string => {
  const code = getClerkErrorCode(error);
  return (code && OWNER_MESSAGE_BY_CLERK_CODE[code]) || fallback;
};
