import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { getLatestNextVisitOfferForClient, mintNextVisitOfferLink } from '@/libs/nextVisitOffer.server';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';

export const dynamic = 'force-dynamic';
const schema = z.object({ salonSlug: z.string().min(1).max(200), appointmentId: z.string().min(1).max(200).optional(), clientId: z.string().min(1).max(200).optional() }).strict()
  .refine(value => Boolean(value.appointmentId) !== Boolean(value.clientId), 'Choose one completed appointment or client.');
export async function POST(request: Request): Promise<Response> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: 'VALIDATION_ERROR', message: 'Choose a completed visit or client.' } }, { status: 400 });
  }
  const { salon, error } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error!;
  }
  const sourceId = parsed.data.appointmentId ?? (await getLatestNextVisitOfferForClient(db, salon.id, parsed.data.clientId!))?.sourceAppointmentId;
  const issued = sourceId ? await mintNextVisitOfferLink(db, { salonId: salon.id, sourceAppointmentId: sourceId }) : null;
  if (!issued) {
    return Response.json({ data: { offer: null } }, { headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json({ data: { offer: { bookingUrl: buildSalonTenantPublicUrl(`/book?campaign=${encodeURIComponent(issued.token)}`, salon), deadlineDate: issued.offer.deadlineDate, settings: issued.offer.settingsSnapshot } } }, { headers: { 'Cache-Control': 'no-store' } });
}
