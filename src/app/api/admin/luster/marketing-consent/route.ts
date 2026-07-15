import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { communicationConsentSchema } from '@/models/Schema';

export async function GET(request: Request) {
  const salonSlug = new URL(request.url).searchParams.get('salonSlug');
  if (!salonSlug) {
    return Response.json({ error: 'salonSlug is required' }, { status: 400 });
  }
  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error || Response.json({ error: 'Salon not found' }, { status: 404 });
  }
  const [latest] = await db.select({ status: communicationConsentSchema.status }).from(communicationConsentSchema).where(and(eq(communicationConsentSchema.salonId, salon.id), eq(communicationConsentSchema.channel, 'email'), eq(communicationConsentSchema.purpose, 'luster_owner_marketing'))).orderBy(desc(communicationConsentSchema.createdAt)).limit(1);
  return Response.json({ data: { consented: latest?.status === 'granted' } });
}

const schema = z.object({ salonSlug: z.string(), consented: z.boolean() });
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid consent' }, { status: 400 });
  }
  const { error, salon } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error || Response.json({ error: 'Salon not found' }, { status: 404 });
  }
  await db.insert(communicationConsentSchema).values({ id: crypto.randomUUID(), salonId: salon.id, recipient: salon.ownerEmail || salon.email || '', channel: 'email', purpose: 'luster_owner_marketing', status: parsed.data.consented ? 'granted' : 'revoked', wordingVersion: 'owner-luster-v1', source: 'owner_dashboard', grantedAt: parsed.data.consented ? new Date() : null, revokedAt: parsed.data.consented ? null : new Date() });
  return Response.json({ data: { consented: parsed.data.consented } });
}
