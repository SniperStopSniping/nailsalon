import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAnonymousDraftId, createDefaultBusinessProfile, createSecureBrowserToken } from './defaults';

describe('fresh owner setup defaults', () => {
  it('starts with direct contact and an adaptable public address default', () => {
    const profile = createDefaultBusinessProfile();

    expect(profile.bookingOnlyContact).toBe(false);
    expect(profile.location.addressVisibility).toBe('public');
    expect(profile.location.addressVisibilityDefaulted).toBe(true);
    expect(profile.clientContact.callEnabled).toBe(false);
    expect(profile.clientContact.textEnabled).toBe(false);
  });
});

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
