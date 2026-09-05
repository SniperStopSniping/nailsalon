import { describe, expect, it } from 'vitest';

import { hasClerkSessionCookie } from './clerkSessionCookie';

describe('hasClerkSessionCookie', () => {
  it.each(['__session', '__session_XxiNjKcO', '__session_A-b_c123'])(
    'recognizes nonempty Clerk cookie %s without authenticating its value',
    (name) => {
      expect(hasClerkSessionCookie([{ name, value: 'unverified-token' }])).toBe(true);
    },
  );

  it.each(['__session', '__session_XxiNjKcO'])(
    'ignores an empty or cleared %s cookie',
    (name) => {
      expect(hasClerkSessionCookie([{ name, value: '' }])).toBe(false);
      expect(hasClerkSessionCookie([{ name, value: ' ' }])).toBe(false);
    },
  );

  it.each(['__session_', '__sessionOther', '__session.bad', '__session_bad.name', '__client_uat', 'n5_admin_session'])(
    'does not mistake %s for a Clerk session cookie',
    (name) => {
      expect(hasClerkSessionCookie([{ name, value: 'unverified-token' }])).toBe(false);
    },
  );

  it('finds the instance cookie even when the bare cookie was cleared', () => {
    expect(hasClerkSessionCookie([
      { name: '__session', value: '' },
      { name: '__session_XxiNjKcO', value: 'unverified-token' },
    ])).toBe(true);
    expect(hasClerkSessionCookie([])).toBe(false);
  });
});
