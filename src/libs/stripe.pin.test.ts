/**
 * The pinned Stripe API version (charter test 27).
 *
 * The obvious form — `expect(EXPECTED_STRIPE_API_VERSION).toBe(stripe.getApiField('version'))`
 * — is TAUTOLOGICAL and deliberately not written here: `getApiField('version')`
 * returns the configured `apiVersion`, so after the pin both sides are the same
 * value by construction.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { EXPECTED_STRIPE_API_VERSION } = await import('./stripe');

describe('test 27 — API version pin', () => {
  it('(a) equals the exact literal recorded in the provisioning proof', () => {
    // Hardcoded on purpose. A later PR in this programme imports this symbol by
    // name and path, and the Connect endpoint's `api_version` is fixed at
    // creation, so this literal is the ladder's single source of truth.
    expect(EXPECTED_STRIPE_API_VERSION).toBe('2024-06-20');
  });

  it('(b) the shared client is ACTUALLY pinned', () => {
    // Deleting the `apiVersion` option would leave (a) and (c) green while the
    // client silently reverted to the SDK default. `getApiField` cannot detect
    // that; reading the source can.
    const source = readFileSync(path.join(process.cwd(), 'src/libs/stripe.ts'), 'utf8');

    expect(source).toMatch(/apiVersion:\s*EXPECTED_STRIPE_API_VERSION/);
  });

  it('(c) SDK-drift canary', () => {
    // When an SDK upgrade breaks this, the usual correct response is to KEEP the
    // pin and update this expectation deliberately, because the Stripe
    // endpoint's `api_version` is immutable — never to follow the SDK.
    // `getApiField` is not on the public type surface, but it is the only way to
    // read what an unpinned client would actually send.
    const unpinned = new Stripe('sk_test_placeholder') as unknown as {
      getApiField: (key: string) => string;
    };

    expect(unpinned.getApiField('version')).toBe(EXPECTED_STRIPE_API_VERSION);
  });
});
