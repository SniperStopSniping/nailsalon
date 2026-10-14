import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';

export const dynamic = 'force-dynamic';

// Keep a guarded tombstone for older clients. Historical rewards and their
// checkout/financial references remain readable; this route can never grant one.
export async function POST(request: Request, _props?: { params: Promise<{ reviewId: string }> }): Promise<Response> {
  const parsed = z.object({ salonSlug: z.string().min(1) }).safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: { code: 'VALIDATION_ERROR', message: 'Salon slug is required' } }, { status: 400 });
  }
  const { error, salon } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error!;
  }
  return Response.json({ error: {
    code: 'REVIEW_REWARDS_RETIRED',
    message: 'Rewards for posting reviews are no longer available. You can still request honest reviews without an incentive.',
  } }, { status: 410 });
}
