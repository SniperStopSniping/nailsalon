import {
  DEPOSIT_REAP_MAX_DURATION_SECONDS,
  reapExpiredDepositHolds,
} from '@/libs/depositHoldReaper';

/**
 * Cron entry point for the deposit hold reaper.
 *
 * Guarded exactly like /api/reminders/process: 500 when CRON_SECRET is unset
 * (a misconfigured deployment must not silently expose a mutating endpoint),
 * 401 when it is wrong, and both `x-cron-secret` and `Authorization: Bearer`
 * are accepted.
 */

/**
 * DERIVED, not copied from another route. See DEPOSIT_REAP_BATCH for the
 * derivation: batch x 3 worst-case Stripe round trips x the 6 s client timeout.
 * The batch is sized against THIS number, so the two move together or not at all.
 */
export const maxDuration = DEPOSIT_REAP_MAX_DURATION_SECONDS;

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

async function handleReap(request: Request): Promise<Response> {
  try {
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
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

    const providedSecret = getCronSecret(request);
    if (!providedSecret || providedSecret !== expectedSecret) {
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

    const result = await reapExpiredDepositHolds();
    return Response.json({ data: result });
  } catch (error) {
    console.error('[deposits] Failed to reap expired holds:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to reap expired deposit holds',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

export const GET = handleReap;
export const POST = handleReap;

function getCronSecret(request: Request): string | null {
  const headerSecret = request.headers.get('x-cron-secret');
  if (headerSecret) {
    return headerSecret;
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }

  return null;
}
