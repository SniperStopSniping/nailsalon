import { z } from 'zod';

import { businessSetupSelfServeEnabled } from '@/features/business-setup/access.server';
import { SetupError } from '@/features/business-setup/contracts';
import { openAiBuilder } from '@/features/business-setup/entry.server';
import { requireAuthenticatedOnboardingIdentity } from '@/features/onboarding-v1-integration/identity.server';
import { OnboardingPersistenceError } from '@/features/onboarding-v1-integration/persistence.server';
import { checkEndpointRateLimit } from '@/libs/rateLimit';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const inputSchema = z.object({ salonSlug: z.string().min(1).max(120).optional() }).strict();
export async function POST(request: Request) {
  if (!businessSetupSelfServeEnabled()) {
    return new Response(null, { status: 404, headers });
  }
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return new Response(null, { status: 403, headers });
  }
  try {
    const identity = await requireAuthenticatedOnboardingIdentity();
    if (!checkEndpointRateLimit('ai-builder-entry', identity.clerkUserId, 'GENERAL').allowed) {
      return Response.json({ error: 'Wait a moment, then try again.' }, { status: 429, headers });
    }
    // Bounded body read: Content-Length is only a hint, never the limit.
    const reader = request.body?.getReader();
    let body = '';
    let size = 0;
    const decoder = new TextDecoder();
    while (true) {
      const part = await reader?.read();
      if (!part || part.done) {
        break;
      }
      size += part.value.byteLength;
      if (size > 512) {
        await reader?.cancel();
        return new Response(null, { status: 413, headers });
      }
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
    const input = inputSchema.parse(JSON.parse(body || '{}'));
    return Response.json({ data: await openAiBuilder(identity, input.salonSlug) }, { headers });
  } catch (cause) {
    const status = cause instanceof OnboardingPersistenceError ? cause.status : cause instanceof SetupError ? cause.code === 'FORBIDDEN' ? 403 : 404 : cause instanceof z.ZodError || cause instanceof SyntaxError ? 400 : 503;
    return Response.json({ error: cause instanceof SetupError || cause instanceof OnboardingPersistenceError ? cause.message : 'We could not open your saved business. Please try again.' }, { status, headers });
  }
}
