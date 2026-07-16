import { and, eq, gt, isNull } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { hashOpaqueToken } from '@/libs/lusterSecurity';
import { salonSchema, salonSignupInviteSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: { token: string } }) {
  const [invite] = await db
    .select({
      invitedEmail: salonSignupInviteSchema.invitedEmail,
      intent: salonSignupInviteSchema.intent,
      salonId: salonSignupInviteSchema.salonId,
      campaignSource: salonSignupInviteSchema.campaignSource,
      expiresAt: salonSignupInviteSchema.expiresAt,
      salonName: salonSchema.name,
      salonSlug: salonSchema.slug,
    })
    .from(salonSignupInviteSchema)
    .leftJoin(salonSchema, eq(salonSignupInviteSchema.salonId, salonSchema.id))
    .where(and(
      eq(salonSignupInviteSchema.tokenHash, hashOpaqueToken(context.params.token)),
      isNull(salonSignupInviteSchema.consumedAt),
      isNull(salonSignupInviteSchema.revokedAt),
      gt(salonSignupInviteSchema.expiresAt, new Date()),
    ))
    .limit(1);

  if (!invite) {
    return Response.json({ error: { code: 'INVITE_INVALID', message: 'This invitation is invalid, expired, or already used.' } }, { status: 404 });
  }
  return Response.json({ data: invite });
}
