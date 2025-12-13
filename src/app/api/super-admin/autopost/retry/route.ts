import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { logInfo, logWarn } from '@/core/logging/logger';
import { db } from '@/libs/DB';
import { requireSuperAdmin } from '@/libs/superAdmin';
import { autopostQueueSchema } from '@/models/Schema';

// =============================================================================
// SUPER ADMIN: RETRY FAILED AUTOPOST JOB
// =============================================================================
// POST /api/super-admin/autopost/retry
//
// Allows Super Admin to manually retry a failed autopost job.
// This resets the job to 'queued' status so it will be picked up by the next
// cron run.
//
// Rules:
// - Super Admin only
// - Only works on jobs with status = 'failed'
// - Resets retryCount to 0 (allows full retry cycle)
// - Clears error
// - Sets scheduledFor = null (runs next cron)
// - Updates processedAt to reflect manual intervention
// =============================================================================

const RetryRequestSchema = z.object({
  queueId: z.string().uuid(),
});

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

export async function POST(request: Request): Promise<Response> {
  // 1. Auth check - Super Admin only
  const authError = await requireSuperAdmin();
  if (authError) {
    return authError;
  }

  try {
    // 2. Parse and validate request body
    const body = await request.json();
    const parsed = RetryRequestSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid request body',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { queueId } = parsed.data;

    // 3. Fetch the job to verify it exists and is failed
    const [job] = await db
      .select()
      .from(autopostQueueSchema)
      .where(eq(autopostQueueSchema.id, queueId))
      .limit(1);

    if (!job) {
      return Response.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Job not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    if (job.status !== 'failed') {
      logWarn('autopost.retry.invalid_status', {
        queueId,
        currentStatus: job.status,
      });

      return Response.json(
        {
          error: {
            code: 'INVALID_STATUS',
            message: `Cannot retry job with status '${job.status}'. Only failed jobs can be retried.`,
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    // 4. Reset the job for retry
    const [updatedJob] = await db
      .update(autopostQueueSchema)
      .set({
        status: 'queued',
        retryCount: 0, // Reset to allow full retry cycle
        error: null, // Clear error
        scheduledFor: null, // Run on next cron
        processedAt: new Date(), // Mark manual intervention time
      })
      .where(
        and(
          eq(autopostQueueSchema.id, queueId),
          eq(autopostQueueSchema.status, 'failed'), // Double-check status
        ),
      )
      .returning();

    if (!updatedJob) {
      // Race condition - status changed between check and update
      return Response.json(
        {
          error: {
            code: 'CONFLICT',
            message: 'Job status changed during retry attempt',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    logInfo('autopost.retry.success', {
      queueId,
      platform: updatedJob.platform,
      appointmentId: updatedJob.appointmentId,
      previousRetryCount: job.retryCount,
    });

    return Response.json({
      data: {
        id: updatedJob.id,
        status: updatedJob.status,
        platform: updatedJob.platform,
        retryCount: updatedJob.retryCount,
        scheduledFor: updatedJob.scheduledFor,
        processedAt: updatedJob.processedAt,
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retry job',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
