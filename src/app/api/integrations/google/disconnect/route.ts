import { eq } from 'drizzle-orm';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { decryptIntegrationSecret } from '@/libs/lusterSecurity';
import { salonGoogleCalendarConnectionSchema } from '@/models/Schema';

export async function POST(request: Request) {
  const { salonSlug } = await request.json().catch(() => ({})) as { salonSlug?: string };
  if (!salonSlug) {
    return Response.json({ error: 'salonSlug is required' }, { status: 400 });
  }
  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error || Response.json({ error: 'Salon not found' }, { status: 404 });
  }
  const [connection] = await db.select().from(salonGoogleCalendarConnectionSchema).where(eq(salonGoogleCalendarConnectionSchema.salonId, salon.id)).limit(1);
  if (connection) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decryptIntegrationSecret(connection.encryptedRefreshToken))}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).catch(() => null);
    await db.delete(salonGoogleCalendarConnectionSchema).where(eq(salonGoogleCalendarConnectionSchema.salonId, salon.id));
  }
  return Response.json({ data: { disconnected: true } });
}
