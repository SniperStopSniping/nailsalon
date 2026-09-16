/**
 * Setup for the REAL-MODEL eval run only (A1-4, deliverable F).
 *
 * It is the repo's `vitest-setup.ts` minus two things, both deliberate:
 *   - no `@testing-library/jest-dom` and no `next/font` proxy: this run renders
 *     nothing;
 *   - no `vitest-fail-on-console`: the live provider adapter, the Redis client
 *     and the runner itself legitimately report progress, and a real-model run
 *     must not be failed by a log line. The CI suites keep that rule; this run
 *     is not a CI suite.
 *
 * What it KEEPS is the part that matters: the same placeholder provider
 * variables, and the same unconditional `delete process.env.DATABASE_URL`, so
 * this run can never reach a real database no matter what the operator's shell
 * or dotenv files carry. The only network this process may open is the model
 * provider's.
 *
 * Deliberately NOT overridden: `OPENAI_API_KEY_OWNER`, `OWNER_ASSISTANT_MODEL`,
 * `OWNER_ASSISTANT_TOOLS` and the eval's own variables — those are the
 * operator's, and the run is about them.
 */
process.env.CLERK_SECRET_KEY = 'eval-placeholder-not-a-secret';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_Y2kubHVzdGVyLmludmFsaWQk';
process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL = '/sign-in';
process.env.STRIPE_SECRET_KEY = 'eval-placeholder-not-a-secret';
process.env.STRIPE_WEBHOOK_SECRET = 'eval-placeholder-not-a-secret';
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'eval-placeholder-not-a-secret';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'eval-placeholder-not-a-secret';
process.env.BILLING_PLAN_ENV = 'test';

delete process.env.DATABASE_URL;
