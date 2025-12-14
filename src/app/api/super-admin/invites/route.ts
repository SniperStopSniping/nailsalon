/**
 * Super Admin Invites API Route
 *
 * GET - List all invites (pending, expired, used)
 * POST - Create new invite (handles expired invites, sends SMS)
 *
 * Protected by requireSuperAdmin().
 */

import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { formatPhoneE164, isValidPhone, requireSuperAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import {
  ADMIN_INVITE_ROLES,
  type AdminInviteRole,
  adminInviteSchema,
  adminUserSchema,
  salonSchema,
} from '@/models/Schema';

// Force dynamic rendering
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
// GET - List invites
// =============================================================================

export async function GET() {
  // Auth check
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  try {
    const now = new Date();

    // Get all invites with salon info
    const invites = await db
      .select({
        id: adminInviteSchema.id,
        phoneE164: adminInviteSchema.phoneE164,
        salonId: adminInviteSchema.salonId,
        salonName: salonSchema.name,
        salonSlug: salonSchema.slug,
        role: adminInviteSchema.role,
        expiresAt: adminInviteSchema.expiresAt,
        usedAt: adminInviteSchema.usedAt,
        createdBy: adminInviteSchema.createdBy,
        createdAt: adminInviteSchema.createdAt,
      })
      .from(adminInviteSchema)
      .leftJoin(salonSchema, eq(adminInviteSchema.salonId, salonSchema.id))
      .orderBy(desc(adminInviteSchema.createdAt))
      .limit(100);

    // Add status to each invite
    const invitesWithStatus = invites.map((invite) => {
      let status: 'pending' | 'expired' | 'used';
      if (invite.usedAt) {
        status = 'used';
      } else if (invite.expiresAt < now) {
        status = 'expired';
      } else {
        status = 'pending';
      }

      return {
        ...invite,
        status,
      };
    });

    return NextResponse.json({ invites: invitesWithStatus });
  } catch (error) {
    console.error('Error listing invites:', error);
    return NextResponse.json(
      { error: 'Failed to list invites' },
      { status: 500 },
    );
  }
}

// =============================================================================
// POST - Create invite
// =============================================================================

export async function POST(request: Request) {
  // Auth check
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const { admin } = guard;

  try {
    const body = await request.json();
    const { phone, salonSlug, role, membershipRole } = body;

    // Validate phone
    if (!phone || !isValidPhone(phone)) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 },
      );
    }

    // Validate role
    if (!role || !ADMIN_INVITE_ROLES.includes(role as AdminInviteRole)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be ADMIN or SUPER_ADMIN.' },
        { status: 400 },
      );
    }

    // Validate membershipRole if provided
    const validMembershipRoles = ['admin', 'owner'];
    if (membershipRole && !validMembershipRoles.includes(membershipRole)) {
      return NextResponse.json(
        { error: 'Invalid membershipRole. Must be admin or owner.' },
        { status: 400 },
      );
    }

    const phoneE164 = formatPhoneE164(phone);
    const inviteRole = role as AdminInviteRole;

    // Validate salon requirement
    let salonId: string | null = null;
    let salonName: string | null = null;

    if (inviteRole === 'ADMIN') {
      if (!salonSlug) {
        return NextResponse.json(
          { error: 'ADMIN role requires a salon' },
          { status: 400 },
        );
      }

      const salon = await getSalonBySlug(salonSlug);
      if (!salon) {
        return NextResponse.json(
          { error: 'Salon not found' },
          { status: 404 },
        );
      }

      salonId = salon.id;
      salonName = salon.name;
    } else if (inviteRole === 'SUPER_ADMIN' && salonSlug) {
      return NextResponse.json(
        { error: 'SUPER_ADMIN role cannot be associated with a salon' },
        { status: 400 },
      );
    }

    // Check if user already exists
    const [existingUser] = await db
      .select({ id: adminUserSchema.id })
      .from(adminUserSchema)
      .where(eq(adminUserSchema.phoneE164, phoneE164))
      .limit(1);

    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this phone already exists' },
        { status: 409 },
      );
    }

    // Delete/expire old unused invites for same (phone, role, salonId)
    const now = new Date();
    await db
      .delete(adminInviteSchema)
      .where(
        and(
          eq(adminInviteSchema.phoneE164, phoneE164),
          eq(adminInviteSchema.role, inviteRole),
          salonId
            ? eq(adminInviteSchema.salonId, salonId)
            : isNull(adminInviteSchema.salonId),
          isNull(adminInviteSchema.usedAt),
          or(
            // Delete expired ones
            lte(adminInviteSchema.expiresAt, now),
            // Also delete unexpired ones (replacing with new)
            gt(adminInviteSchema.expiresAt, now),
          ),
        ),
      );

    // Create new invite (7 day expiry)
    const inviteId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    // Default membershipRole to 'admin' if not specified
    const finalMembershipRole = membershipRole || 'admin';

    await db.insert(adminInviteSchema).values({
      id: inviteId,
      phoneE164,
      salonId,
      role: inviteRole,
      membershipRole: finalMembershipRole,
      expiresAt,
      createdBy: admin.id,
    });

    // Send SMS invite
    const baseUrl
      = process.env.NEXT_PUBLIC_APP_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
      || 'http://localhost:3000';

    const loginUrl = `${baseUrl}/en/admin-login`;
    const roleDisplay = inviteRole === 'SUPER_ADMIN' ? 'Super Admin' : (finalMembershipRole === 'owner' ? 'Owner' : 'Admin');
    const salonText = salonName ? ` for ${salonName}` : '';

    const message = `You've been invited as ${roleDisplay}${salonText}.\n\nLog in here: ${loginUrl}`;

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
            To: phoneE164,
            From: TWILIO_PHONE_NUMBER!,
            Body: message,
          }),
        });

        console.warn(`[INVITE SMS] Sent to ${phoneE164}`);
      } catch (smsError) {
        console.error('Failed to send invite SMS:', smsError);
        // Don't fail the invite creation if SMS fails
      }
    } else {
      console.warn(`[DEV MODE] Would send invite SMS to ${phoneE164}:`);
      console.warn(message);
    }

    return NextResponse.json({
      success: true,
      invite: {
        id: inviteId,
        phoneE164,
        salonId,
        role: inviteRole,
        expiresAt,
        status: 'pending',
      },
    });
  } catch (error) {
    console.error('Error creating invite:', error);
    return NextResponse.json(
      { error: 'Failed to create invite' },
      { status: 500 },
    );
  }
}
