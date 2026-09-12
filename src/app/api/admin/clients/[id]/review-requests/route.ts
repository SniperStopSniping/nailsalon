import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { resolveOperationalSalonClientContactWithHandle } from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import { setReviewSuppression } from '@/libs/reviewRequests.server';
import { salonClientSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';
const schema = z.object({ reviewRequestsSuppressed: z.boolean() }).strict();

async function run(request: Request, clientId: string, write: boolean) {
  const slug = new URL(request.url).searchParams.get('salonSlug');
  if (!slug) {
    return Response.json({ error: { message: 'A salon is required.' } }, { status: 400 });
  }
  const access = await requireAdminSalon(slug);
  if (access.error || !access.salon) {
    return access.error ?? Response.json({}, { status: 403 });
  }
  const input = write ? schema.safeParse(await request.json().catch(() => null)) : null;
  if (input && !input.success) {
    return Response.json({ error: { message: 'Choose whether review requests are off.' } }, { status: 400 });
  }
  try {
    const client = await resolveOperationalSalonClientContactWithHandle(db, { salonId: access.salon.id, clientId });
    if (input?.success) {
      await setReviewSuppression(access.salon.id, client.id, input.data.reviewRequestsSuppressed);
    }
    const [row] = await db.select({ reviewRequestsSuppressed: salonClientSchema.reviewRequestsSuppressed }).from(salonClientSchema).where(and(eq(salonClientSchema.id, client.id), eq(salonClientSchema.salonId, access.salon.id))).limit(1);
    return Response.json({ data: row }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: { message: 'Client not available in this salon.' } }, { status: 404 });
  }
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(request, (await params).id, false);
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(request, (await params).id, true);
}
