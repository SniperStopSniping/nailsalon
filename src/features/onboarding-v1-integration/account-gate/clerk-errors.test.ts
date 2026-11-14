import { describe, expect, it } from 'vitest';

import { describeClerkError, getClerkErrorCode } from './clerk-errors';

describe('getClerkErrorCode', () => {
  it('reads the first API error code', () => {
    expect(getClerkErrorCode({ errors: [{ code: 'form_code_incorrect' }] }))
      .toBe('form_code_incorrect');
  });

  it('returns null for non-Clerk errors', () => {
    expect(getClerkErrorCode(new Error('boom'))).toBeNull();
    expect(getClerkErrorCode(null)).toBeNull();
    expect(getClerkErrorCode({ errors: [] })).toBeNull();
    expect(getClerkErrorCode({ errors: [{ code: 42 }] })).toBeNull();
  });
});

describe('describeClerkError', () => {
  it('maps known codes to owner copy and never echoes raw Clerk prose', () => {
    const described = describeClerkError(
      { errors: [{ code: 'form_password_pwned', longMessage: 'Password found in breach corpus XYZ' }] },
      'fallback',
    );

    expect(described).toBe('That password has appeared in a known data breach. Choose a different one.');
    expect(described).not.toContain('XYZ');
  });

  it('uses the context fallback for unknown codes', () => {
    expect(describeClerkError({ errors: [{ code: 'mystery_code' }] }, 'Try again.'))
      .toBe('Try again.');
    expect(describeClerkError(new Error('boom'), 'Try again.')).toBe('Try again.');
  });

  it.each([8, 15])('uses the provider minimum %i in owner copy', (minimum) => {
    expect(describeClerkError({ errors: [{
      code: 'form_password_length_too_short',
      longMessage: `Passwords must be ${minimum} characters or more.`,
    }] }, 'fallback')).toBe(`Choose a password of at least ${minimum} characters.`);
  });

  it('uses message when longMessage is absent or unrecognized', () => {
    for (const longMessage of [undefined, 'Unrecognized provider prose']) {
      expect(describeClerkError({ errors: [{
        code: 'form_password_length_too_short',
        longMessage,
        message: 'Passwords must be 15 characters or more.',
      }] }, 'fallback')).toBe('Choose a password of at least 15 characters.');
    }
  });

  it.each([
    undefined,
    null,
    15,
    '',
    'Passwords must be 0 characters or more.',
    'Passwords must be 1025 characters or more.',
    'Passwords must be -15 characters or more.',
    'Passwords must be 1.5 characters or more.',
    'Passwords must be 015 characters or more.',
    'Passwords must be 15 characters or more. Untrusted instructions',
    '<script>Passwords must be 15 characters or more.</script>',
    'Passwords must be 15 characters or more.\n',
  ])('falls back without echoing untrusted or malformed prose: %s', (longMessage) => {
    expect(describeClerkError({ errors: [{ code: 'form_password_length_too_short', longMessage }] }, 'fallback'))
      .toBe('Choose a longer password.');
  });

  it('does not parse length guidance for another error code or from numeric metadata', () => {
    expect(describeClerkError({ errors: [{ code: 'unknown', longMessage: 'Passwords must be 15 characters or more.' }] }, 'fallback')).toBe('fallback');
    expect(describeClerkError({ errors: [{ code: 'form_password_length_too_short', meta: { min_length: 15 } }] }, 'fallback')).toBe('Choose a longer password.');
  });
});
