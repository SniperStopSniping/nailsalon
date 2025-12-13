import { and, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import { type PostPayload, postToPlatform } from '@/core/autopost/poster';
import { FEATURE_FLAGS } from '@/core/config/flags';
import { logError, logInfo, logWarn } from '@/core/logging/logger';
import { db } from '@/libs/DB';
import { autopostQueueSchema } from '@/models/Schema';

// =============================================================================
// AUTOPOST QUEUE WORKER
// =============================================================================
// This endpoint processes the autopost_queue table.
// It should be called by a cron job (Vercel Cron, GitHub Actions, etc.)
//
// CRON SETUP:
// 1. Add CRON_SECRET to your environment variables (generate a secure random string)
// 2. For Vercel Cron, add to vercel.json:
//    {
//      "crons": [{
//        "path": "/api/autopost/process",
//        "schedule": "*/5 * * * *"
//      }]
//    }
//    And set the x-cron-secret header in the cron config or use Vercel's built-in auth.
//
// 3. For GitHub Actions, create a workflow that calls:
//    curl -X POST -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" \
//         https://your-domain.com/api/autopost/process
//
// =============================================================================

const MAX_ROWS_PER_RUN = 20;
const MAX_RETRY_COUNT = 5;
const STALE_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type ProcessResult = {
  processed: number;
  succeeded: number;
  failed: number;
  staleReset: number;
};

// =============================================================================
// POST /api/autopost/process
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  try {
    // 0. Check global kill switch
    if (!FEATURE_FLAGS.ENABLE_AUTOPOST_GLOBAL) {
      logInfo('autopost.worker.skipped', { reason: 'global kill switch active' });
      return Response.json({
        data: {
          processed: 0,
          succeeded: 0,
          failed: 0,
          staleReset: 0,
          skipped: true,
          reason: 'ENABLE_AUTOPOST_GLOBAL=false',
        },
      });
    }

    // 1. Verify cron secret
    const cronSecret = request.headers.get('x-cron-secret');
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
      logError('autopost.worker.misconfigured', { reason: 'CRON_SECRET not set' });
      return Response.json(
        {
          error: {
            code: 'MISCONFIGURED',
            message: 'Server misconfiguration',
          },
        } satisfies ErrorResponse,
        { status: 500 },
      );
    }

    if (!cronSecret || cronSecret !== expectedSecret) {
      return Response.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or missing cron secret',
          },
        } satisfies ErrorResponse,
        { status: 401 },
      );
    }

    const now = new Date();
    const staleThreshold = new Date(now.getTime() - STALE_PROCESSING_THRESHOLD_MS);

    // =======================================================================
    // STEP A: Recover stale "processing" rows (Zombie protection)
    // =======================================================================
    // Rows that have been stuck in 'processing' for > 10 minutes are likely
    // from a crashed worker. Reset them to 'queued' so they can be retried.
    //
    // NOTE: We use processedAt as "processing started time" here.
    // When a row is claimed for processing, processedAt is set to NOW().
    // If the worker crashes, processedAt remains at that time.
    // We detect staleness by checking if processedAt < staleThreshold.
    // =======================================================================

    const staleResetResult = await db
      .update(autopostQueueSchema)
      .set({
        status: 'queued',
        error: 'stale_processing_reset',
        // Do NOT change retryCount - let it continue from where it was
      })
      .where(
        and(
          eq(autopostQueueSchema.status, 'processing'),
          lt(autopostQueueSchema.processedAt, staleThreshold),
        ),
      )
      .returning();

    const staleReset = staleResetResult.length;
    if (staleReset > 0) {
      logWarn('autopost.worker.stale_reset', { count: staleReset });
    }

    // =======================================================================
    // STEP B: Select candidates
    // =======================================================================
    // Select rows that are ready to be processed:
    // - status is 'queued' or 'failed' (failed rows can be retried)
    // - scheduledFor is null OR <= now (respect scheduling)
    // - retryCount < MAX_RETRY_COUNT (stop after too many failures)
    // =======================================================================

    const candidates = await db
      .select()
      .from(autopostQueueSchema)
      .where(
        and(
          inArray(autopostQueueSchema.status, ['queued', 'failed']),
          or(
            isNull(autopostQueueSchema.scheduledFor),
            lte(autopostQueueSchema.scheduledFor, now),
          ),
          lt(autopostQueueSchema.retryCount, MAX_RETRY_COUNT),
        ),
      )
      .orderBy(autopostQueueSchema.createdAt)
      .limit(MAX_ROWS_PER_RUN);

    if (candidates.length === 0) {
      return Response.json({
        data: {
          processed: 0,
          succeeded: 0,
          failed: 0,
          staleReset,
        } satisfies ProcessResult,
      });
    }

    let succeeded = 0;
    let failed = 0;

    // =======================================================================
    // STEP C & D & E: Claim, Process, Complete
    // =======================================================================

    for (const candidate of candidates) {
      // C) Claim with optimistic lock
      // Only update if status hasn't changed (prevents concurrent processing)
      const claimResult = await db
        .update(autopostQueueSchema)
        .set({
          status: 'processing',
          // Set processedAt to NOW() to mark "processing started time"
          // This is used for stale detection if the worker crashes
          processedAt: now,
        })
        .where(
          and(
            eq(autopostQueueSchema.id, candidate.id),
            eq(autopostQueueSchema.status, candidate.status),
          ),
        )
        .returning();

      if (claimResult.length === 0) {
        // Another worker claimed it, skip
        continue;
      }

      // D) Post to platform
      try {
        const payload = candidate.payloadJson as PostPayload;

        logInfo('autopost.job.started', {
          jobId: candidate.id,
          platform: candidate.platform,
          appointmentId: payload.appointmentId,
          retryCount: candidate.retryCount,
        });

        const result = await postToPlatform({
          platform: candidate.platform,
          payload,
        });

        // E) Success: mark as posted
        // postToPlatform throws on failure, so if we get here it succeeded
        const updatedPayload = {
          ...payload,
          externalPostId: result.externalPostId,
        };

        await db
          .update(autopostQueueSchema)
          .set({
            status: 'posted',
            processedAt: new Date(), // Finished time
            error: null,
            payloadJson: updatedPayload,
          })
          .where(eq(autopostQueueSchema.id, candidate.id));

        logInfo('autopost.job.succeeded', {
          jobId: candidate.id,
          platform: candidate.platform,
          externalPostId: result.externalPostId,
        });

        succeeded++;
      } catch (error) {
        // E) Failure: increment retry count
        // postToPlatform throws on any failure
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Check if postToPlatform returned a retryAfterMs hint
        // This is used for rate-limit-aware scheduling
        const retryAfterMs = (error as { retryAfterMs?: number })?.retryAfterMs;
        const scheduledFor = retryAfterMs
          ? new Date(Date.now() + retryAfterMs)
          : null;

        await db
          .update(autopostQueueSchema)
          .set({
            status: 'failed',
            processedAt: new Date(),
            error: errorMessage,
            retryCount: sql`${autopostQueueSchema.retryCount} + 1`,
            // If we have a retry hint, schedule for later
            ...(scheduledFor && { scheduledFor }),
          })
          .where(eq(autopostQueueSchema.id, candidate.id));

        logError('autopost.job.failed', {
          jobId: candidate.id,
          platform: candidate.platform,
          error: errorMessage,
          retryCount: candidate.retryCount + 1,
          scheduledFor: scheduledFor?.toISOString(),
        });

        failed++;
      }
    }

    return Response.json({
      data: {
        processed: succeeded + failed,
        succeeded,
        failed,
        staleReset,
      } satisfies ProcessResult,
    });
  } catch (error) {
    logError('autopost.worker.error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to process autopost queue',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
