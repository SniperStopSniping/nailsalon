import { requireAdminSalonForSlug, requireRealSalonOwner } from '@/libs/adminAuth';
import { Env } from '@/libs/Env';
import type { FeedbackAcceptedResponse } from '@/libs/ownerAssistant/contracts';
import { feedbackWithdrawRequestSchema } from '@/libs/ownerAssistant/contracts';
import { isOwnerAssistantEnabledForSalon } from '@/libs/ownerAssistant/enablement.server';
import { recordOwnerAssistantFeedbackWithdrawal } from '@/libs/ownerAssistant/feedback.server';

/**
 * `POST /api/admin/owner-assistant/feedback/withdraw` (A1-4b).
 *
 * Same admission chain and headers as the feedback POST. Withdrawal writes a
 * SECOND row carrying the same `feedbackId`; the original is never edited or
 * deleted, and the reader reports the pair as `withdrawn: true`.
 *
 * The sheet in this slice does not call this endpoint — a second tap on the
 * same thumb is a no-op there, and switching sends a new rating — so this is
 * the retraction path for an owner who asks for one (support, or a later UI
 * affordance). It is deliberately shipped with the writer rather than after
 * it: a feedback surface with no way back is not one anybody should ship.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Inline literal on purpose: an imported constant does not build (see the
// other maxDuration exports in this repo).
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

function notFound(): Response {
  return new Response(null, { status: 404, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  if (Env.OWNER_ASSISTANT_ENABLED !== 'true') {
    return notFound();
  }

  const body = feedbackWithdrawRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid request.' } },
      { status: 400, headers: NO_STORE },
    );
  }

  const { error, salon } = await requireAdminSalonForSlug(body.data.salonSlug, {
    persistActiveSalon: false,
  });
  if (error || !salon) {
    return error ?? notFound();
  }

  const ownerGuard = await requireRealSalonOwner(salon.id);
  if (!ownerGuard.ok) {
    return ownerGuard.response;
  }

  if (!isOwnerAssistantEnabledForSalon(salon)) {
    return notFound();
  }

  try {
    await recordOwnerAssistantFeedbackWithdrawal({
      salonId: salon.id,
      performedBy: ownerGuard.admin.clerkUserId ?? ownerGuard.admin.id,
      feedbackId: body.data.feedbackId,
      conversationId: body.data.conversationId,
      turnIndex: body.data.turnIndex,
    });
  } catch {
    return Response.json(
      { error: { code: 'FEEDBACK_NOT_RECORDED', message: 'Could not save that just now.' } },
      { status: 500, headers: NO_STORE },
    );
  }

  const data: FeedbackAcceptedResponse = {
    feedbackId: body.data.feedbackId,
    receivedAt: new Date().toISOString(),
  };

  return Response.json({ data }, { headers: NO_STORE });
}
