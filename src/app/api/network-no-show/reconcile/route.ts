import { isAuthorizedCronRequest } from '@/libs/billing/cronAuth';
import { reconcileNetworkNoShows } from '@/libs/networkNoShow.server';

export const maxDuration = 300;

const noStore = { 'Cache-Control': 'no-store' };

/**
 * Reconciles eligible no-shows that were marked before their scheduled end.
 * Vercel invokes this every five minutes; it is CRON_SECRET-gated and never
 * creates a record outside the existing prospective, seven-day, exact-binding
 * and source-status fences in the server-only projection.
 */
async function run(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request, process.env.CRON_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { headers: noStore, status: 401 });
  }

  try {
    return Response.json({ data: await reconcileNetworkNoShows() }, { headers: noStore });
  } catch {
    console.error('[network-no-show] Reconciliation failed');
    return Response.json({ error: 'Failed to reconcile network no-shows' }, { headers: noStore, status: 500 });
  }
}

export const GET = run;
export const POST = run;
export const dynamic = 'force-dynamic';
