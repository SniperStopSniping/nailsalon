import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const { executeMock, isRedisAvailableMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  isRedisAvailableMock: vi.fn(),
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

describe('GET /api/health', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
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
    delete process.env.VERCEL_GIT_COMMIT_SHA;
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
        stripeEnv: true,
        sentryEnv: true,
        googleCalendarEnv: true,
      },
      timestamp: expect.any(String),
      gitSha: 'abcdef1',
    });
  });

  it('returns degraded when the database is unreachable', async () => {
    executeMock.mockRejectedValue(new Error('db down'));
    isRedisAvailableMock.mockResolvedValue(false);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.db).toBe(false);
  });
});
