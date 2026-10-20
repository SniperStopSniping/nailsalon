import { z } from 'zod';

import { SetupError } from '@/features/business-setup/contracts';
import { importOnboardingCanva } from '@/features/custom-sites/onboarding-canva.server';
import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { authorizeOnboardingSite } from '@/features/onboarding-v1-integration/media-authorization.server';
import { getAdminSession } from '@/libs/adminAuth';
import { checkEndpointRateLimit, rateLimitResponse } from '@/libs/rateLimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
const inputSchema = z.object({ siteId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict();

/** Owner action creates only a draft; there is no AI, approval or publication action here. */
export async function POST(request: Request) {
  if (!isOnboardingV1IntegrationEnabled()) {
    return new Response(null, { status: 404, headers });
  }
  const admin = await getAdminSession();
  if (!admin) {
    return Response.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to open your saved design.' } }, { status: 401, headers });
  }
  const limit = checkEndpointRateLimit('onboarding/v1/canva-review', admin.id, 'GENERAL');
  if (!limit.allowed) {
    const response = rateLimitResponse(limit.retryAfterMs);
    response.headers.set('Cache-Control', headers['Cache-Control']);
    return response;
  }
  const reader = request.body?.getReader();
  if (!reader) {
    return new Response(null, { status: 400, headers });
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > 8192) {
        return new Response(null, { status: 413, headers });
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  let input: unknown;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return new Response(null, { status: 400, headers });
  }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return Response.json({ error: { code: 'INVALID', message: 'Return to your saved website and try again.' } }, { status: 400, headers });
  }
  const site = await authorizeOnboardingSite(parsed.data.siteId, { ownerOnly: true });
  if (!site) {
    return new Response(null, { status: 404, headers });
  }
  try {
    const result = await importOnboardingCanva({ salonId: site.salonId, adminId: site.adminId }, parsed.data);
    return Response.json({ data: { salonSlug: result.head.salonSlug, revision: result.head.revision.revision } }, { headers });
  } catch (error) {
    if (error instanceof SetupError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID' ? 400 : 409, headers });
    }
    return Response.json({ error: { code: 'UNAVAILABLE', message: 'We could not open your design for review. Your saved setup is safe. Please try again.' } }, { status: 503, headers });
  }
}
