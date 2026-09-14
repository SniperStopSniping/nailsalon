/**
 * G27 — constant-time cron secret check. Pins the accepted header forms
 * exactly as the two former per-route `isAuthorized()` helpers accepted
 * them (raw `x-cron-secret`, or `Authorization: Bearer <secret>`), plus the
 * length-mismatch behavior `crypto.timingSafeEqual` cannot provide on its
 * own (it throws instead of returning `false`).
 */
import { describe, expect, it, vi } from 'vitest';

import { isAuthorizedCronRequest } from './cronAuth';

vi.mock('server-only', () => ({}));

function requestWith(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/billing/x', { method: 'POST', headers });
}

describe('isAuthorizedCronRequest', () => {
  it('accepts the raw x-cron-secret header form', () => {
    expect(isAuthorizedCronRequest(requestWith({ 'x-cron-secret': 'cron_test_secret' }), 'cron_test_secret')).toBe(true);
  });

  it('accepts the Authorization: Bearer header form', () => {
    expect(isAuthorizedCronRequest(requestWith({ authorization: 'Bearer cron_test_secret' }), 'cron_test_secret')).toBe(true);
  });

  it('rejects a wrong secret in either header form', () => {
    expect(isAuthorizedCronRequest(requestWith({ 'x-cron-secret': 'wrong_secret' }), 'cron_test_secret')).toBe(false);
    expect(isAuthorizedCronRequest(requestWith({ authorization: 'Bearer wrong_secret' }), 'cron_test_secret')).toBe(false);
  });

  it('rejects an empty header value', () => {
    expect(isAuthorizedCronRequest(requestWith({ 'x-cron-secret': '' }), 'cron_test_secret')).toBe(false);
  });

  it('rejects a request carrying neither header', () => {
    expect(isAuthorizedCronRequest(requestWith({}), 'cron_test_secret')).toBe(false);
  });

  it('rejects when the configured secret is undefined, even with a header present', () => {
    expect(isAuthorizedCronRequest(requestWith({ 'x-cron-secret': 'anything' }), undefined)).toBe(false);
  });

  it('rejects when the configured secret is an empty string', () => {
    expect(isAuthorizedCronRequest(requestWith({ 'x-cron-secret': '' }), '')).toBe(false);
  });

  it('rejects a length-mismatched value without throwing (crypto.timingSafeEqual would throw on unequal-length buffers)', () => {
    const longSecret = 'a-much-longer-cron-secret-value-than-the-header';

    expect(() => isAuthorizedCronRequest(requestWith({ 'x-cron-secret': 'short' }), longSecret)).not.toThrow();
    expect(isAuthorizedCronRequest(requestWith({ 'x-cron-secret': 'short' }), longSecret)).toBe(false);

    const longHeader = 'a-much-longer-header-value-than-the-secret';

    expect(() => isAuthorizedCronRequest(requestWith({ authorization: `Bearer ${longHeader}` }), 'short')).not.toThrow();
    expect(isAuthorizedCronRequest(requestWith({ authorization: `Bearer ${longHeader}` }), 'short')).toBe(false);
  });
});
