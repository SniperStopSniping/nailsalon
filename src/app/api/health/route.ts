import { sql } from 'drizzle-orm';

import { isRedisAvailable, redis } from '@/core/redis/redisClient';
import { db } from '@/libs/DB';
import { isResendSenderVerified } from '@/libs/resendHealth';

// =============================================================================
// HEALTH CHECK ENDPOINT
// =============================================================================
// GET /api/health
//
// Returns system health status for uptime monitors (UptimeRobot, Pingdom, etc.)
// This endpoint must be stable and fast.
//
// Response:
// {
//   "status": "ok" | "degraded",
//   "checks": { ... },
//   "timestamp": "ISO string",
//   "gitSha": "optional"
// }
//
// Rules:
// - DB failure → status = "degraded"
// - Redis/Cloudinary/Meta are optional → status stays "ok" if DB works
// - Never leak secrets
// =============================================================================

type HealthCheck = {
  db: boolean;
  redis: boolean;
  clerkEnv: boolean;
  passwordAuthEnv: boolean;
  cloudinaryEnv: boolean;
  metaEnv: boolean;
  cronSecretConfigured: boolean;
  twilioEnv: boolean;
  resendEnv: boolean;
  resendVerified: boolean;
  stripeEnv: boolean;
  sentryEnv: boolean;
  googleCalendarEnv: boolean;
};

type HealthResponse = {
  status: 'ok' | 'degraded';
  checks: HealthCheck;
  timestamp: string;
  gitSha?: string;
};

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const checks: HealthCheck = {
    db: false,
    redis: false,
    clerkEnv: false,
    passwordAuthEnv: false,
    cloudinaryEnv: false,
    metaEnv: false,
    cronSecretConfigured: false,
    twilioEnv: false,
    resendEnv: false,
    resendVerified: false,
    stripeEnv: false,
    sentryEnv: false,
    googleCalendarEnv: false,
  };

  // ---------------------------------------------------------------------------
  // 1. Database check (critical)
  // ---------------------------------------------------------------------------
  try {
    await db.execute(sql`SELECT 1`);
    checks.db = true;
  } catch {
    checks.db = false;
  }

  // ---------------------------------------------------------------------------
  // 2. Redis check (optional but important for rate limiting)
  // ---------------------------------------------------------------------------
  if (redis) {
    checks.redis = await isRedisAvailable();
  } else {
    // Redis not configured - this is acceptable for some deployments
    checks.redis = false;
  }

  checks.clerkEnv = Boolean(
    process.env.CLERK_SECRET_KEY
    && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );

  checks.passwordAuthEnv = Boolean(
    process.env.SUPER_ADMIN_AUTH_MODE === 'password'
    && process.env.SUPER_ADMIN_TEST_LOGIN_ENABLED === 'true'
    && process.env.SUPER_ADMIN_TEST_PHONE
    && process.env.SUPER_ADMIN_TEST_PASSWORD
    && process.env.LEGACY_OTP_AUTH_ENABLED === 'false',
  );

  // ---------------------------------------------------------------------------
  // 3. Cloudinary env check (presence only, no external call)
  // ---------------------------------------------------------------------------
  checks.cloudinaryEnv = Boolean(
    process.env.CLOUDINARY_CLOUD_NAME
    && process.env.CLOUDINARY_API_KEY
    && process.env.CLOUDINARY_API_SECRET,
  );

  // ---------------------------------------------------------------------------
  // 4. Meta env check (presence only, no external call)
  // ---------------------------------------------------------------------------
  checks.metaEnv = Boolean(
    process.env.META_SYSTEM_USER_TOKEN
    && process.env.META_FACEBOOK_PAGE_ID
    && process.env.META_INSTAGRAM_ACCOUNT_ID,
  );

  // ---------------------------------------------------------------------------
  // 5. Cron secret configured
  // ---------------------------------------------------------------------------
  checks.cronSecretConfigured = Boolean(process.env.CRON_SECRET);

  // ---------------------------------------------------------------------------
  // 6. Twilio env check (presence only, no external call)
  // ---------------------------------------------------------------------------
  checks.twilioEnv = Boolean(process.env.TWILIO_CONNECT_APP_SID);

  // ---------------------------------------------------------------------------
  // 7. Resend configuration and authenticated sender-domain check
  // ---------------------------------------------------------------------------
  checks.resendEnv = Boolean(
    process.env.RESEND_API_KEY
    && process.env.RESEND_FROM_EMAIL,
  );
  checks.resendVerified = checks.resendEnv
    ? await isResendSenderVerified()
    : false;

  // ---------------------------------------------------------------------------
  // 8. Stripe env check (presence only, no external call)
  // ---------------------------------------------------------------------------
  checks.stripeEnv = Boolean(
    process.env.STRIPE_SECRET_KEY
    && process.env.STRIPE_WEBHOOK_SECRET
    && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  );

  // ---------------------------------------------------------------------------
  // 9. Sentry env check (matches strict production build guard)
  // ---------------------------------------------------------------------------
  checks.sentryEnv = Boolean(
    process.env.NEXT_PUBLIC_SENTRY_DSN
    && process.env.SENTRY_ORG
    && process.env.SENTRY_PROJECT
    && process.env.SENTRY_AUTH_TOKEN,
  );

  // ---------------------------------------------------------------------------
  // 10. Google Calendar env check (presence only, no external call)
  // Per-salon OAuth is the active Luster integration. Keep recognizing the
  // legacy service-account configuration so older deployments remain visible
  // while they migrate.
  // ---------------------------------------------------------------------------
  const googleOAuthConfigured = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID
    && process.env.GOOGLE_OAUTH_CLIENT_SECRET
    && process.env.GOOGLE_OAUTH_REDIRECT_URI
    && process.env.INTEGRATION_ENCRYPTION_KEY
    && process.env.OAUTH_STATE_SECRET,
  );
  const legacyGoogleCalendarConfigured = Boolean(
    (process.env.GOOGLE_CALENDAR_ENABLED === 'true' || process.env.GOOGLE_CALENDAR_ENABLED === '1')
    && process.env.GOOGLE_CALENDAR_ID
    && process.env.GOOGLE_CALENDAR_CLIENT_EMAIL
    && process.env.GOOGLE_CALENDAR_PRIVATE_KEY,
  );
  checks.googleCalendarEnv = googleOAuthConfigured || legacyGoogleCalendarConfigured;

  // ---------------------------------------------------------------------------
  // Determine overall status
  // ---------------------------------------------------------------------------
  // DB is critical - if it's down, we're degraded
  // Other services being down is acceptable (graceful degradation)
  const hosted = Boolean(process.env.VERCEL_ENV)
    || process.env.APP_ENV === 'staging'
    || process.env.APP_ENV === 'production';
  const criticalChecksPass = checks.db
    && checks.clerkEnv
    && checks.passwordAuthEnv
    && checks.resendVerified
    && (!hosted || checks.redis);
  const status: 'ok' | 'degraded' = criticalChecksPass ? 'ok' : 'degraded';

  const response: HealthResponse = {
    status,
    checks,
    timestamp: new Date().toISOString(),
  };

  // Optional: include git SHA if available (set by CI/CD)
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    response.gitSha = process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  }

  return Response.json(response, {
    status: status === 'ok' ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
