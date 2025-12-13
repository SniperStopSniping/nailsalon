/**
 * Super Admin - Resend Invite
 *
 * POST - Resend an existing invite (renews expiration if expired)
 */

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { requireSuperAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { adminInviteSchema, salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// SMS CONFIG
// =============================================================================

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

const isTwilioConfigured = Boolean(
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER,
);

// =============================================================================
// POST /api/super-admin/invites/[id]/resend - Resend an invite
// =============================================================================

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const { id: inviteId } = await params;

  try {
    // Find the invite
    const [invite] = await db
      .select({
        id: adminInviteSchema.id,
        phoneE164: adminInviteSchema.phoneE164,
        salonId: adminInviteSchema.salonId,
        role: adminInviteSchema.role,
        membershipRole: adminInviteSchema.membershipRole,
        expiresAt: adminInviteSchema.expiresAt,
        usedAt: adminInviteSchema.usedAt,
      })
      .from(adminInviteSchema)
      .where(eq(adminInviteSchema.id, inviteId))
      .limit(1);

    if (!invite) {
      return NextResponse.json(
        { error: 'Invite not found' },
        { status: 404 },
      );
    }

    // Cannot resend a used invite
    if (invite.usedAt) {
      return NextResponse.json(
        { error: 'Cannot resend an invite that has already been used' },
        { status: 400 },
      );
    }

    // Get salon name for SMS
    let salonName: string | null = null;
    if (invite.salonId) {
      const [salon] = await db
        .select({ name: salonSchema.name })
        .from(salonSchema)
        .where(eq(salonSchema.id, invite.salonId))
        .limit(1);
      salonName = salon?.name ?? null;
    }

    // Renew expiration (7 days from now)
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db
      .update(adminInviteSchema)
      .set({ expiresAt: newExpiresAt })
      .where(eq(adminInviteSchema.id, inviteId));

    // Send SMS invite
    const baseUrl
      = process.env.NEXT_PUBLIC_APP_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
      || 'http://localhost:3000';

    const loginUrl = `${baseUrl}/en/admin-login`;
    const roleDisplay
      = invite.role === 'SUPER_ADMIN'
        ? 'Super Admin'
        : invite.membershipRole === 'owner'
          ? 'Owner'
          : 'Admin';
    const salonText = salonName ? ` for ${salonName}` : '';

    const message = `Reminder: You've been invited as ${roleDisplay}${salonText}.\n\nLog in here: ${loginUrl}`;

    if (isTwilioConfigured) {
      try {
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

        await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
          },
          body: new URLSearchParams({
            To: invite.phoneE164,
            From: TWILIO_PHONE_NUMBER!,
            Body: message,
          }),
        });

        console.log(`[INVITE SMS RESEND] Sent to ${invite.phoneE164}`);
      } catch (smsError) {
        console.error('Failed to resend invite SMS:', smsError);
        // Don't fail if SMS fails
      }
    } else {
      console.log(`[DEV MODE] Would resend invite SMS to ${invite.phoneE164}:`);
      console.log(message);
    }

    return NextResponse.json({
      success: true,
      invite: {
        id: invite.id,
        phoneE164: invite.phoneE164,
        salonId: invite.salonId,
        role: invite.role,
        expiresAt: newExpiresAt,
        status: 'pending',
      },
    });
  } catch (error) {
    console.error('Error resending invite:', error);
    return NextResponse.json(
      { error: 'Failed to resend invite' },
      { status: 500 },
    );
  }
}
