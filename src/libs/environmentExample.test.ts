import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'dotenv';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertEnvironmentIsolation,
  EnvironmentIsolationError,
} from './environmentIsolation';

vi.mock('./DB', () => {
  throw new Error('The environment template validator must not load the database.');
});
vi.mock('@clerk/nextjs/server', () => {
  throw new Error('The environment template validator must not load Clerk.');
});
vi.mock('./stripe', () => {
  throw new Error('The environment template validator must not load Stripe.');
});
vi.mock('stripe', () => {
  throw new Error('The environment template validator must not load Stripe.');
});

function readDevelopmentExample(): Record<string, string> {
  return parse(readFileSync(join(process.cwd(), '.env.example')));
}

function requiredExampleValue(
  environment: Record<string, string>,
  key: string,
): string {
  const value = environment[key];
  if (!value) {
    throw new Error(`The Development environment example is missing ${key}.`);
  }

  return value;
}

function expectCode(
  operation: () => unknown,
  code: EnvironmentIsolationError['code'],
) {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(EnvironmentIsolationError);
    expect((error as EnvironmentIsolationError).code).toBe(code);

    return;
  }
  throw new Error(`Expected environment isolation error ${code}.`);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Development environment example', () => {
  it('passes the real validator with fake test-mode providers and local PGlite', () => {
    const environment = readDevelopmentExample();
    const clerkPublishableKey = requiredExampleValue(
      environment,
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(environment.DATABASE_URL).toBe('');
    expect(
      Buffer.from(
        clerkPublishableKey.replace('pk_test_', ''),
        'base64',
      ).toString('utf8'),
    ).toBe('clerk-dev.invalid$');
    expect(assertEnvironmentIsolation(environment)).toBe('development');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects live-mode provider prefixes copied into the Development template', () => {
    const environment = readDevelopmentExample();
    const clerkSecretKey = requiredExampleValue(environment, 'CLERK_SECRET_KEY');
    const clerkPublishableKey = requiredExampleValue(
      environment,
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    );
    const stripeSecretKey = requiredExampleValue(environment, 'STRIPE_SECRET_KEY');
    const stripePublishableKey = requiredExampleValue(
      environment,
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expectCode(
      () => assertEnvironmentIsolation({
        ...environment,
        CLERK_SECRET_KEY: clerkSecretKey.replace('sk_test_', 'sk_live_'),
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
          clerkPublishableKey.replace('pk_test_', 'pk_live_'),
      }),
      'CLERK_KEY_MODE_INVALID',
    );
    expectCode(
      () => assertEnvironmentIsolation({
        ...environment,
        STRIPE_SECRET_KEY: stripeSecretKey.replace('sk_test_', 'sk_live_'),
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
          stripePublishableKey.replace('pk_test_', 'pk_live_'),
      }),
      'STRIPE_KEY_MODE_INVALID',
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
