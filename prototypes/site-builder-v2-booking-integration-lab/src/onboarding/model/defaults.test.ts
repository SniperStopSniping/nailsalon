import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAnonymousDraftId, createSecureBrowserToken } from './defaults';

describe('secure browser onboarding identifiers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses getRandomValues when randomUUID is unavailable on an insecure LAN origin', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_, index) => {
          bytes[index] = index + 1;
        });
        return bytes;
      },
    });

    expect(createAnonymousDraftId()).toBe(
      'draft_0102030405060708090a0b0c0d0e0f101112131415161718',
    );
    expect(createSecureBrowserToken('claim')).toBe(
      'claim_0102030405060708090a0b0c0d0e0f101112131415161718',
    );
  });

  it('fails closed when the browser exposes no secure random primitive', () => {
    vi.stubGlobal('crypto', {});

    expect(() => createAnonymousDraftId()).toThrow(
      'Secure random number generation is unavailable.',
    );
  });
});
