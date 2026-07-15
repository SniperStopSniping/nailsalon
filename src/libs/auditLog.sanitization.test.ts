/* eslint-disable import/first */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));

import { sanitizeAuditMetadata } from './auditLog';

describe('sanitizeAuditMetadata', () => {
  it('recursively redacts credentials, tokens, cookies, authorization, and URLs', () => {
    expect(sanitizeAuditMetadata({
      environment: 'preview',
      password: 'never-store-this',
      nested: {
        invitationToken: 'secret-token',
        authorizationHeader: 'Bearer secret',
        callbackUrl: 'https://example.test/private',
        safe: ['ok', { sessionCookie: 'private' }],
      },
    })).toEqual({
      environment: 'preview',
      password: '[REDACTED]',
      nested: {
        invitationToken: '[REDACTED]',
        authorizationHeader: '[REDACTED]',
        callbackUrl: '[REDACTED]',
        safe: ['ok', { sessionCookie: '[REDACTED]' }],
      },
    });
  });
});
