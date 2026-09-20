import { and, asc, eq, inArray } from 'drizzle-orm';

import { getAdminSession, requireAdminSalon } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { nextVisitOfferSettingsSchema, resolveNextVisitOfferSettings } from '@/libs/nextVisitOffer';
import { getNextVisitOfferSettingsData } from '@/libs/nextVisitOffer.server';
import { salonRetentionSettingsSchema, salonSchema, serviceSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

async function context(request: Request) {
  return requireAdminSalon(new URL(request.url).searchParams.get('salonSlug') ?? '');
}
async function data(salonId: string) {
  const [state, availableServices] = await Promise.all([
    getNextVisitOfferSettingsData(salonId),
    db.select({ id: serviceSchema.id, name: serviceSchema.name }).from(serviceSchema)
      .where(and(eq(serviceSchema.salonId, salonId), eq(serviceSchema.isActive, true)))
      .orderBy(asc(serviceSchema.sortOrder), asc(serviceSchema.name)),
  ]);
  return { ...state, availableServices };
}
export async function GET(request: Request): Promise<Response> {
  const { salon, error } = await context(request);
  if (error || !salon) {
    return error!;
  }
  return Response.json({ data: await data(salon.id) }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function PATCH(request: Request): Promise<Response> {
  const { salon, error } = await context(request);
  if (error || !salon) {
    return error!;
  }
  const admin = await getAdminSession();
  if (!admin) {
    return Response.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to update this offer.' } }, { status: 401 });
  }
  const parsed = nextVisitOfferSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: 'VALIDATION_ERROR', message: 'Check the offer settings.', details: parsed.error.flatten() } }, { status: 400 });
  }
  const settings = parsed.data;
  if (settings.eligibleServiceIds.length) {
    const services = await db.select({ id: serviceSchema.id }).from(serviceSchema).where(and(
      eq(serviceSchema.salonId, salon.id),
      eq(serviceSchema.isActive, true),
      inArray(serviceSchema.id, settings.eligibleServiceIds),
    ));
    if (services.length !== settings.eligibleServiceIds.length) {
      return Response.json({ error: { code: 'INVALID_SERVICES', message: 'Choose active services from this salon.' } }, { status: 400 });
    }
  }
  const previous = await db.transaction(async (tx) => {
    // Same financial salon fence as booking/completion, without acquiring an appointment lock.
    await tx.select({ id: salonSchema.id }).from(salonSchema).where(eq(salonSchema.id, salon.id)).for('no key update');
    const [old] = await tx.select().from(salonRetentionSettingsSchema).where(eq(salonRetentionSettingsSchema.salonId, salon.id)).limit(1);
    const current = resolveNextVisitOfferSettings(old?.nextVisitOffer);
    const enabledAt = settings.enabled && !current.enabled ? new Date() : old?.nextVisitOfferEnabledAt ?? null;
    await tx.insert(salonRetentionSettingsSchema).values({ salonId: salon.id, nextVisitOffer: settings, nextVisitOfferEnabledAt: enabledAt })
      .onConflictDoUpdate({ target: salonRetentionSettingsSchema.salonId, set: { nextVisitOffer: settings, nextVisitOfferEnabledAt: enabledAt, updatedAt: new Date() } });
    return current;
  });
  await logAuditEvent({ salonId: salon.id, actorType: 'admin', actorId: admin.id, action: 'settings_updated', entityType: 'salon', entityId: salon.id, metadata: { feature: 'next_visit_offer', previouslyEnabled: previous.enabled, enabled: settings.enabled, windowDays: settings.windowDays, discountType: settings.discountType, value: settings.value } });
  return Response.json({ data: await data(salon.id) }, { headers: { 'Cache-Control': 'no-store' } });
}
