/**
 * Admin Verify OTP API Route
 *
 * Verifies OTP and creates admin session.
 * Handles:
 * - Existing admin users
 * - New users with valid invites (claims invite atomically)
 * - Bootstrap phone (creates first super admin)
 *
 * All invite claiming done in a transaction.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq, and, gt, isNull } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  adminUserSchema,
  adminSessionSchema,
  adminInviteSchema,
  adminSalonMembershipSchema,
} from '@/models/Schema';
import {
  formatPhoneE164,
  isValidPhone,
  ADMIN_SESSION_COOKIE,
  COOKIE_OPTIONS,
  SESSION_DURATION_MS,
  getAdminByPhone,
  getAdminWithSalons,
  shouldBootstrap,
} from '@/libs/adminAuth';
import { checkOtpRateLimit, getClientIp } from '@/libs/rateLimit';

// =============================================================================
// ENVIRONMENT
// =============================================================================

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

const isTwilioConfigured = Boolean(
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_VERIFY_SERVICE_SID,
);

// =============================================================================
// TYPES
// =============================================================================

type VerifyResult = {
  success: true;
  user: {
    id: string;
    phoneE164: string;
    name: string | null;
    email: string | null;
    isSuperAdmin: boolean;
  };
  destination: 'SUPER_ADMIN' | 'ADMIN';
  salonSlug?: string;
} | {
  success: false;
  error: string;
  status: number;
};

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: Request) {
  try {
    // Parse request body
    const body = await request.json();
    const { phone, code } = body;

    // Validate inputs
    if (!phone || !isValidPhone(phone)) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 },
      );
    }

    if (!code || code.length !== 6 || !/^\d+$/.test(code)) {
      return NextResponse.json(
        { error: 'Invalid verification code format' },
        { status: 400 },
      );
    }

    const phoneE164 = formatPhoneE164(phone);
    const ip = getClientIp(request);

    // Rate limit check (prevent brute force)
    const rateLimit = checkOtpRateLimit(ip, phoneE164, {
      perIpPerMinute: 10,
      perPhonePerMinute: 5,
      perPhonePerDay: 20,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 },
      );
    }

    // ==========================================================================
    // VERIFY OTP
    // ==========================================================================

    let otpValid = false;

    if (!isTwilioConfigured) {
      // Dev mode: accept 123456
      otpValid = code === '123456';
      if (otpValid) {
        console.log(`[DEV MODE] Admin OTP verified for ${phoneE164}`);
      }
    } else {
      // Production: verify via Twilio
      const twilioUrl = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`;

      const response = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          To: phoneE164,
          Code: code,
        }),
      });

      const data = await response.json();
      otpValid = response.ok && data.status === 'approved';

      if (otpValid) {
        console.log(`[ADMIN OTP] Verified for ${phoneE164}, SID: ${data.sid}`);
      }
    }

    if (!otpValid) {
      return NextResponse.json(
        { error: 'Invalid verification code' },
        { status: 401 },
      );
    }

    // ==========================================================================
    // AUTHORIZE AND CREATE SESSION
    // ==========================================================================

    const result = await authorizeAndCreateSession(phoneE164);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    // Set session cookie
    const cookieStore = await cookies();
    cookieStore.set(ADMIN_SESSION_COOKIE, result.user.id, {
      ...COOKIE_OPTIONS,
      maxAge: SESSION_DURATION_MS / 1000,
    });

    // Note: We stored session.id in the cookie, but result.user.id is the admin user id
    // We need to return the session data properly

    // Profile is complete when both name and email are set
    const profileComplete = Boolean(result.user.name && result.user.email);

    return NextResponse.json({
      success: true,
      user: {
        id: result.user.id,
        phone: result.user.phoneE164,
        name: result.user.name,
        email: result.user.email,
        isSuperAdmin: result.user.isSuperAdmin,
      },
      profileComplete,
      destination: result.destination,
      salonSlug: result.salonSlug,
    });
  } catch (error) {
    console.error('Admin verify OTP error:', error);

    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 },
    );
  }
}

// =============================================================================
// AUTHORIZATION LOGIC (with transaction)
// =============================================================================

async function authorizeAndCreateSession(phoneE164: string): Promise<VerifyResult> {
  // Check 1: Existing admin user
  const existingAdmin = await getAdminByPhone(phoneE164);
  if (existingAdmin) {
    // Create session for existing user
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await db.insert(adminSessionSchema).values({
      id: sessionId,
      adminId: existingAdmin.id,
      expiresAt,
    });

    // Get salons for redirect
    const adminWithSalons = await getAdminWithSalons(existingAdmin.id);
    const salonSlug = adminWithSalons?.salons[0]?.salonSlug;

    // Set the session ID in user object for cookie
    return {
      success: true,
      user: {
        id: sessionId,
        phoneE164: existingAdmin.phoneE164,
        name: existingAdmin.name,
        email: existingAdmin.email ?? null,
        isSuperAdmin: existingAdmin.isSuperAdmin,
      },
      destination: existingAdmin.isSuperAdmin ? 'SUPER_ADMIN' : 'ADMIN',
      salonSlug,
    };
  }

  // Check 2: Valid invite - claim in transaction
  const invite = await db
    .select()
    .from(adminInviteSchema)
    .where(
      and(
        eq(adminInviteSchema.phoneE164, phoneE164),
        isNull(adminInviteSchema.usedAt),
        gt(adminInviteSchema.expiresAt, new Date()),
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);

  if (invite) {
    // Claim invite in transaction
    const adminId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await db.transaction(async (tx) => {
      // Lock and verify invite still valid
      const [lockedInvite] = await tx
        .select()
        .from(adminInviteSchema)
        .where(
          and(
            eq(adminInviteSchema.id, invite.id),
            isNull(adminInviteSchema.usedAt),
          ),
        )
        .for('update')
        .limit(1);

      if (!lockedInvite) {
        throw new Error('Invite already claimed');
      }

      // Create admin user
      await tx.insert(adminUserSchema).values({
        id: adminId,
        phoneE164,
        isSuperAdmin: invite.role === 'SUPER_ADMIN',
      });

      // Create salon membership if ADMIN role
      if (invite.role === 'ADMIN' && invite.salonId) {
        // Use membershipRole from invite if set, otherwise default to 'admin'
        const membershipRole = invite.membershipRole || 'admin';
        await tx.insert(adminSalonMembershipSchema).values({
          adminId,
          salonId: invite.salonId,
          role: membershipRole,
        });
      }

      // Mark invite as used
      await tx
        .update(adminInviteSchema)
        .set({ usedAt: new Date() })
        .where(eq(adminInviteSchema.id, invite.id));

      // Create session
      await tx.insert(adminSessionSchema).values({
        id: sessionId,
        adminId,
        expiresAt,
      });
    });

    // Get salon slug for redirect
    let salonSlug: string | undefined;
    if (invite.salonId) {
      const adminWithSalons = await getAdminWithSalons(adminId);
      salonSlug = adminWithSalons?.salons[0]?.salonSlug;
    }

    return {
      success: true,
      user: {
        id: sessionId,
        phoneE164,
        name: null,
        email: null,
        isSuperAdmin: invite.role === 'SUPER_ADMIN',
      },
      destination: invite.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN',
      salonSlug,
    };
  }

  // Check 3: Bootstrap phone
  const isBootstrap = await shouldBootstrap(phoneE164);
  if (isBootstrap) {
    // Create super admin
    const adminId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await db.transaction(async (tx) => {
      // Double-check no super admin exists (race condition protection)
      const [existing] = await tx
        .select({ id: adminUserSchema.id })
        .from(adminUserSchema)
        .where(eq(adminUserSchema.isSuperAdmin, true))
        .limit(1);

      if (existing) {
        throw new Error('Super admin already exists');
      }

      // Create super admin user
      await tx.insert(adminUserSchema).values({
        id: adminId,
        phoneE164,
        isSuperAdmin: true,
      });

      // Create session
      await tx.insert(adminSessionSchema).values({
        id: sessionId,
        adminId,
        expiresAt,
      });
    });

    console.log(`[BOOTSTRAP] Created super admin for ${phoneE164}`);

    return {
      success: true,
      user: {
        id: sessionId,
        phoneE164,
        name: null,
        email: null,
        isSuperAdmin: true,
      },
      destination: 'SUPER_ADMIN',
    };
  }

  // Not authorized
  return {
    success: false,
    error: 'Not authorized. Please contact your administrator.',
    status: 403,
  };
}
