import { desc, eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '@/libs/DB';
import { isSuperAdmin } from '@/libs/superAdmin';
import { autopostQueueSchema } from '@/models/Schema';

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
  metaConfigured: boolean;
  cloudinaryConfigured: boolean;
  redisConfigured: boolean;
  cronSecretConfigured: boolean;
  metaGraphVersion: string;
};

export type SystemStatusData = {
  envStatus: EnvStatus;
  queueSummary: QueueSummary;
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

function getEnvStatus(): EnvStatus {
  return {
    metaConfigured: Boolean(
      process.env.META_SYSTEM_USER_TOKEN
      && process.env.META_FACEBOOK_PAGE_ID
      && process.env.META_INSTAGRAM_ACCOUNT_ID,
    ),
    cloudinaryConfigured: Boolean(
      process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
      && process.env.CLOUDINARY_API_KEY
      && process.env.CLOUDINARY_API_SECRET,
    ),
    redisConfigured: Boolean(process.env.REDIS_URL),
    cronSecretConfigured: Boolean(process.env.CRON_SECRET),
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
  const [queueSummary, failedJobs] = await Promise.all([
    getQueueSummary(),
    getFailedJobs(),
  ]);

  const envStatus = getEnvStatus();

  const data: SystemStatusData = {
    envStatus,
    queueSummary,
    failedJobs,
  };

  return <SystemStatusClient data={data} locale={locale} />;
}
