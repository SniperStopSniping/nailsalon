import { createHash } from 'node:crypto';

import { z } from 'zod';

import { requireAdminSalonForSlug, requireRealSalonOwner } from '@/libs/adminAuth';
import { Env } from '@/libs/Env';
import type { ContextResponse } from '@/libs/ownerAssistant/contracts';
import { OWNER_ASSISTANT_DISCLOSURE, OWNER_ASSISTANT_SUGGESTED_QUESTIONS } from '@/libs/ownerAssistant/contracts';
import {
  getEnabledToolNames,
  getOwnerAssistantAvailability,
  isOwnerAssistantEnabledForSalon,
} from '@/libs/ownerAssistant/enablement.server';

/**
 * `GET /api/admin/owner-assistant/context` (docs/OWNER_ASSISTANT_CHAT.md §4).
 *
 * The UI renders nothing unless this answers 200, so the ORDER here is the
 * product's privacy posture: dark answers 404 BEFORE authentication (a probe
 * learns nothing about the feature), and a salon that is not on the pilot
 * answers 404 too — indistinguishable from dark.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Inline literal on purpose: an imported constant does not build (see the
// other maxDuration exports in this repo).
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

const querySchema = z.object({
  salonSlug: z.string().trim().min(1).max(200),
}).strict();

function notFound(): Response {
  return new Response(null, { status: 404, headers: NO_STORE });
}

export async function GET(request: Request): Promise<Response> {
  if (Env.OWNER_ASSISTANT_ENABLED !== 'true') {
    return notFound();
  }

  const { searchParams } = new URL(request.url);
  const query = querySchema.safeParse(Object.fromEntries(searchParams.entries()));
  if (!query.success) {
    return Response.json(
      { error: { code: 'BAD_REQUEST', message: 'salonSlug is required.' } },
      { status: 400, headers: NO_STORE },
    );
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

  const availability = getOwnerAssistantAvailability();
  const data: ContextResponse = {
    enabled: true,
    salonSlug: salon.slug,
    salonName: salon.name,
    ownerRef: createHash('sha256').update(`owner-assistant:${ownerGuard.admin.id}`).digest('hex').slice(0, 16),
    tools: getEnabledToolNames(),
    model: availability.available
      ? { available: true }
      : { available: false, reason: availability.reason },
    suggestedQuestions: [...OWNER_ASSISTANT_SUGGESTED_QUESTIONS],
    disclosure: OWNER_ASSISTANT_DISCLOSURE,
  };

  return Response.json({ data }, { headers: NO_STORE });
}
