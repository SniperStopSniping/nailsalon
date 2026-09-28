import { requireSuperAdmin } from '@/libs/adminAuth';
import { inspectStarterIdentityReadiness } from '@/libs/billing/starterIdentityReadiness';
import { db } from '@/libs/DB';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const report = await db.transaction(inspectStarterIdentityReadiness);
    return Response.json({ data: report }, { headers });
  } catch {
    return Response.json({ error: { code: 'READINESS_UNAVAILABLE', message: 'Identity readiness could not be checked.' } }, { status: 503, headers });
  }
}
