/**
 * X5 proofs — a hosted deployment must never send a paying customer to
 * `localhost`, and must never guess the production domain for a Preview
 * checkout (final handoff §6 row X5).
 *
 * `@/libs/Env` is mocked with a mutable holder (the pattern
 * `src/libs/billing/starterGrantBackfill.test.ts` uses) because
 * `NEXT_PUBLIC_APP_URL` is read through the validated `Env` object, while
 * `VERCEL` is read through bare `process.env` and is restored per test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Type-only: erased at compile time, so it cannot defeat the `vi.mock`
// hoisting the runtime `await import` below depends on.
import type { BillingAppOriginError as BillingAppOriginErrorType } from './billingAppOrigin';

vi.mock('server-only', () => ({}));

const envHolder = vi.hoisted(() => ({
  NEXT_PUBLIC_APP_URL: undefined as string | undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

const { BillingAppOriginError, resolveBillingAppOrigin } = await import('./billingAppOrigin');

const originalVercel = process.env.VERCEL;

/** Returns whatever `resolveBillingAppOrigin()` threw, or `null`. */
function captureThrow(): unknown {
  try {
    resolveBillingAppOrigin();
    return null;
  } catch (error) {
    return error;
  }
}

function setHostedRuntime(hosted: boolean): void {
  if (hosted) {
    process.env.VERCEL = '1';
  } else {
    delete process.env.VERCEL;
  }
}

beforeEach(() => {
  envHolder.NEXT_PUBLIC_APP_URL = undefined;
  setHostedRuntime(false);
});

afterEach(() => {
  if (originalVercel === undefined) {
    delete process.env.VERCEL;
  } else {
    process.env.VERCEL = originalVercel;
  }
});

describe('resolveBillingAppOrigin — configured', () => {
  it('returns the ORIGIN only, dropping a path, query and fragment', () => {
    envHolder.NEXT_PUBLIC_APP_URL = 'https://app.example.com/some/path?x-vercel-protection-bypass=tok#frag';

    expect(resolveBillingAppOrigin()).toBe('https://app.example.com');
  });

  it('keeps an explicit non-default port and drops a trailing slash', () => {
    envHolder.NEXT_PUBLIC_APP_URL = 'https://preview-deployment.example.com:8443/';

    expect(resolveBillingAppOrigin()).toBe('https://preview-deployment.example.com:8443');
  });

  it('trims surrounding whitespace before parsing', () => {
    envHolder.NEXT_PUBLIC_APP_URL = '  https://app.example.com  ';

    expect(resolveBillingAppOrigin()).toBe('https://app.example.com');
  });

  it('honours the configured origin on a hosted runtime too', () => {
    setHostedRuntime(true);
    envHolder.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

    expect(resolveBillingAppOrigin()).toBe('https://app.example.com');
  });

  it('accepts a plain http origin for a local/self-hosted runtime', () => {
    envHolder.NEXT_PUBLIC_APP_URL = 'http://127.0.0.1:4193';

    expect(resolveBillingAppOrigin()).toBe('http://127.0.0.1:4193');
  });
});

describe('resolveBillingAppOrigin — hosted runtime refuses to guess', () => {
  it('throws APP_ORIGIN_UNCONFIGURED when NEXT_PUBLIC_APP_URL is unset and VERCEL=1', () => {
    setHostedRuntime(true);

    expect(() => resolveBillingAppOrigin()).toThrow(BillingAppOriginError);
    expect(captureThrow()).toMatchObject({ code: 'APP_ORIGIN_UNCONFIGURED' });
  });

  it('throws for a blank / whitespace-only value on a hosted runtime', () => {
    setHostedRuntime(true);
    envHolder.NEXT_PUBLIC_APP_URL = '   ';

    expect(captureThrow()).toMatchObject({ code: 'APP_ORIGIN_UNCONFIGURED' });
  });

  it('throws for a value that is not an absolute URL on a hosted runtime', () => {
    setHostedRuntime(true);
    envHolder.NEXT_PUBLIC_APP_URL = 'app.example.com';

    expect(captureThrow()).toMatchObject({ code: 'APP_ORIGIN_UNCONFIGURED' });
  });

  it('refuses a non-http(s) scheme rather than returning its (null) origin', () => {
    setHostedRuntime(true);
    envHolder.NEXT_PUBLIC_APP_URL = 'javascript:alert(1)';

    expect(captureThrow()).toMatchObject({ code: 'APP_ORIGIN_UNCONFIGURED' });
  });

  it('never falls back to VERCEL_PROJECT_PRODUCTION_URL or VERCEL_URL — a Preview customer is not sent to production', () => {
    setHostedRuntime(true);
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'isla-nail-studio.vercel.app';
    process.env.VERCEL_URL = 'isla-nail-studio-git-preview.vercel.app';
    try {
      expect(captureThrow()).toMatchObject({ code: 'APP_ORIGIN_UNCONFIGURED' });
    } finally {
      delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
      delete process.env.VERCEL_URL;
    }
  });

  it('carries the code on the thrown error and names no secret value in the message', () => {
    setHostedRuntime(true);
    const caught = captureThrow();

    expect(caught).toBeInstanceOf(BillingAppOriginError);
    expect((caught as BillingAppOriginErrorType).code).toBe('APP_ORIGIN_UNCONFIGURED');
    expect((caught as Error).name).toBe('BillingAppOriginError');
    expect((caught as Error).message).toContain('APP_ORIGIN_UNCONFIGURED');
  });
});

describe('resolveBillingAppOrigin — local development', () => {
  it('returns localhost when NEXT_PUBLIC_APP_URL is unset and VERCEL is not 1', () => {
    expect(resolveBillingAppOrigin()).toBe('http://localhost:3000');
  });

  it('returns localhost for an unparseable value off a hosted runtime', () => {
    envHolder.NEXT_PUBLIC_APP_URL = 'not a url';

    expect(resolveBillingAppOrigin()).toBe('http://localhost:3000');
  });

  it('treats any VERCEL value other than the exact string "1" as not hosted', () => {
    process.env.VERCEL = 'true';
    try {
      expect(resolveBillingAppOrigin()).toBe('http://localhost:3000');
    } finally {
      delete process.env.VERCEL;
    }
  });
});
