import { describe, expect, it, vi } from 'vitest';

import {
  createOpaqueToken,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  hashOpaqueToken,
  signOAuthState,
  verifyOAuthState,
} from './lusterSecurity';

// lusterSecurity.ts now declares `import 'server-only'` (architecture
// hardening H3 fix, MINOR-2: it derives AES-256-GCM/HMAC keys from Env
// secrets but had no structural marker, so a 'use client' module could
// value-import it undetected). Same repo-wide convention every other
// `.server.ts`/`server-only`-declaring module's own test file already
// follows (e.g. `depositPolicy.server.test.ts`, `catalogResolver.server.test.ts`).
vi.mock('server-only', () => ({}));

describe('Luster integration security', () => {
  it('stores only a stable hash for opaque capabilities', () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();

    expect(first.token).not.toBe(first.tokenHash);
    expect(first.tokenHash).toBe(hashOpaqueToken(first.token));
    expect(second.tokenHash).not.toBe(first.tokenHash);
  });

  it.each([
    ['ciphertext', 4],
    ['authentication tag', 3],
  ] as const)('encrypts refresh tokens and rejects a modified %s', (_label, partIndex) => {
    const encrypted = encryptIntegrationSecret('refresh-token-secret');

    expect(encrypted.ciphertext).not.toContain('refresh-token-secret');
    expect(decryptIntegrationSecret(encrypted.ciphertext)).toBe('refresh-token-secret');

    // Changing base64url padding bits can leave the decoded bytes unchanged.
    // Flip an actual byte so every generated token is meaningfully tampered with.
    const tampered = encrypted.ciphertext.split('.');
    const bytes = Buffer.from(tampered[partIndex] ?? '', 'base64url');
    bytes.writeUInt8(bytes.readUInt8(0) ^ 0x01, 0);
    tampered[partIndex] = bytes.toString('base64url');

    expect(() => decryptIntegrationSecret(tampered.join('.'))).toThrow();
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
