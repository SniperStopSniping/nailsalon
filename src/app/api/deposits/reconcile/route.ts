import { pingCronHeartbeat } from '@/libs/cronHeartbeat';
import { runDepositReconcile } from '@/libs/depositReconcile';

/**
 * Cron entry point for the deposit reconcile sweep.
 *
 * Guarded exactly like the reaper and the outbox worker: 500 when CRON_SECRET
 * is unset — a misconfigured deployment must not silently expose a mutating
 * endpoint — 401 when it is wrong, and both `x-cron-secret` and
 * `Authorization: Bearer` are accepted.
 *
 * THE GUARD RETURNS A RESPONSE RATHER THAN THROWING, so a rotated secret or a
 * route regression produces 401s and 500s that reach no error pipeline. Every
 * alarm this sweep owns lives inside the process that would have stalled. A
 * Checkly heartbeat therefore runs OUT OF BAND and this route reports to it
 * only after the authenticated sweep completes successfully. Its generated
 * ping URL still requires the owner activation step recorded in the PR.
 *
 * THIS ROUTE IS SHARED. A later packet adds refund passes here and adds no cron
 * entry of its own, so the per-invocation budget below is shared with it.
 */

/**
 * ADOPTED from D4's reaper rather than invented as a second number, and it MUST
 * be a literal: Next.js evaluates this export statically and cannot resolve an
 * imported identifier — writing `export const maxDuration = SOME_CONSTANT`
 * builds with a warning and then silently applies the platform default, so the
 * sweep would be cut off mid-batch with no local evidence of why. A test keeps
 * it equal to RECONCILE_MAX_DURATION_SECONDS.
 */
export const maxDuration = 300;

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

async function handleReconcile(request: Request): Promise<Response> {
  try {
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
      return Response.json(
        { error: { code: 'MISCONFIGURED', message: 'Server misconfiguration' } } satisfies ErrorResponse,
        { status: 500 },
      );
    }

    const providedSecret = getCronSecret(request);
    if (!providedSecret || providedSecret !== expectedSecret) {
      return Response.json(
        { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing cron secret' } } satisfies ErrorResponse,
        { status: 401 },
      );
    }

    const result = await runDepositReconcile();
    await pingCronHeartbeat('deposit_reconcile');
    return Response.json({ data: result });
  } catch (error) {
    console.error('[deposits] Reconcile sweep failed:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to run the deposit reconcile sweep' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

export const GET = handleReconcile;
export const POST = handleReconcile;

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
