import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireSuperAdmin } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { createOpaqueToken } from '@/libs/lusterSecurity';
import { buildSalonPublicUrl } from '@/libs/publicUrl';
import { sendSalonSignupInviteEmail } from '@/libs/salonSignupInviteEmail';
import { requireSuperAdminTestTools } from '@/libs/superAdminTestTools.server';
import {
  adminSalonMembershipSchema,
  appointmentSchema,
  salonSchema,
  salonSignupInviteSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  email: z.string().email(),
  campaignSource: z.string().trim().max(100).optional(),
  salonId: z.string().trim().min(1).optional(),
  testTool: z.boolean().optional(),
});

class InviteError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export async function GET() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }
  const invites = await db
    .select({
      id: salonSignupInviteSchema.id,
      invitedEmail: salonSignupInviteSchema.invitedEmail,
      intent: salonSignupInviteSchema.intent,
      salonId: salonSignupInviteSchema.salonId,
      campaignSource: salonSignupInviteSchema.campaignSource,
      expiresAt: salonSignupInviteSchema.expiresAt,
      consumedAt: salonSignupInviteSchema.consumedAt,
      revokedAt: salonSignupInviteSchema.revokedAt,
      emailDeliveryStatus: salonSignupInviteSchema.emailDeliveryStatus,
      emailSentAt: salonSignupInviteSchema.emailSentAt,
      emailDeliveryErrorCode: salonSignupInviteSchema.emailDeliveryErrorCode,
      createdAt: salonSignupInviteSchema.createdAt,
    })
    .from(salonSignupInviteSchema)
    .orderBy(desc(salonSignupInviteSchema.createdAt))
    .limit(100);
  const now = new Date();
  return Response.json({
    data: invites.map(invite => ({
      ...invite,
      status: invite.consumedAt
        ? 'consumed'
        : invite.revokedAt
          ? 'revoked'
          : invite.expiresAt <= now
            ? 'expired'
            : 'active',
    })),
  });
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: 'INVALID_INVITE', message: 'Enter a valid email address.' } }, { status: 400 });
  }

  const guard = parsed.data.testTool
    ? await requireSuperAdminTestTools()
    : await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const { token, tokenHash } = createOpaqueToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  try {
    const created = await db.transaction(async (tx) => {
      let salonName: string | null = null;
      const intent = parsed.data.salonId ? 'claim_existing' as const : 'create_salon' as const;

      if (parsed.data.salonId) {
        const [salon] = await tx
          .select({
            id: salonSchema.id,
            name: salonSchema.name,
            ownerEmail: salonSchema.ownerEmail,
            ownerClerkUserId: salonSchema.ownerClerkUserId,
          })
          .from(salonSchema)
          .where(eq(salonSchema.id, parsed.data.salonId))
          .limit(1);
        if (!salon) {
          throw new InviteError('SALON_NOT_FOUND');
        }

        const [membershipCount] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(adminSalonMembershipSchema)
          .where(eq(adminSalonMembershipSchema.salonId, salon.id));
        const [appointmentCount] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(appointmentSchema)
          .where(eq(appointmentSchema.salonId, salon.id));

        if (
          salon.ownerClerkUserId
          || Number(membershipCount?.count ?? 0) > 0
          || Number(appointmentCount?.count ?? 0) > 0
        ) {
          throw new InviteError('CLAIM_REQUIRES_REVIEW');
        }
        if (salon.ownerEmail?.trim().toLowerCase() !== normalizedEmail) {
          throw new InviteError('OWNER_EMAIL_MISMATCH');
        }
        salonName = salon.name;

        await tx
          .update(salonSignupInviteSchema)
          .set({ revokedAt: now })
          .where(and(
            eq(salonSignupInviteSchema.salonId, salon.id),
            isNull(salonSignupInviteSchema.consumedAt),
            isNull(salonSignupInviteSchema.revokedAt),
          ));
        await tx
          .update(salonSchema)
          .set({ publicationStatus: 'draft', publishedAt: null })
          .where(eq(salonSchema.id, salon.id));
      } else {
        await tx
          .update(salonSignupInviteSchema)
          .set({ revokedAt: now })
          .where(and(
            eq(salonSignupInviteSchema.intent, 'create_salon'),
            eq(salonSignupInviteSchema.invitedEmail, normalizedEmail),
            isNull(salonSignupInviteSchema.consumedAt),
            isNull(salonSignupInviteSchema.revokedAt),
          ));
      }

      const invite = {
        id: crypto.randomUUID(),
        tokenHash,
        invitedEmail: normalizedEmail,
        intent,
        salonId: parsed.data.salonId ?? null,
        campaignSource: parsed.data.campaignSource || null,
        expiresAt,
        createdByAdminId: guard.admin.id,
        emailDeliveryStatus: 'pending' as const,
      };
      await tx.insert(salonSignupInviteSchema).values(invite);
      return { invite, salonName };
    });

    const joinUrl = buildSalonPublicUrl(`/en/join/${token}`);
    const delivery = await sendSalonSignupInviteEmail({
      to: normalizedEmail,
      joinUrl,
      expiresAt,
      salonName: created.salonName,
    });
    const deliveryStatus = delivery.ok ? 'sent' as const : 'failed' as const;
    await db
      .update(salonSignupInviteSchema)
      .set({
        emailDeliveryStatus: deliveryStatus,
        emailSentAt: delivery.ok ? new Date() : null,
        emailDeliveryErrorCode: delivery.errorCode,
      })
      .where(eq(salonSignupInviteSchema.id, created.invite.id));

    await logAuditEvent({
      salonId: created.invite.salonId,
      actorType: 'super_admin',
      actorId: guard.admin.id,
      action: 'signup_invitation_delivery_attempted',
      entityType: 'salon_signup_invite',
      entityId: created.invite.id,
      metadata: { deliveryStatus, errorCode: delivery.errorCode },
    });

    await logAuditEvent({
      salonId: created.invite.salonId,
      actorType: 'super_admin',
      actorId: guard.admin.id,
      action: created.invite.intent === 'claim_existing'
        ? 'salon_claim_invitation_created'
        : parsed.data.testTool
          ? 'test_invitation_created'
          : 'signup_invitation_created',
      entityType: 'salon_signup_invite',
      entityId: created.invite.id,
      metadata: {
        intent: created.invite.intent,
        deliveryStatus,
        environment: process.env.VERCEL_ENV ?? process.env.APP_ENV ?? process.env.NODE_ENV,
      },
    });

    return Response.json({
      data: {
        id: created.invite.id,
        email: created.invite.invitedEmail,
        intent: created.invite.intent,
        salonId: created.invite.salonId,
        status: 'active',
        emailDeliveryStatus: deliveryStatus,
        emailDeliveryErrorCode: delivery.errorCode,
        expiresAt: created.invite.expiresAt,
        joinUrl,
      },
    }, { status: 201 });
  } catch (error) {
    const code = error instanceof InviteError ? error.code : 'INVITE_CREATE_FAILED';
    await logAuditEvent({
      salonId: parsed.data.salonId ?? null,
      actorType: 'super_admin',
      actorId: guard.admin.id,
      action: 'signup_invitation_failed',
      entityType: parsed.data.salonId ? 'salon' : 'salon_signup_invite',
      entityId: parsed.data.salonId ?? null,
      metadata: {
        intent: parsed.data.salonId ? 'claim_existing' : 'create_salon',
        failureCode: code,
        environment: process.env.VERCEL_ENV ?? process.env.APP_ENV ?? process.env.NODE_ENV,
      },
    });
    const messages: Record<string, string> = {
      SALON_NOT_FOUND: 'Salon not found.',
      OWNER_EMAIL_MISMATCH: 'The invitation email must match the salon owner email.',
      CLAIM_REQUIRES_REVIEW: 'This salon has account or appointment data and must be reviewed before it can be claimed.',
      INVITE_CREATE_FAILED: 'The invitation could not be created.',
    };
    const status = code === 'SALON_NOT_FOUND' ? 404 : code === 'INVITE_CREATE_FAILED' ? 500 : 409;
    if (status >= 500) {
      console.error('[Luster signup invite] Creation failed');
    }
    return Response.json({ error: { code, message: messages[code] } }, { status });
  }
}
