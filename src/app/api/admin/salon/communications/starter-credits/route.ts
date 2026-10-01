import { currentUser } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { getAdminImpersonationForAdmin, requireAdmin, requireRealSalonOwner } from '@/libs/adminAuth';
import { BusinessIdentityError } from '@/libs/billing/businessIdentity';
import { getStarterAllowanceStatus } from '@/libs/billing/starterAllowanceStatus';
import { claimVerifiedStarterCredits } from '@/libs/billing/verifiedStarterGrant';
import { db } from '@/libs/DB';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } } as const;

const requestSchema = z.object({
  salonId: z.string().trim().min(1).max(128),
}).strict();

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return origin !== null && origin === new URL(request.url).origin;
}

function responseError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, ...NO_STORE });
}

class InactiveSalonError extends Error {}

async function requireClaimableSalon(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  salonId: string,
) {
  const [salon] = await tx
    .select({ id: salonSchema.id, deletedAt: salonSchema.deletedAt })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1)
    .for('update');
  if (!salon || salon.deletedAt !== null) {
    throw new InactiveSalonError();
  }
}

function verifiedPrimaryIdentity(user: Awaited<ReturnType<typeof currentUser>>) {
  if (!user) {
    return { verifiedEmail: null, verifiedPhone: null };
  }
  const email = user.emailAddresses.find(address => address.id === user.primaryEmailAddressId);
  const phone = user.phoneNumbers.find(number => number.id === user.primaryPhoneNumberId);
  return {
    verifiedEmail: email?.verification?.status === 'verified' ? email.emailAddress : null,
    verifiedPhone: phone?.verification?.status === 'verified' ? phone.phoneNumber : null,
  };
}

/** Status is safe for authorized dashboard readers. Opening Usage never claims credits. */
export async function GET(request: Request): Promise<Response> {
  const parsed = requestSchema.safeParse({ salonId: new URL(request.url).searchParams.get('salonId') });
  if (!parsed.success) {
    return responseError(400, 'INVALID_INPUT', 'A salon is required.');
  }
  const salonId = parsed.data.salonId;
  const guard = await requireAdmin(salonId);
  if (!guard.ok) {
    guard.response.headers.set('Cache-Control', 'private, no-store');
    return guard.response;
  }
  const rateLimit = checkEndpointRateLimit('communications/starter-credit-status', getClientIp(request), 'GENERAL');
  if (!rateLimit.allowed) {
    const limited = rateLimitResponse(rateLimit.retryAfterMs);
    limited.headers.set('Cache-Control', 'private, no-store');
    return limited;
  }
  try {
    const [salon] = await db.select({ deletedAt: salonSchema.deletedAt })
      .from(salonSchema).where(eq(salonSchema.id, salonId)).limit(1);
    if (!salon || salon.deletedAt !== null) {
      return responseError(409, 'SALON_UNAVAILABLE', 'This free-text allowance is unavailable for this salon.');
    }
    const status = await db.transaction(tx => getStarterAllowanceStatus(tx, salonId));
    let canClaim = false;
    if (status !== 'verified'
      && guard.admin.clerkUserId
      && guard.admin.salons.some(membership => membership.salonId === salonId && membership.role === 'owner')
      && !await getAdminImpersonationForAdmin(guard.admin)) {
      const user = await currentUser();
      canClaim = user?.id === guard.admin.clerkUserId;
    }
    return Response.json({ data: { status, canClaim } }, NO_STORE);
  } catch {
    return responseError(500, 'STARTER_STATUS_ERROR', 'Free-text allowance status could not be loaded. Please try again.');
  }
}

/**
 * Claims the single free SMS-credit allowance for an owner identity.
 * The caller never supplies email or phone values: only Clerk's currently
 * authenticated, verified primary contact methods participate in the claim.
 */
export async function POST(request: Request): Promise<Response> {
  // Parse only the target needed for the owner guard. The guard then rejects
  // collaborators and impersonated super-admin sessions before any billing or
  // identity records are read.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return responseError(400, 'INVALID_INPUT', 'A salon is required.');
  }

  const owner = await requireRealSalonOwner(parsed.data.salonId);
  if (!owner.ok) {
    // Keep the shared strict guard while using credit-specific copy here.
    if (owner.response.status === 403) {
      const denial = await owner.response.clone().json().catch(() => null);
      if (denial?.error?.code === 'IMPERSONATION_NOT_ALLOWED') {
        return responseError(403, 'IMPERSONATION_NOT_ALLOWED', 'Free-text allowance verification is unavailable while impersonating. Sign in with the owner account.');
      }
      if (denial?.error?.code === 'OWNER_REQUIRED') {
        return responseError(403, 'OWNER_REQUIRED', 'Only the salon owner can verify the free-text allowance. Sign in with the owner account.');
      }
    }
    return owner.response;
  }
  if (!sameOrigin(request)) {
    return responseError(403, 'INVALID_ORIGIN', 'Invalid request origin.');
  }

  const user = await currentUser();
  if (!user || !owner.admin.clerkUserId || user.id !== owner.admin.clerkUserId) {
    return responseError(403, 'OWNER_IDENTITY_REQUIRED', 'Your owner identity could not be confirmed.');
  }

  const rateLimit = checkEndpointRateLimit(
    'communications/starter-credits',
    getClientIp(request),
    'GENERAL',
  );
  if (!rateLimit.allowed) {
    const limited = rateLimitResponse(rateLimit.retryAfterMs);
    limited.headers.set('Cache-Control', 'private, no-store');
    return limited;
  }

  const identity = verifiedPrimaryIdentity(user);
  try {
    const result = await db.transaction(async (tx) => {
      await requireClaimableSalon(tx, parsed.data.salonId);
      return claimVerifiedStarterCredits(tx, {
        salonId: parsed.data.salonId,
        clerkUserId: user.id,
        ...identity,
      });
    });
    return Response.json({ data: result }, NO_STORE);
  } catch (error) {
    if (error instanceof InactiveSalonError) {
      return responseError(409, 'SALON_UNAVAILABLE', 'This free-text allowance cannot be claimed for this salon.');
    }
    // A claimed identity might belong to another salon. Never disclose which
    // identity or salon caused that conflict to an authenticated owner.
    if (error instanceof BusinessIdentityError) {
      return responseError(409, 'IDENTITY_CONFLICT', 'This free-text allowance cannot be claimed for this salon.');
    }
    return responseError(500, 'STARTER_CREDITS_ERROR', 'Free texts could not be claimed. Please try again.');
  }
}
