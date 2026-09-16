import { requireAdminSalonForSlug, requireRealSalonOwner } from '@/libs/adminAuth';
import { Env } from '@/libs/Env';
import { chatRequestSchema } from '@/libs/ownerAssistant/contracts';
import { ConversationInvalidError } from '@/libs/ownerAssistant/conversation.server';
import { isOwnerAssistantEnabledForSalon } from '@/libs/ownerAssistant/enablement.server';
import { runOwnerAssistantTurn } from '@/libs/ownerAssistant/turn.server';

/**
 * `POST /api/admin/owner-assistant/chat` (docs/OWNER_ASSISTANT_CHAT.md §4).
 *
 * Admission order is normative (§3.1): dark → 404 before authentication; body
 * parse → 400; salon resolution; REAL owner (no impersonation, no
 * collaborator, no membership-less super admin); entitlement → 404. Only then
 * does a turn run, and a turn answers 200 for every non-auth outcome so the
 * owner always gets a sentence rather than an error page.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Inline literal on purpose: an imported constant does not build (see the
// other maxDuration exports in this repo).
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: Request): Promise<Response> {
  if (Env.OWNER_ASSISTANT_ENABLED !== 'true') {
    return new Response(null, { status: 404, headers: NO_STORE });
  }

  const body = chatRequestSchema.safeParse(await request.json().catch(() => null));
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
    return error ?? new Response(null, { status: 404, headers: NO_STORE });
  }

  const ownerGuard = await requireRealSalonOwner(salon.id);
  if (!ownerGuard.ok) {
    return ownerGuard.response;
  }

  if (!isOwnerAssistantEnabledForSalon(salon)) {
    return new Response(null, { status: 404, headers: NO_STORE });
  }

  try {
    const data = await runOwnerAssistantTurn({
      salon: { id: salon.id, slug: salon.slug, name: salon.name },
      admin: { id: ownerGuard.admin.id, clerkUserId: ownerGuard.admin.clerkUserId },
      message: body.data.message,
      conversationToken: body.data.conversation,
      locale: body.data.locale,
    });

    return Response.json({ data }, { headers: NO_STORE });
  } catch (turnError) {
    if (turnError instanceof ConversationInvalidError) {
      // The client holds a token this session cannot accept (tampered,
      // expired, or bound to another salon/admin). It starts fresh.
      return Response.json(
        { error: { code: 'CONVERSATION_INVALID', message: 'Start a new conversation.' } },
        { status: 409, headers: NO_STORE },
      );
    }
    throw turnError;
  }
}
