import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { getReviewSettings, saveReviewSettings } from '@/libs/reviewRequests.server';

export const dynamic = 'force-dynamic';

function serialize(settings: Awaited<ReturnType<typeof getReviewSettings>>) {
  return { googleReviewUrl: settings.googleReviewUrl, automaticEnabled: settings.automaticEnabled, delayMinutes: settings.delayMinutes, messageTemplate: settings.messageTemplate, businessName: settings.businessName };
}

async function run(request: Request, write: boolean) {
  const slug = new URL(request.url).searchParams.get('salonSlug');
  if (!slug) {
    return Response.json({ error: { message: 'A salon is required.' } }, { status: 400 });
  }
  const access = await requireAdminSalon(slug);
  if (access.error || !access.salon) {
    return access.error ?? Response.json({}, { status: 403 });
  }
  try {
    const settings = write ? await saveReviewSettings(access.salon.id, await request.json().catch(() => null)) : await getReviewSettings(access.salon.id);
    return Response.json({ data: serialize(settings) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: { message: error instanceof z.ZodError ? error.issues[0]?.message : 'Review settings are unavailable. Try again.' } }, { status: error instanceof z.ZodError ? 400 : 503 });
  }
}

export async function GET(request: Request) {
  return run(request, false);
}
export async function PATCH(request: Request) {
  return run(request, true);
}
