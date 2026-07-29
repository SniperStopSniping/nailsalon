import '@testing-library/jest-dom/vitest';

import { vi } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';

vi.mock('next/font/google', () => new Proxy({}, {
  get: () => () => ({
    className: 'font-mock',
    style: {},
    variable: 'font-mock-variable',
  }),
}));

failOnConsole({
  shouldFailOnDebug: true,
  shouldFailOnError: true,
  shouldFailOnInfo: true,
  shouldFailOnLog: true,
  shouldFailOnWarn: true,
});

// Override the required build-time provider fields with explicit non-secret
// values so unit tests do not depend on those fields in a local dotenv file.
process.env.CLERK_SECRET_KEY = 'ci-placeholder-not-a-secret';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_Y2kubHVzdGVyLmludmFsaWQk';
process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL = '/sign-in';
process.env.STRIPE_SECRET_KEY = 'ci-placeholder-not-a-secret';
process.env.STRIPE_WEBHOOK_SECRET = 'ci-placeholder-not-a-secret';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'ci-placeholder-not-a-secret';
process.env.BILLING_PLAN_ENV = 'test';

// Tests must never connect to a real database. vitest.config.mts already
// strips DATABASE_URL from the .env files it loads; this covers values
// inherited from the shell or a CI job's environment so the in-memory
// PGlite database is always selected (src/libs/DB.ts).
delete process.env.DATABASE_URL;
