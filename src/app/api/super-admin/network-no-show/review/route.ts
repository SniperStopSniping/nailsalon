import { z } from 'zod';

import { requireSuperAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { resolveNoShowReviewInTx } from '@/libs/networkNoShowReview.server';
import { checkEndpointRateLimit, rateLimitResponse } from '@/libs/rateLimit';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const schema = z.object({ salonId: z.string().min(1).max(200), appointmentId: z.string().min(1).max(200), expectedUpdatedAt: z.string().datetime({ offset: true }), decision: z.enum(['upheld', 'removed']), reason: z.string().trim().min(10).max(500) }).strict();

export async function POST(request: Request) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }
  const limit = checkEndpointRateLimit('platform-no-show-review', guard.admin.id, 'BILLING');
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterMs);
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers });
  }
  try {
    const resolved = await db.transaction(tx => resolveNoShowReviewInTx(tx, { ...parsed.data, operatorId: guard.admin.id, now: new Date() }));
    return Response.json(resolved ? { reviewed: true } : { error: 'RECORD_CHANGED_OR_REVIEW_NOT_RESTORABLE' }, { status: resolved ? 200 : 409, headers });
  } catch {
    return Response.json({ error: 'REVIEW_UNAVAILABLE' }, { status: 503, headers });
  }
}
