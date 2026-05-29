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
