import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';

import { getAdminSession, requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';
import { normalizeRetentionPhone, resolveRetentionStage } from '@/libs/retentionAssistant';
import {
  createRetentionCampaignToken,
  getCampaignExpiry,
  hashRetentionCampaignToken,
} from '@/libs/retentionCampaigns';
import { getRetentionSettingsForSalon } from '@/libs/retentionSettings.server';
import {
  appointmentSchema,
  clientCommunicationSchema,
  retentionCampaignSchema,
  salonClientSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

const mintCampaignSchema = z.object({
  salonSlug: z.string().trim().min(1).max(200),
  clientId: z.string().trim().min(1).max(200),
  stage: z.enum(['promo_6w', 'promo_8w']),
  communicationId: z.string().trim().min(1).max(200).optional(),
}).strict();

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: 'INVALID_JSON', message: 'A JSON request body is required.' } }, { status: 400 });
  }

  const parsed = mintCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid campaign request.', details: parsed.error.flatten() },
    }, { status: 400 });
  }

  const { salon, error } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error!;
  }
  const admin = await getAdminSession();
  if (!admin) {
    return Response.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated.' } }, { status: 401 });
  }

  const [client] = await db
    .select({
      id: salonClientSchema.id,
      phone: salonClientSchema.phone,
      lastVisitAt: salonClientSchema.lastVisitAt,
      rebookIntervalDays: salonClientSchema.rebookIntervalDays,
      isBlocked: salonClientSchema.isBlocked,
    })
    .from(salonClientSchema)
    .where(and(
      eq(salonClientSchema.id, parsed.data.clientId),
      eq(salonClientSchema.salonId, salon.id),
    ))
    .limit(1);
  if (!client) {
    return Response.json({ error: { code: 'CLIENT_NOT_FOUND', message: 'Client not found.' } }, { status: 404 });
  }
  if (client.isBlocked) {
    return Response.json({
      error: { code: 'CLIENT_BLOCKED', message: 'Promotions cannot be prepared for a blocked client.' },
    }, { status: 409 });
  }

  const normalizedPhone = normalizeRetentionPhone(client.phone);
  const phoneVariants = [...new Set([client.phone, normalizedPhone, `+1${normalizedPhone}`])];

  const [futureAppointment] = await db
    .select({ id: appointmentSchema.id })
    .from(appointmentSchema)
    .where(and(
      eq(appointmentSchema.salonId, salon.id),
      or(
        eq(appointmentSchema.salonClientId, client.id),
        inArray(appointmentSchema.clientPhone, phoneVariants),
      ),
      gt(appointmentSchema.startTime, new Date()),
      inArray(appointmentSchema.status, ['pending', 'confirmed']),
      isNull(appointmentSchema.deletedAt),
    ))
    .limit(1);
  if (futureAppointment) {
    return Response.json({
      error: { code: 'CLIENT_ALREADY_BOOKED', message: 'This client already has an upcoming appointment.' },
    }, { status: 409 });
  }

  const settings = await getRetentionSettingsForSalon(salon.id);
  if (!client.lastVisitAt) {
    return Response.json({ error: { code: 'CAMPAIGN_NOT_DUE', message: 'This client has no completed visit.' } }, { status: 409 });
  }
  const dueStage = resolveRetentionStage({
    lastVisitAt: client.lastVisitAt,
    now: new Date(),
    rebookIntervalDays: client.rebookIntervalDays,
    defaultRebookDays: settings.defaultRebookDays,
  });
  if (dueStage?.stage !== parsed.data.stage) {
    return Response.json({
      error: { code: 'CAMPAIGN_NOT_DUE', message: 'This promotion is not the active retention stage for the client.' },
    }, { status: 409 });
  }

  const promotion = parsed.data.stage === 'promo_6w'
    ? settings.sixWeekPromotion
    : settings.eightWeekPromotion;
  if (!promotion.enabled) {
    return Response.json({
      error: { code: 'PROMOTION_DISABLED', message: 'Configure and enable this promotion before sending it.' },
    }, { status: 409 });
  }

  let communication: typeof clientCommunicationSchema.$inferSelect | null = null;
  if (parsed.data.communicationId) {
    const communicationRows = await db
      .select()
      .from(clientCommunicationSchema)
      .where(and(
        eq(clientCommunicationSchema.id, parsed.data.communicationId),
        eq(clientCommunicationSchema.salonId, salon.id),
        eq(clientCommunicationSchema.salonClientId, client.id),
        eq(clientCommunicationSchema.kind, parsed.data.stage),
      ))
      .limit(1);
    communication = communicationRows[0] ?? null;
    if (!communication) {
      return Response.json({ error: { code: 'COMMUNICATION_NOT_FOUND', message: 'Communication not found.' } }, { status: 404 });
    }
  }

  const now = new Date();
  const token = createRetentionCampaignToken();
  const campaignId = `campaign_${crypto.randomUUID()}`;
  const expiresAt = getCampaignExpiry(now, promotion.expiryDays);
  const bookingUrl = buildSalonTenantPublicUrl(`/book?campaign=${encodeURIComponent(token)}`, salon);

  await db.transaction(async (tx) => {
    await tx.insert(retentionCampaignSchema).values({
      id: campaignId,
      salonId: salon.id,
      salonClientId: client.id,
      communicationId: communication?.id ?? null,
      tokenHash: hashRetentionCampaignToken(token),
      stage: parsed.data.stage,
      promotionSnapshot: promotion,
      expiresAt,
      singleUse: promotion.singleUse,
    });

    if (communication) {
      await tx
        .update(clientCommunicationSchema)
        .set({
          metadata: {
            ...(communication.metadata ?? {}),
            campaignId,
            campaignStage: parsed.data.stage,
          },
          updatedAt: now,
        })
        .where(and(
          eq(clientCommunicationSchema.id, communication.id),
          eq(clientCommunicationSchema.salonId, salon.id),
        ));
    }
  });

  return Response.json({
    data: {
      campaign: {
        id: campaignId,
        stage: parsed.data.stage,
        expiresAt: expiresAt.toISOString(),
        bookingUrl,
        token,
      },
    },
  }, { status: 201 });
}
