import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const {
  executeMock,
  isRedisAvailableMock,
  schemaReadyMock,
  schemaDriftStatusMock,
} = vi.hoisted(() => ({
  executeMock: vi.fn(),
  isRedisAvailableMock: vi.fn(),
  schemaReadyMock: vi.fn(),
  schemaDriftStatusMock: vi.fn(),
}));

const { isResendSenderVerifiedMock } = vi.hoisted(() => ({
  isResendSenderVerifiedMock: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({
  db: {
    execute: executeMock,
  },
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

vi.mock('@/libs/schemaReadiness', () => ({
  getSchemaDriftStatus: schemaDriftStatusMock,
}));

describe('GET /api/health', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    isResendSenderVerifiedMock.mockResolvedValue(false);
    schemaReadyMock.mockResolvedValue(true);
    schemaDriftStatusMock.mockResolvedValue('ready');
    process.env = { ...originalEnv };
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    delete process.env.META_SYSTEM_USER_TOKEN;
    delete process.env.META_FACEBOOK_PAGE_ID;
    delete process.env.META_INSTAGRAM_ACCOUNT_ID;
    delete process.env.CRON_SECRET;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_VERIFY_SERVICE_SID;
    delete process.env.TWILIO_PHONE_NUMBER;
    delete process.env.TWILIO_CONNECT_APP_SID;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    delete process.env.SENTRY_ORG;
    delete process.env.SENTRY_PROJECT;
    delete process.env.SENTRY_AUTH_TOKEN;
    delete process.env.GOOGLE_CALENDAR_ENABLED;
    delete process.env.GOOGLE_CALENDAR_ID;
    delete process.env.GOOGLE_CALENDAR_CLIENT_EMAIL;
    delete process.env.GOOGLE_CALENDAR_PRIVATE_KEY;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    delete process.env.OAUTH_STATE_SECRET;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_ENV;
    delete process.env.APP_ENV;
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.SUPER_ADMIN_AUTH_MODE;
    delete process.env.SUPER_ADMIN_TEST_LOGIN_ENABLED;
    delete process.env.SUPER_ADMIN_TEST_PHONE;
    delete process.env.SUPER_ADMIN_TEST_PASSWORD;
    delete process.env.LEGACY_OTP_AUTH_ENABLED;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns expanded env status using the actual Cloudinary variable names', async () => {
    executeMock.mockResolvedValue([{ '?column?': 1 }]);
    isRedisAvailableMock.mockResolvedValue(true);

    process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
    process.env.CLOUDINARY_API_KEY = 'cloud-key';
    process.env.CLOUDINARY_API_SECRET = 'cloud-secret';
    process.env.META_SYSTEM_USER_TOKEN = 'meta-token';
    process.env.META_FACEBOOK_PAGE_ID = '123456';
    process.env.META_INSTAGRAM_ACCOUNT_ID = 'ig_123';
    process.env.CRON_SECRET = 'cron-secret';
    process.env.TWILIO_ACCOUNT_SID = 'twilio-sid';
    process.env.TWILIO_AUTH_TOKEN = 'twilio-token';
    process.env.TWILIO_VERIFY_SERVICE_SID = 'verify-sid';
    process.env.TWILIO_PHONE_NUMBER = '+15555550000';
    process.env.TWILIO_CONNECT_APP_SID = 'connect-app-sid';
    process.env.RESEND_API_KEY = 'resend-key';
    process.env.RESEND_FROM_EMAIL = 'hello@example.com';
    process.env.STRIPE_SECRET_KEY = 'stripe-secret';
    process.env.STRIPE_WEBHOOK_SECRET = 'stripe-webhook';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'stripe-connect-webhook';
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'stripe-public';
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://dsn.example/1';
    process.env.SENTRY_ORG = 'acme';
    process.env.SENTRY_PROJECT = 'salon';
    process.env.SENTRY_AUTH_TOKEN = 'token';
    process.env.GOOGLE_CALENDAR_ENABLED = 'true';
    process.env.GOOGLE_CALENDAR_ID = 'calendar@example.com';
    process.env.GOOGLE_CALENDAR_CLIENT_EMAIL = 'calendar-bot@example.iam.gserviceaccount.com';
    process.env.GOOGLE_CALENDAR_PRIVATE_KEY = 'private-key';
    process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef123456';
    process.env.CLERK_SECRET_KEY = 'clerk-secret';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'clerk-public';
    process.env.SUPER_ADMIN_AUTH_MODE = 'password';
    process.env.SUPER_ADMIN_TEST_LOGIN_ENABLED = 'true';
    process.env.SUPER_ADMIN_TEST_PHONE = '+14165550123';
    process.env.SUPER_ADMIN_TEST_PASSWORD = 'fake-test-passcode';
    process.env.LEGACY_OTP_AUTH_ENABLED = 'false';
    isResendSenderVerifiedMock.mockResolvedValue(true);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: 'ok',
      checks: {
        db: true,
        redis: true,
        clerkEnv: true,
        passwordAuthEnv: true,
        cloudinaryEnv: true,
        metaEnv: true,
        cronSecretConfigured: true,
        twilioEnv: true,
        resendEnv: true,
        resendVerified: true,
        stripeEnv: true,
        stripeConnectEnv: true,
        sentryEnv: true,
        googleCalendarEnv: true,
      },
      clientLifecycleSchema: 'ready',
      // Reported but deliberately excluded from `criticalChecksPass`: the
      // deposits foundation must never be able to degrade production health.
      depositsSchema: expect.any(String),
      schemaDrift: 'ready',
      timestamp: expect.any(String),
      gitSha: 'abcdef1',
    });
  });

  // Charter test 26. Expect `stripeConnectEnv: false` for exactly the window
  // between deploying D2 and the owner provisioning the Connect endpoint — that
  // is the control working, not a regression, which is why the overall `status`
  // must be identical either way.
  it('reports the Connect secret as absent WITHOUT degrading overall status', async () => {
    isResendSenderVerifiedMock.mockResolvedValue(true);

    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'stripe-connect-webhook';
    const withSecret = await (await GET()).json();

    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    const withoutSecret = await (await GET()).json();

    expect(withSecret.checks.stripeConnectEnv).toBe(true);
    expect(withoutSecret.checks.stripeConnectEnv).toBe(false);
    // D2 must never be able to degrade production health.
    expect(withoutSecret.status).toBe(withSecret.status);
  });

  it('returns degraded when the database is unreachable', async () => {
    executeMock.mockRejectedValue(new Error('db down'));
    isRedisAvailableMock.mockResolvedValue(false);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.db).toBe(false);
    expect(body.clientLifecycleSchema).toBe('unavailable');
  });

  it('returns 503 in hosted Production when lifecycle schema is not ready', async () => {
    executeMock.mockResolvedValue([{ '?column?': 1 }]);
    schemaReadyMock.mockResolvedValue(false);
    isRedisAvailableMock.mockResolvedValue(true);
    isResendSenderVerifiedMock.mockResolvedValue(true);

    process.env.VERCEL_ENV = 'production';
    process.env.CLERK_SECRET_KEY = 'clerk-secret';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'clerk-public';
    process.env.SUPER_ADMIN_AUTH_MODE = 'password';
    process.env.SUPER_ADMIN_TEST_LOGIN_ENABLED = 'true';
    process.env.SUPER_ADMIN_TEST_PHONE = '+14165550123';
    process.env.SUPER_ADMIN_TEST_PASSWORD = 'fake-test-passcode';
    process.env.LEGACY_OTP_AUTH_ENABLED = 'false';
    process.env.RESEND_API_KEY = 'resend-key';
    process.env.RESEND_FROM_EMAIL = 'hello@example.com';
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://example.com/oauth';
    process.env.INTEGRATION_ENCRYPTION_KEY = 'integration-key';
    process.env.OAUTH_STATE_SECRET = 'oauth-secret';

    const response = await GET();
    const body = await response.json();
    const serializedBody = JSON.stringify(body);

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.db).toBe(true);
    expect(body.clientLifecycleSchema).toBe('not_ready');
    expect(serializedBody).not.toContain('migration');
    expect(serializedBody).not.toContain('trigger');
    expect(serializedBody).not.toContain('capability');
  });

  it('keeps database health separate from a private readiness error', async () => {
    executeMock.mockResolvedValue([{ '?column?': 1 }]);
    schemaReadyMock.mockRejectedValue(
      new Error('private catalog detail must not escape'),
    );
    process.env.VERCEL_ENV = 'production';

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.checks.db).toBe(true);
    expect(body.clientLifecycleSchema).toBe('unavailable');
    expect(JSON.stringify(body)).not.toContain(
      'private catalog detail must not escape',
    );
  });

  // Schema-drift readiness (production schema-drift incident hardening). This
  // is what would have caught code deployed expecting migrations through
  // 0072 while the database was still at 0068: the release must not report
  // full readiness when the expected migration tail is newer than what the
  // database has applied.
  it('returns 503 in hosted Production when schema drift is not ready', async () => {
    executeMock.mockResolvedValue([{ '?column?': 1 }]);
    isRedisAvailableMock.mockResolvedValue(true);
    isResendSenderVerifiedMock.mockResolvedValue(true);
    schemaDriftStatusMock.mockResolvedValue('not_ready');

    process.env.VERCEL_ENV = 'production';
    process.env.CLERK_SECRET_KEY = 'clerk-secret';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'clerk-public';
    process.env.SUPER_ADMIN_AUTH_MODE = 'password';
    process.env.SUPER_ADMIN_TEST_LOGIN_ENABLED = 'true';
    process.env.SUPER_ADMIN_TEST_PHONE = '+14165550123';
    process.env.SUPER_ADMIN_TEST_PASSWORD = 'fake-test-passcode';
    process.env.LEGACY_OTP_AUTH_ENABLED = 'false';
    process.env.RESEND_API_KEY = 'resend-key';
    process.env.RESEND_FROM_EMAIL = 'hello@example.com';
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://example.com/oauth';
    process.env.INTEGRATION_ENCRYPTION_KEY = 'integration-key';
    process.env.OAUTH_STATE_SECRET = 'oauth-secret';

    const response = await GET();
    const body = await response.json();
    const serializedBody = JSON.stringify(body);

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.db).toBe(true);
    expect(body.schemaDrift).toBe('not_ready');
    // Bounded status only — never raw migration tags/filenames or counts.
    expect(serializedBody).not.toContain('migration');
    expect(serializedBody).not.toContain('journal');
    expect(serializedBody).not.toContain('0072');
    expect(serializedBody).not.toContain('0068');
  });

  // MAJOR-2 (adversarial review, ADR 0007 Consequences): dev and production
  // share one Neon database, and this repo's safe deploy order is manual
  // migrate-then-deploy, so a count-ahead reading is routine, safe operation
  // — not an incident. Checkly pages on any non-'ok' status every 10 minutes
  // (checkly.config.ts, tests/e2e/Sanity.check.e2e.ts), so gating on `ahead`
  // would page for the entire manual migrate-then-deploy window on every
  // migration-bearing release, and for any developer migrating the shared
  // database with no release involved at all — training the on-call owner
  // that "degraded" usually just means "the process is working", which is
  // exactly how a real `behind` incident gets ignored. `ahead` must stay
  // visible in the body without paging.
  it('reports schemaDrift: ahead in the body but does NOT degrade status in hosted Production', async () => {
    executeMock.mockResolvedValue([{ '?column?': 1 }]);
    isRedisAvailableMock.mockResolvedValue(true);
    isResendSenderVerifiedMock.mockResolvedValue(true);
    schemaDriftStatusMock.mockResolvedValue('ahead');

    process.env.VERCEL_ENV = 'production';
    process.env.CLERK_SECRET_KEY = 'clerk-secret';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'clerk-public';
    process.env.SUPER_ADMIN_AUTH_MODE = 'password';
    process.env.SUPER_ADMIN_TEST_LOGIN_ENABLED = 'true';
    process.env.SUPER_ADMIN_TEST_PHONE = '+14165550123';
    process.env.SUPER_ADMIN_TEST_PASSWORD = 'fake-test-passcode';
    process.env.LEGACY_OTP_AUTH_ENABLED = 'false';
    process.env.RESEND_API_KEY = 'resend-key';
    process.env.RESEND_FROM_EMAIL = 'hello@example.com';
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://example.com/oauth';
    process.env.INTEGRATION_ENCRYPTION_KEY = 'integration-key';
    process.env.OAUTH_STATE_SECRET = 'oauth-secret';

    const response = await GET();
    const body = await response.json();

    // Visible and diagnosable...
    expect(body.schemaDrift).toBe('ahead');
    // ...but does NOT page.
    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('still degrades hosted Production for "not_ready" — only "ahead" is excluded from gating', async () => {
    // Pins the boundary of the MAJOR-2 exclusion: `behind` (surfaced to the
    // route as generic "not_ready") is the actual incident class and MUST
    // still page. Only `ahead` gets the exemption.
    executeMock.mockResolvedValue([{ '?column?': 1 }]);
    isRedisAvailableMock.mockResolvedValue(true);
    isResendSenderVerifiedMock.mockResolvedValue(true);
    schemaDriftStatusMock.mockResolvedValue('not_ready');

    process.env.VERCEL_ENV = 'production';
    process.env.CLERK_SECRET_KEY = 'clerk-secret';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'clerk-public';
    process.env.SUPER_ADMIN_AUTH_MODE = 'password';
    process.env.SUPER_ADMIN_TEST_LOGIN_ENABLED = 'true';
    process.env.SUPER_ADMIN_TEST_PHONE = '+14165550123';
    process.env.SUPER_ADMIN_TEST_PASSWORD = 'fake-test-passcode';
    process.env.LEGACY_OTP_AUTH_ENABLED = 'false';
    process.env.RESEND_API_KEY = 'resend-key';
    process.env.RESEND_FROM_EMAIL = 'hello@example.com';
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://example.com/oauth';
    process.env.INTEGRATION_ENCRYPTION_KEY = 'integration-key';
    process.env.OAUTH_STATE_SECRET = 'oauth-secret';

    const response = await GET();
    const body = await response.json();

    expect(body.schemaDrift).toBe('not_ready');
    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
  });

  it('does NOT degrade status outside of hosted Production when schema drift is not ready', async () => {
    // Preview/local environments may legitimately run ahead of an
    // un-migrated database during development. Only real production gates
    // overall status on this — the same scoping clientLifecycleSchema uses.
    executeMock.mockResolvedValue([{ '?column?': 1 }]);
    schemaDriftStatusMock.mockResolvedValue('not_ready');
    isResendSenderVerifiedMock.mockResolvedValue(true);

    // Deliberately unhosted: no VERCEL_ENV/APP_ENV. clerkEnv/passwordAuthEnv
    // are required unconditionally, so they still need to be set for the
    // baseline to actually be `ok` — otherwise this assertion would be
    // vacuously true regardless of schema drift's effect.
    process.env.CLERK_SECRET_KEY = 'clerk-secret';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'clerk-public';
    process.env.SUPER_ADMIN_AUTH_MODE = 'password';
    process.env.SUPER_ADMIN_TEST_LOGIN_ENABLED = 'true';
    process.env.SUPER_ADMIN_TEST_PHONE = '+14165550123';
    process.env.SUPER_ADMIN_TEST_PASSWORD = 'fake-test-passcode';
    process.env.LEGACY_OTP_AUTH_ENABLED = 'false';

    const response = await GET();
    const body = await response.json();

    expect(body.schemaDrift).toBe('not_ready');
    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('reports schemaDrift: unavailable, and still degrades production, when the probe throws', async () => {
    executeMock.mockResolvedValue([{ '?column?': 1 }]);
    schemaDriftStatusMock.mockRejectedValue(
      new Error('drizzle.__drizzle_migrations detail must not escape'),
    );
    process.env.VERCEL_ENV = 'production';

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.checks.db).toBe(true);
    expect(body.schemaDrift).toBe('unavailable');
    expect(JSON.stringify(body)).not.toContain(
      'drizzle.__drizzle_migrations detail must not escape',
    );
  });
});
