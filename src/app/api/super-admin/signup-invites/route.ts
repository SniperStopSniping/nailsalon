import { desc } from 'drizzle-orm';
import { z } from 'zod';

import { requireSuperAdmin } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { createOpaqueToken } from '@/libs/lusterSecurity';
import { buildSalonPublicUrl } from '@/libs/publicUrl';
import { requireSuperAdminTestTools } from '@/libs/superAdminTestTools.server';
import { salonSignupInviteSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  email: z.string().email(),
  campaignSource: z.string().trim().max(100).optional(),
  testTool: z.boolean().optional(),
});

export async function GET() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }
  const invites = await db
    .select({
      id: salonSignupInviteSchema.id,
      invitedEmail: salonSignupInviteSchema.invitedEmail,
      campaignSource: salonSignupInviteSchema.campaignSource,
      expiresAt: salonSignupInviteSchema.expiresAt,
      consumedAt: salonSignupInviteSchema.consumedAt,
      createdAt: salonSignupInviteSchema.createdAt,
    })
    .from(salonSignupInviteSchema)
    .orderBy(desc(salonSignupInviteSchema.createdAt))
    .limit(100);
  return Response.json({ data: invites });
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

  const { token, tokenHash } = createOpaqueToken();
  const invite = {
    id: crypto.randomUUID(),
    tokenHash,
    invitedEmail: parsed.data.email.trim().toLowerCase(),
    campaignSource: parsed.data.campaignSource || null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdByAdminId: guard.admin.id,
  };
  await db.insert(salonSignupInviteSchema).values(invite);

  if (parsed.data.testTool) {
    await logAuditEvent({
      actorType: 'super_admin',
      actorId: guard.admin.id,
      action: 'test_invitation_created',
      entityType: 'salon_signup_invite',
      entityId: invite.id,
      metadata: { environment: process.env.VERCEL_ENV ?? process.env.APP_ENV ?? process.env.NODE_ENV },
    });
  }

  return Response.json({
    data: {
      id: invite.id,
      email: invite.invitedEmail,
      expiresAt: invite.expiresAt,
      joinUrl: buildSalonPublicUrl(`/en/join/${token}`),
    },
  }, { status: 201 });
}
