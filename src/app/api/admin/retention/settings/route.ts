import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { getAdminSession, requireAdminSalon } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import {
  mergeRetentionSettings,
  retentionSettingsPatchSchema,
} from '@/libs/retentionAssistant';
import {
  getRetentionSettingsForSalon,
  saveRetentionSettingsForSalon,
} from '@/libs/retentionSettings.server';
import { serviceSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  salonSlug: z.string().trim().min(1).max(200),
});

async function getAvailableServices(salonId: string) {
  return db
    .select({ id: serviceSchema.id, name: serviceSchema.name })
    .from(serviceSchema)
    .where(and(eq(serviceSchema.salonId, salonId), eq(serviceSchema.isActive, true)))
    .orderBy(asc(serviceSchema.sortOrder), asc(serviceSchema.name));
}

function parseQuery(request: Request) {
  return querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
}

export async function GET(request: Request): Promise<Response> {
  const parsed = parseQuery(request);
  if (!parsed.success) {
    return Response.json({
      error: { code: 'VALIDATION_ERROR', message: 'Salon is required.', details: parsed.error.flatten() },
    }, { status: 400 });
  }

  const { salon, error } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error!;
  }

  const [settings, availableServices] = await Promise.all([
    getRetentionSettingsForSalon(salon.id),
    getAvailableServices(salon.id),
  ]);

  return Response.json({ data: { settings, availableServices } });
}

export async function PATCH(request: Request): Promise<Response> {
  const parsedQuery = parseQuery(request);
  if (!parsedQuery.success) {
    return Response.json({
      error: { code: 'VALIDATION_ERROR', message: 'Salon is required.', details: parsedQuery.error.flatten() },
    }, { status: 400 });
  }

  const { salon, error } = await requireAdminSalon(parsedQuery.data.salonSlug);
  if (error || !salon) {
    return error!;
  }
  const admin = await getAdminSession();
  if (!admin) {
    return Response.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated.' } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: 'INVALID_JSON', message: 'A JSON request body is required.' } }, { status: 400 });
  }

  const parsedBody = retentionSettingsPatchSchema.safeParse(body);
  if (!parsedBody.success) {
    return Response.json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid retention settings.', details: parsedBody.error.flatten() },
    }, { status: 400 });
  }

  const current = await getRetentionSettingsForSalon(salon.id);
  let next;
  try {
    next = mergeRetentionSettings(current, parsedBody.data);
  } catch (validationError) {
    if (validationError instanceof z.ZodError) {
      return Response.json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid retention settings.', details: validationError.flatten() },
      }, { status: 400 });
    }
    throw validationError;
  }

  const eligibleServiceIds = [
    ...next.sixWeekPromotion.eligibleServiceIds,
    ...next.eightWeekPromotion.eligibleServiceIds,
  ];
  if (eligibleServiceIds.length > 0) {
    const ownedServices = await db
      .select({ id: serviceSchema.id })
      .from(serviceSchema)
      .where(and(
        eq(serviceSchema.salonId, salon.id),
        inArray(serviceSchema.id, [...new Set(eligibleServiceIds)]),
      ));
    const ownedIds = new Set(ownedServices.map(service => service.id));
    const invalidIds = [...new Set(eligibleServiceIds)].filter(id => !ownedIds.has(id));
    if (invalidIds.length > 0) {
      return Response.json({
        error: {
          code: 'INVALID_SERVICE',
          message: 'One or more eligible services do not belong to this salon.',
          details: { serviceIds: invalidIds },
        },
      }, { status: 400 });
    }
  }

  const settings = await saveRetentionSettingsForSalon(salon.id, next);
  const availableServices = await getAvailableServices(salon.id);

  void logAuditEvent({
    salonId: salon.id,
    actorType: 'admin',
    actorId: admin.id,
    action: 'settings_updated',
    entityType: 'salon_retention_settings',
    entityId: salon.id,
    metadata: { changedFields: Object.keys(parsedBody.data) },
  });

  return Response.json({ data: { settings, availableServices } });
}
