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

// Set up environment variables for testing
process.env.BILLING_PLAN_ENV = 'test';

// Tests must never connect to a real database. vitest.config.mts already
// strips DATABASE_URL from the .env files it loads; this covers values
// inherited from the shell or a CI job's environment so the in-memory
// PGlite database is always selected (src/libs/DB.ts).
delete process.env.DATABASE_URL;
