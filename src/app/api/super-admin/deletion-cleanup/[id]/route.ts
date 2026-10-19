import { getSalonDeletionCleanup, runSalonDeletionCleanup, salonDeletionStatus } from '@/libs/salonDeletionCleanup.server';
import { requireSuperAdmin } from '@/libs/superAdmin';

export const dynamic = 'force-dynamic';

async function statusResponse(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) {
    return guard;
  }
  if (request.method === 'POST' && request.headers.get('origin') !== new URL(request.url).origin) {
    return Response.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/.test(id)) {
    return Response.json({ error: 'Invalid cleanup job' }, { status: 400 });
  }
  try {
    const row = await getSalonDeletionCleanup(id);
    if (!row) {
      return Response.json({ error: 'Cleanup job not found' }, { status: 404 });
    }
    // A manual check respects the same lease/backoff as the scheduled worker.
    // Repeated clicks cannot multiply provider calls or bypass a running job.
    const cleanup = request.method === 'POST'
      ? await runSalonDeletionCleanup(id) ?? salonDeletionStatus(row)
      : salonDeletionStatus(row);
    return Response.json({ cleanup }, { status: cleanup.status === 'completed' ? 200 : 202 });
  } catch {
    return Response.json({ error: 'Cleanup status is unavailable. The recorded job will be retried.' }, { status: 503 });
  }
}

export const GET = statusResponse;
export const POST = statusResponse;
