import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { isRedisAvailable, redis } from '@/core/redis/redisClient';
import { db } from '@/libs/DB';
import { isResendSenderVerified } from '@/libs/resendHealth';
import { isSuperAdmin } from '@/libs/superAdmin';
import { autopostQueueSchema, integrationOutboxSchema, notificationDeliverySchema } from '@/models/Schema';

import { SystemStatusClient } from './client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'System Status - Super Admin',
  description: 'Platform health and diagnostics',
};

// =============================================================================
// TYPES
// =============================================================================

type QueueSummary = {
  queued: number;
  processing: number;
  posted: number;
  failed: number;
};

type FailedJob = {
  id: string;
  platform: string;
  appointmentId: string;
  error: string | null;
  retryCount: number;
  processedAt: Date | null;
  createdAt: Date;
};

type EnvStatus = {
  databaseHealthy: boolean;
  clerkConfigured: boolean;
  passwordAuthConfigured: boolean;
  googleCalendarConfigured: boolean;
  metaConfigured: boolean;
  cloudinaryConfigured: boolean;
  redisConfigured: boolean;
  redisHealthy: boolean;
  dnsAndSslHealthy: boolean;
  cronSecretConfigured: boolean;
  twilioConfigured: boolean;
  resendConfigured: boolean;
  resendSenderVerified: boolean;
  stripeConfigured: boolean;
  sentryConfigured: boolean;
  productionTestToolsDisabled: boolean;
  tenantSubdomainsEnabled: boolean;
  metaGraphVersion: string;
};

type OperationalSummary = {
  integrationPending: number;
  integrationFailed: number;
  emailFailures24h: number;
  smsFailures24h: number;
};

export type SystemStatusData = {
  envStatus: EnvStatus;
  queueSummary: QueueSummary;
  operationalSummary: OperationalSummary;
  failedJobs: FailedJob[];
};

// =============================================================================
// DATA FETCHING
// =============================================================================

async function getQueueSummary(): Promise<QueueSummary> {
  const result = await db
    .select({
      status: autopostQueueSchema.status,
      count: sql<number>`count(*)::int`,
    })
    .from(autopostQueueSchema)
    .groupBy(autopostQueueSchema.status);

  const summary: QueueSummary = {
    queued: 0,
    processing: 0,
    posted: 0,
    failed: 0,
  };

  for (const row of result) {
    if (row.status in summary) {
      summary[row.status as keyof QueueSummary] = row.count;
    }
  }

  return summary;
}

async function getFailedJobs(): Promise<FailedJob[]> {
  const jobs = await db
    .select({
      id: autopostQueueSchema.id,
      platform: autopostQueueSchema.platform,
      appointmentId: autopostQueueSchema.appointmentId,
      error: autopostQueueSchema.error,
      retryCount: autopostQueueSchema.retryCount,
      processedAt: autopostQueueSchema.processedAt,
      createdAt: autopostQueueSchema.createdAt,
    })
    .from(autopostQueueSchema)
    .where(eq(autopostQueueSchema.status, 'failed'))
    .orderBy(desc(autopostQueueSchema.processedAt))
    .limit(10);

  return jobs;
}

async function getOperationalSummary(): Promise<OperationalSummary> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [[pending], [failed], [emailFailures], [smsFailures]] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(integrationOutboxSchema).where(inArray(integrationOutboxSchema.status, ['pending', 'retry', 'processing'])),
    db.select({ count: sql<number>`count(*)::int` }).from(integrationOutboxSchema).where(eq(integrationOutboxSchema.status, 'failed')),
    db.select({ count: sql<number>`count(*)::int` }).from(notificationDeliverySchema).where(and(eq(notificationDeliverySchema.channel, 'email'), eq(notificationDeliverySchema.status, 'failed'), gte(notificationDeliverySchema.createdAt, since))),
    db.select({ count: sql<number>`count(*)::int` }).from(notificationDeliverySchema).where(and(eq(notificationDeliverySchema.channel, 'sms'), eq(notificationDeliverySchema.status, 'failed'), gte(notificationDeliverySchema.createdAt, since))),
  ]);
  return {
    integrationPending: Number(pending?.count ?? 0),
    integrationFailed: Number(failed?.count ?? 0),
    emailFailures24h: Number(emailFailures?.count ?? 0),
    smsFailures24h: Number(smsFailures?.count ?? 0),
  };
}

async function getEnvStatus(): Promise<EnvStatus> {
  let databaseHealthy = false;
  try {
    await db.execute(sql`SELECT 1`);
    databaseHealthy = true;
  } catch {
    databaseHealthy = false;
  }

  const resendConfigured = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
  const isProduction = process.env.VERCEL_ENV === 'production' || process.env.APP_ENV === 'production';
  const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://islanailsalon.com';
  const [resendSenderVerified, redisHealthy, dnsAndSslHealthy] = await Promise.all([
    resendConfigured ? isResendSenderVerified() : Promise.resolve(false),
    redis ? isRedisAvailable() : Promise.resolve(false),
    publicAppUrl.startsWith('https://')
      ? fetch(publicAppUrl, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(5000) })
        .then(response => response.ok || response.status < 500)
        .catch(() => false)
      : Promise.resolve(false),
  ]);
  return {
    databaseHealthy,
    clerkConfigured: Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    passwordAuthConfigured: Boolean(process.env.SUPER_ADMIN_AUTH_MODE === 'password' && process.env.SUPER_ADMIN_TEST_PHONE && process.env.SUPER_ADMIN_TEST_PASSWORD && process.env.LEGACY_OTP_AUTH_ENABLED === 'false'),
    googleCalendarConfigured: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_OAUTH_REDIRECT_URI && process.env.INTEGRATION_ENCRYPTION_KEY && process.env.OAUTH_STATE_SECRET),
    metaConfigured: Boolean(
      process.env.META_SYSTEM_USER_TOKEN
      && process.env.META_FACEBOOK_PAGE_ID
      && process.env.META_INSTAGRAM_ACCOUNT_ID,
    ),
    cloudinaryConfigured: Boolean(
      process.env.CLOUDINARY_CLOUD_NAME
      && process.env.CLOUDINARY_API_KEY
      && process.env.CLOUDINARY_API_SECRET,
    ),
    redisConfigured: Boolean(process.env.REDIS_URL),
    redisHealthy,
    dnsAndSslHealthy,
    cronSecretConfigured: Boolean(process.env.CRON_SECRET),
    twilioConfigured: Boolean(
      process.env.TWILIO_ACCOUNT_SID
      && process.env.TWILIO_AUTH_TOKEN
      && process.env.TWILIO_VERIFY_SERVICE_SID
      && process.env.TWILIO_PHONE_NUMBER,
    ),
    resendConfigured,
    resendSenderVerified,
    stripeConfigured: Boolean(
      process.env.STRIPE_SECRET_KEY
      && process.env.STRIPE_WEBHOOK_SECRET
      && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    ),
    sentryConfigured: Boolean(
      process.env.NEXT_PUBLIC_SENTRY_DSN
      && process.env.SENTRY_ORG
      && process.env.SENTRY_PROJECT
      && process.env.SENTRY_AUTH_TOKEN,
    ),
    productionTestToolsDisabled: !isProduction || process.env.SUPER_ADMIN_TEST_TOOLS_ENABLED !== 'true',
    tenantSubdomainsEnabled: process.env.TENANT_SUBDOMAINS_ENABLED === 'true',
    metaGraphVersion: process.env.META_GRAPH_VERSION ?? 'v19.0 (default)',
  };
}

// =============================================================================
// PAGE COMPONENT
// =============================================================================

export default async function SystemStatusPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const isSuper = await isSuperAdmin();

  if (!isSuper) {
    redirect(`/${locale}/admin-login`);
  }

  // Fetch all data in parallel
  const [queueSummary, operationalSummary, failedJobs, envStatus] = await Promise.all([
    getQueueSummary(),
    getOperationalSummary(),
    getFailedJobs(),
    getEnvStatus(),
  ]);

  const data: SystemStatusData = {
    envStatus,
    queueSummary,
    operationalSummary,
    failedJobs,
  };

  return <SystemStatusClient data={data} locale={locale} />;
}
