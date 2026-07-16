import { and, eq, isNull } from 'drizzle-orm';

import { requireSuperAdmin } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { createOpaqueToken } from '@/libs/lusterSecurity';
import { buildSalonPublicUrl } from '@/libs/publicUrl';
import { sendSalonSignupInviteEmail } from '@/libs/salonSignupInviteEmail';
import { salonSchema, salonSignupInviteSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const { id } = await params;
  const { token, tokenHash } = createOpaqueToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const [invite] = await db
    .update(salonSignupInviteSchema)
    .set({
      tokenHash,
      expiresAt,
      emailDeliveryStatus: 'pending',
      emailSentAt: null,
      emailDeliveryErrorCode: null,
    })
    .where(and(
      eq(salonSignupInviteSchema.id, id),
      isNull(salonSignupInviteSchema.consumedAt),
      isNull(salonSignupInviteSchema.revokedAt),
    ))
    .returning();
  if (!invite) {
    return Response.json({
      error: { code: 'INVITE_NOT_ACTIVE', message: 'This invitation is no longer active.' },
    }, { status: 409 });
  }

  let salonName: string | null = null;
  if (invite.salonId) {
    const [salon] = await db
      .select({ name: salonSchema.name })
      .from(salonSchema)
      .where(eq(salonSchema.id, invite.salonId))
      .limit(1);
    salonName = salon?.name ?? null;
  }

  const joinUrl = buildSalonPublicUrl(`/en/join/${token}`);
  const delivery = await sendSalonSignupInviteEmail({
    to: invite.invitedEmail,
    joinUrl,
    expiresAt,
    salonName,
  });
  const emailDeliveryStatus = delivery.ok ? 'sent' as const : 'failed' as const;
  await db
    .update(salonSignupInviteSchema)
    .set({
      emailDeliveryStatus,
      emailSentAt: delivery.ok ? new Date() : null,
      emailDeliveryErrorCode: delivery.errorCode,
    })
    .where(eq(salonSignupInviteSchema.id, invite.id));

  await logAuditEvent({
    salonId: invite.salonId,
    actorType: 'super_admin',
    actorId: guard.admin.id,
    action: 'signup_invitation_delivery_attempted',
    entityType: 'salon_signup_invite',
    entityId: invite.id,
    metadata: { deliveryStatus: emailDeliveryStatus, errorCode: delivery.errorCode },
  });

  await logAuditEvent({
    salonId: invite.salonId,
    actorType: 'super_admin',
    actorId: guard.admin.id,
    action: 'signup_invitation_resent',
    entityType: 'salon_signup_invite',
    entityId: invite.id,
    metadata: { intent: invite.intent, deliveryStatus: emailDeliveryStatus },
  });

  return Response.json({
    data: {
      id: invite.id,
      email: invite.invitedEmail,
      intent: invite.intent,
      salonId: invite.salonId,
      status: 'active',
      emailDeliveryStatus,
      emailDeliveryErrorCode: delivery.errorCode,
      expiresAt,
      joinUrl,
    },
  });
}
