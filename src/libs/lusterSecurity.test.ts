import { describe, expect, it } from 'vitest';

import {
  createOpaqueToken,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  hashOpaqueToken,
  signOAuthState,
  verifyOAuthState,
} from './lusterSecurity';

describe('Luster integration security', () => {
  it('stores only a stable hash for opaque capabilities', () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();

    expect(first.token).not.toBe(first.tokenHash);
    expect(first.tokenHash).toBe(hashOpaqueToken(first.token));
    expect(second.tokenHash).not.toBe(first.tokenHash);
  });

  it('encrypts refresh tokens with authenticated encryption', () => {
    const encrypted = encryptIntegrationSecret('refresh-token-secret');

    expect(encrypted.ciphertext).not.toContain('refresh-token-secret');
    expect(decryptIntegrationSecret(encrypted.ciphertext)).toBe('refresh-token-secret');
    expect(() => decryptIntegrationSecret(`${encrypted.ciphertext.slice(0, -2)}aa`)).toThrow();
  });

  it('signs OAuth state and rejects tampering', () => {
    const state = signOAuthState({ provider: 'google', salonId: 'salon_1' });

    expect(verifyOAuthState<{ provider: string; salonId: string }>(state)).toMatchObject({ provider: 'google', salonId: 'salon_1' });
    expect(() => verifyOAuthState(`${state}tampered`)).toThrow('Invalid OAuth state signature');
  });

  it('rejects expired OAuth state', () => {
    const state = signOAuthState({ provider: 'twilio', salonId: 'salon_1' }, -1);

    expect(() => verifyOAuthState(state)).toThrow('OAuth state has expired');
  });
});
