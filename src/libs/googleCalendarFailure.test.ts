import { describe, expect, it } from 'vitest';

import {
  classifyApiFailure,
  classifyDecryptFailure,
  classifyMissingClientConfig,
  classifyNetworkFailure,
  classifyTokenRefreshFailure,
  formatPersistedError,
  statusForClassification,
} from './googleCalendarFailure';

describe('classifyTokenRefreshFailure', () => {
  it('treats invalid_grant as a confirmed, non-retryable reconnect', () => {
    const result = classifyTokenRefreshFailure({
      httpStatus: 400,
      error: 'invalid_grant',
      errorDescription: 'Token has been expired',
    });

    expect(result.kind).toBe('invalid_grant');
    expect(result.requiresReconnect).toBe(true);
    // Repeating the same refresh cannot change the answer.
    expect(result.retryable).toBe(false);
  });

  it('separates an explicit revocation from a plain expiry', () => {
    const revoked = classifyTokenRefreshFailure({
      httpStatus: 400,
      error: 'invalid_grant',
      errorDescription: 'Token has been expired or revoked.',
    });

    expect(revoked.kind).toBe('access_revoked');
    expect(revoked.requiresReconnect).toBe(true);
  });

  it('flags our own OAuth client as misconfigured rather than asking the salon to reconnect', () => {
    for (const error of ['invalid_client', 'unauthorized_client']) {
      const result = classifyTokenRefreshFailure({ httpStatus: 401, error });

      expect(result.kind).toBe('client_misconfigured');
      // Reconnecting cannot fix a server-side configuration problem.
      expect(result.requiresReconnect).toBe(false);
      expect(result.retryable).toBe(false);
    }
  });

  it.each([500, 502, 503, 429])('treats HTTP %s as temporary and retryable', (httpStatus) => {
    const result = classifyTokenRefreshFailure({ httpStatus });

    expect(result.kind).toBe('temporary');
    expect(result.requiresReconnect).toBe(false);
    expect(result.retryable).toBe(true);
  });

  it('never latches on an unrecognized response', () => {
    const result = classifyTokenRefreshFailure({ httpStatus: 418, error: 'something_new' });

    expect(result.requiresReconnect).toBe(false);
  });

  it('carries Google’s description into the persisted message', () => {
    const result = classifyTokenRefreshFailure({
      httpStatus: 400,
      error: 'invalid_grant',
      errorDescription: 'Token has been expired',
    });

    expect(result.message).toContain('Token has been expired');
  });
});

describe('classifyApiFailure', () => {
  it('treats 401 as requiring reconnect', () => {
    expect(classifyApiFailure(401)).toMatchObject({ kind: 'api_unauthorized', requiresReconnect: true });
  });

  it('treats a quota 403 as temporary, not a lost authorization', () => {
    const result = classifyApiFailure(403, 'Rate Limit Exceeded');

    expect(result.kind).toBe('temporary');
    expect(result.requiresReconnect).toBe(false);
  });

  it('treats a non-quota 403 as a lost authorization', () => {
    expect(classifyApiFailure(403, 'insufficient permissions')).toMatchObject({ kind: 'api_unauthorized' });
  });

  it.each([500, 503, 429])('treats HTTP %s as temporary', (status) => {
    expect(classifyApiFailure(status)).toMatchObject({ kind: 'temporary', retryable: true });
  });
});

describe('other classifiers', () => {
  it('does not ask for a reconnect when the stored token cannot be decrypted', () => {
    const result = classifyDecryptFailure();

    expect(result.kind).toBe('token_decrypt_failed');
    // Reconnecting would paper over a key-management problem.
    expect(result.requiresReconnect).toBe(false);
    expect(result.message).toMatch(/encryption key/i);
  });

  it('treats a network failure as temporary', () => {
    expect(classifyNetworkFailure('ECONNRESET')).toMatchObject({ kind: 'temporary', retryable: true });
  });

  it('treats missing client config as non-retryable and not a reconnect', () => {
    expect(classifyMissingClientConfig()).toMatchObject({
      kind: 'client_misconfigured',
      requiresReconnect: false,
      retryable: false,
    });
  });
});

describe('statusForClassification', () => {
  it('only latches for classifications that genuinely require reconnecting', () => {
    expect(statusForClassification(classifyTokenRefreshFailure({ httpStatus: 400, error: 'invalid_grant' })))
      .toBe('reconnect_required');
    expect(statusForClassification(classifyNetworkFailure())).toBe('degraded');
    expect(statusForClassification(classifyDecryptFailure())).toBe('degraded');
    expect(statusForClassification(classifyMissingClientConfig())).toBe('degraded');
  });
});

describe('formatPersistedError', () => {
  it('prefixes a greppable code and keeps the human text', () => {
    const persisted = formatPersistedError(classifyNetworkFailure('timeout'));

    expect(persisted).toMatch(/^\[temporary\] /);
    expect(persisted).toContain('timeout');
  });

  it('never contains a credential-looking value', () => {
    const persisted = formatPersistedError(classifyTokenRefreshFailure({
      httpStatus: 400,
      error: 'invalid_grant',
      errorDescription: 'Token has been expired',
    }));

    expect(persisted).not.toMatch(/refresh_token|client_secret|Bearer /i);
  });
});
