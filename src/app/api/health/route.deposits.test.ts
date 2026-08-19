/**
 * Health surface: deposits schema probe and Connect env check
 * (charter tests 25 and 26, health legs).
 *
 * The point of both legs is that D2's new reporting is PURELY INFORMATIONAL.
 * Neither an unprovisioned deposits schema nor a missing Connect webhook secret
 * may move the `status` field, because `status` drives external uptime monitors
 * and paging. A deposits pilot that is not yet provisioned is a normal state for
 * every salon outside the pilot — it is not an outage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  executeMock,
  isRedisAvailableMock,
  schemaReadyMock,
  depositsReadyMock,
  isResendSenderVerifiedMock,
  schemaDriftStatusMock,
} = vi.hoisted(() => ({
  executeMock: vi.fn(),
  isRedisAvailableMock: vi.fn(),
  schemaReadyMock: vi.fn(),
  depositsReadyMock: vi.fn(),
  isResendSenderVerifiedMock: vi.fn(),
  schemaDriftStatusMock: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({
  db: { execute: executeMock },
}));

vi.mock('@/core/redis/redisClient', () => ({
  redis: {},
  isRedisAvailable: isRedisAvailableMock,
}));

vi.mock('@/libs/resendHealth', () => ({
  isResendSenderVerified: isResendSenderVerifiedMock,
}));

vi.mock('@/libs/clientLifecycleSchema', () => ({
  isClientLifecycleSchemaReady: schemaReadyMock,
}));

vi.mock('@/libs/depositsSchema', () => ({
  isDepositsSchemaReady: depositsReadyMock,
}));

vi.mock('@/libs/schemaReadiness', () => ({
  getSchemaDriftStatus: schemaDriftStatusMock,
}));

const { GET } = await import('./route');

const originalEnv = { ...process.env };

async function readHealth() {
  const response = await GET();
  return { response, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  // A healthy baseline: the DB answers, the lifecycle schema is ready. Only the
  // deposits/Connect signals vary per test.
  executeMock.mockResolvedValue([{ '?column?': 1 }]);
  isRedisAvailableMock.mockResolvedValue(true);
  isResendSenderVerifiedMock.mockResolvedValue(true);
  schemaReadyMock.mockResolvedValue(true);
  depositsReadyMock.mockResolvedValue(true);
  schemaDriftStatusMock.mockResolvedValue('ready');

  // The baseline must genuinely be `status: 'ok'`, otherwise "status is
  // unchanged" is vacuously true and neither leg below can ever fail. That
  // means satisfying every critical check (`route.ts:243-249`) and staying
  // unhosted so redis/resend/googleCalendar are not required.
  process.env = {
    ...originalEnv,
    STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect_health',
    CLERK_SECRET_KEY: 'sk_test_clerk',
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_clerk',
    SUPER_ADMIN_AUTH_MODE: 'password',
    SUPER_ADMIN_TEST_LOGIN_ENABLED: 'true',
    SUPER_ADMIN_TEST_PHONE: '+15555550100',
    SUPER_ADMIN_TEST_PASSWORD: 'health-fixture-password',
    LEGACY_OTP_AUTH_ENABLED: 'false',
  };
  delete process.env.VERCEL_ENV;
  delete process.env.APP_ENV;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('test 25 — the deposits schema probe is reported, not escalated', () => {
  it('reports depositsSchema: ready when the probe succeeds', async () => {
    const { body } = await readHealth();

    expect(body.depositsSchema).toBe('ready');
    // Pins the baseline this whole file depends on. If a fixture change makes
    // the baseline `degraded`, the "unchanged" legs below become vacuous — so
    // that must fail loudly here rather than silently disarm them.
    expect(body.status).toBe('ok');
  });

  it('reports not_ready without moving status', async () => {
    // D1's tables can be absent on any environment the migration has not
    // reached yet. That is a provisioning fact, not a service failure.
    //
    // The assertion is that the probe does not MOVE `status`, so it is made
    // against a baseline reading rather than a hardcoded literal: whatever the
    // other checks in this fixture decide, the deposits leg must not change it.
    const baseline = await readHealth();

    depositsReadyMock.mockResolvedValue(false);
    const notReady = await readHealth();

    expect(baseline.body.depositsSchema).toBe('ready');
    expect(notReady.body.depositsSchema).toBe('not_ready');
    expect(notReady.body.status).toBe(baseline.body.status);
    expect(notReady.response.status).toBe(baseline.response.status);
  });

  it('a throwing probe degrades to unavailable, still without moving status', async () => {
    // `isDepositsSchemaReady` is specified never to throw; if it somehow does,
    // the health endpoint still must not turn a reporting failure into an
    // outage signal.
    const baseline = await readHealth();

    depositsReadyMock.mockRejectedValue(new Error('relation does not exist'));
    const unavailable = await readHealth();

    expect(unavailable.body.depositsSchema).toBe('unavailable');
    expect(unavailable.body.status).toBe(baseline.body.status);
    expect(unavailable.response.status).toBe(baseline.response.status);
  });

  it('never leaks raw Postgres text into the payload', async () => {
    depositsReadyMock.mockRejectedValue(
      new Error('relation "appointment_deposit" does not exist at character 15'),
    );

    const { body } = await readHealth();

    expect(JSON.stringify(body)).not.toContain('does not exist');
    expect(JSON.stringify(body)).not.toContain('appointment_deposit');
  });
});

describe('test 26 — the Connect env check is reported, not escalated', () => {
  it('is true when STRIPE_CONNECT_WEBHOOK_SECRET is set', async () => {
    const { body } = await readHealth();

    expect(body.checks.stripeConnectEnv).toBe(true);
  });

  it('is false when unset, and status matches the fixture that has it set', async () => {
    // Asserting the two statuses against each other (rather than against a
    // hardcoded 'ok') is what makes this a real separation test: if a later
    // change wires stripeConnectEnv into the critical set, these diverge.
    const withSecret = await readHealth();

    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    const withoutSecret = await readHealth();

    expect(withoutSecret.body.checks.stripeConnectEnv).toBe(false);
    expect(withSecret.body.checks.stripeConnectEnv).toBe(true);
    expect(withoutSecret.body.status).toBe(withSecret.body.status);
    expect(withoutSecret.response.status).toBe(withSecret.response.status);
  });
});
