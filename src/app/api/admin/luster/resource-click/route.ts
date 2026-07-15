import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { salonAuditLogSchema } from '@/models/Schema';

const schema = z.object({ salonSlug: z.string(), resourceId: z.string().max(100), url: z.string().url() });
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid resource event' }, { status: 400 });
  }
  const { error, salon } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error || Response.json({ error: 'Salon not found' }, { status: 404 });
  }
  await db.insert(salonAuditLogSchema).values({ id: crypto.randomUUID(), salonId: salon.id, action: 'luster_resource_clicked', performedBy: 'owner', metadata: { field: parsed.data.resourceId, newValue: parsed.data.url } });
  return Response.json({ ok: true });
}
