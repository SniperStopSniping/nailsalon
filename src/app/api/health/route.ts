import { sql } from 'drizzle-orm';

import { isRedisAvailable, redis } from '@/core/redis/redisClient';
import { db } from '@/libs/DB';

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
  cloudinaryEnv: boolean;
  metaEnv: boolean;
  cronSecretConfigured: boolean;
};

type HealthResponse = {
  status: 'ok' | 'degraded';
  checks: HealthCheck;
  timestamp: string;
  gitSha?: string;
};

export async function GET(): Promise<Response> {
  const checks: HealthCheck = {
    db: false,
    redis: false,
    cloudinaryEnv: false,
    metaEnv: false,
    cronSecretConfigured: false,
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

  // ---------------------------------------------------------------------------
  // 3. Cloudinary env check (presence only, no external call)
  // ---------------------------------------------------------------------------
  checks.cloudinaryEnv = Boolean(
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
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
  // Determine overall status
  // ---------------------------------------------------------------------------
  // DB is critical - if it's down, we're degraded
  // Other services being down is acceptable (graceful degradation)
  const status: 'ok' | 'degraded' = checks.db ? 'ok' : 'degraded';

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
