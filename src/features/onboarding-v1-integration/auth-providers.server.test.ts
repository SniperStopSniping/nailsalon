import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/* eslint-disable import/first */
import {
  deriveAuthProviderAvailability,
  fetchOnboardingAuthProviderAvailability,
  parseClerkFrontendApiOrigin,
  resetAuthProviderAvailabilityCacheForTests,
} from './auth-providers.server';
/* eslint-enable import/first */

const TEST_FAPI_HOST = 'musical-muskox-47.clerk.accounts.dev';
const TEST_PUBLISHABLE_KEY = `pk_test_${Buffer.from(`${TEST_FAPI_HOST}$`).toString('base64')}`;

const environmentDocument = (overrides: {
  apple?: { authenticatable: boolean; enabled: boolean };
  email?: { enabled: boolean; used_for_first_factor: boolean };
  google?: { authenticatable: boolean; enabled: boolean };
}) => ({
  user_settings: {
    attributes: {
      email_address: overrides.email ?? { enabled: true, used_for_first_factor: true },
    },
    social: {
      ...(overrides.apple ? { oauth_apple: overrides.apple } : {}),
      ...(overrides.google ? { oauth_google: overrides.google } : {}),
    },
  },
});

describe('parseClerkFrontendApiOrigin', () => {
  it('derives the frontend API origin from a publishable key', () => {
    expect(parseClerkFrontendApiOrigin(TEST_PUBLISHABLE_KEY))
      .toBe(`https://${TEST_FAPI_HOST}`);
  });

  it('rejects malformed keys instead of guessing', () => {
    expect(parseClerkFrontendApiOrigin('')).toBeNull();
    expect(parseClerkFrontendApiOrigin('pk_test_not-base64!!')).toBeNull();
    expect(parseClerkFrontendApiOrigin('sk_test_abc')).toBeNull();
    expect(parseClerkFrontendApiOrigin(`pk_test_${Buffer.from('no-dollar').toString('base64')}`)).toBeNull();
  });
});

describe('deriveAuthProviderAvailability', () => {
  it('reflects every configured provider', () => {
    expect(deriveAuthProviderAvailability(environmentDocument({
      apple: { authenticatable: true, enabled: true },
      google: { authenticatable: true, enabled: true },
    }))).toEqual({
      apple: true,
      email: true,
      google: true,
      source: 'clerk-environment',
    });
  });

  it('omits a connection that exists but is disabled or not authenticatable', () => {
    expect(deriveAuthProviderAvailability(environmentDocument({
      apple: { authenticatable: true, enabled: false },
      google: { authenticatable: false, enabled: true },
    }))).toEqual({
      apple: false,
      email: true,
      google: false,
      source: 'clerk-environment',
    });
  });

  it('omits email when it is not a first factor', () => {
    expect(deriveAuthProviderAvailability(environmentDocument({
      email: { enabled: true, used_for_first_factor: false },
    })).email).toBe(false);
  });
});

describe('fetchOnboardingAuthProviderAvailability', () => {
  beforeEach(() => {
    resetAuthProviderAvailabilityCacheForTests();
  });

  it('reads the live environment document', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(environmentDocument({
      google: { authenticatable: true, enabled: true },
    }))));

    const availability = await fetchOnboardingAuthProviderAvailability({
      fetcher: fetcher as unknown as typeof fetch,
      publishableKey: TEST_PUBLISHABLE_KEY,
    });

    expect(availability).toEqual({
      apple: false,
      email: true,
      google: true,
      source: 'clerk-environment',
    });
    expect(fetcher).toHaveBeenCalledWith(
      `https://${TEST_FAPI_HOST}/v1/environment`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('falls back to email-only when the environment cannot be read', async () => {
    const failing = vi.fn(async () => {
      throw new Error('network down');
    });

    const availability = await fetchOnboardingAuthProviderAvailability({
      fetcher: failing as unknown as typeof fetch,
      publishableKey: TEST_PUBLISHABLE_KEY,
    });

    expect(availability).toEqual({
      apple: false,
      email: true,
      google: false,
      source: 'fallback',
    });
  });

  it('falls back on a non-OK response and on an unparsable key', async () => {
    const serverError = vi.fn(async () => new Response('nope', { status: 500 }));

    expect((await fetchOnboardingAuthProviderAvailability({
      fetcher: serverError as unknown as typeof fetch,
      publishableKey: TEST_PUBLISHABLE_KEY,
    })).source).toBe('fallback');
    expect((await fetchOnboardingAuthProviderAvailability({
      publishableKey: 'not-a-key',
    })).source).toBe('fallback');
  });
});
