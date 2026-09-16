import { requireAdminSalonForSlug, requireRealSalonOwner } from '@/libs/adminAuth';
import { Env } from '@/libs/Env';
import type { FeedbackAcceptedResponse, FeedbackListResponse } from '@/libs/ownerAssistant/contracts';
import { feedbackListQuerySchema, feedbackRequestSchema } from '@/libs/ownerAssistant/contracts';
import { isOwnerAssistantEnabledForSalon } from '@/libs/ownerAssistant/enablement.server';
import { listOwnerAssistantFeedback, recordOwnerAssistantFeedback } from '@/libs/ownerAssistant/feedback.server';

/**
 * `POST /api/admin/owner-assistant/feedback` and `GET …/feedback?salonSlug=…`
 * (A1-4b; admission order from docs/OWNER_ASSISTANT_CHAT.md §3.1).
 *
 * The admission chain is the same normative order as the chat and context
 * routes, and for the same reason: dark answers 404 BEFORE any parsing and
 * BEFORE authentication, so a probe cannot learn that the feature exists; a
 * salon that is simply not on the pilot answers 404 too, indistinguishable
 * from dark.
 *
 * The POST never receives the conversation itself — only an opaque
 * `conversationId` the client read out of its own signed token, plus the turn
 * number. Both are correlation hints for the evidence trail: identity and the
 * salon always come from the session.
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

function badRequest(message: string): Response {
  return Response.json(
    { error: { code: 'BAD_REQUEST', message } },
    { status: 400, headers: NO_STORE },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (Env.OWNER_ASSISTANT_ENABLED !== 'true') {
    return notFound();
  }

  const body = feedbackRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return badRequest('Invalid request.');
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
    await recordOwnerAssistantFeedback({
      salonId: salon.id,
      performedBy: ownerGuard.admin.clerkUserId ?? ownerGuard.admin.id,
      feedbackId: body.data.feedbackId,
      kind: body.data.kind,
      conversationId: body.data.conversationId,
      turnIndex: body.data.turnIndex,
      cardKind: body.data.cardKind,
      reasonCodes: body.data.reasonCodes,
      text: body.data.text,
    });
  } catch {
    // Feedback that was not written must not be reported as accepted: the
    // client shows an inline Retry, and a retry re-sends the same feedbackId.
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

export async function GET(request: Request): Promise<Response> {
  if (Env.OWNER_ASSISTANT_ENABLED !== 'true') {
    return notFound();
  }

  const { searchParams } = new URL(request.url);
  const query = feedbackListQuerySchema.safeParse(Object.fromEntries(searchParams.entries()));
  if (!query.success) {
    return badRequest('salonSlug is required.');
  }

  const { error, salon } = await requireAdminSalonForSlug(query.data.salonSlug, {
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

  // Own rows only. The reader filters by actor after the indexed salon/action
  // query; a co-owner of the same salon never appears in this list.
  const items = await listOwnerAssistantFeedback({
    salonId: salon.id,
    performedBy: ownerGuard.admin.clerkUserId ?? ownerGuard.admin.id,
  });

  const data: FeedbackListResponse = { items };

  return Response.json({ data }, { headers: NO_STORE });
}
