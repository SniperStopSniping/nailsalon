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
});
