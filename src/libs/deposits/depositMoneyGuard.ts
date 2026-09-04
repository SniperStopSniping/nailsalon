import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';

import type { AdminWithSalons } from '@/libs/adminAuth';
import { getAdminImpersonationForAdmin, requireAdmin } from '@/libs/adminAuth';
import type { AdminImpersonationSession } from '@/libs/adminImpersonation';
import { logAuditEvent } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { loadAppointmentForSalon } from '@/libs/routeAccessGuards';
import type { Appointment, AppointmentDeposit, Salon } from '@/models/Schema';
import { appointmentDepositSchema } from '@/models/Schema';

import { type DepositActor, resolveDepositActor } from './depositLifecycle';

type GuardFailure = { ok: false; response: Response };

export type DepositAdminAccess = {
  ok: true;
  admin: AdminWithSalons;
  salon: Salon;
  appointment: Appointment | null;
  impersonation: AdminImpersonationSession | null;
  actor: DepositActor;
};

export type DepositMoneyAccess = DepositAdminAccess & {
  deposit: AppointmentDeposit;
};

export type DepositCrossSalonReadAccess = {
  ok: true;
  crossSalon: true;
};

type RateLimitedRequest = {
  request: Request;
  /** A stable, route-specific bucket name. */
  rateLimitKey: string;
};

type SalonScopedReadArgs = RateLimitedRequest & {
  crossSalon?: false;
  salonSlug: string | null | undefined;
  appointmentId?: string;
};

type CrossSalonReadArgs = RateLimitedRequest & {
  crossSalon: true;
};

function typedError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

function applyBillingRateLimit(args: RateLimitedRequest): Response | null {
  const result = checkEndpointRateLimit(
    args.rateLimitKey,
    getClientIp(args.request),
    'BILLING',
  );
  return result.allowed ? null : rateLimitResponse(result.retryAfterMs);
}

/**
 * Reject the development-role cookie mechanism itself, before any D6 route
 * performs authentication, reads money state, or writes an audit row.
 *
 * Deliberately no NODE_ENV, Vitest, or skip-flag carve-out: the helper's two
 * conditions are the server dev-mode predicate and a non-null override cookie.
 */
export async function assertNoDevRoleBypass(): Promise<Response | null> {
  const { isDevModeServer, readDevRoleFromCookies } = await import('@/libs/devRole.server');
  if (isDevModeServer() && await readDevRoleFromCookies() !== null) {
    return typedError(
      403,
      'DEV_ROLE_BYPASS_FORBIDDEN',
      'Development role overrides cannot access deposit money routes.',
    );
  }
  return null;
}

async function requireSalonAdmin(args: SalonScopedReadArgs): Promise<DepositAdminAccess | GuardFailure> {
  const limited = applyBillingRateLimit(args);
  if (limited) {
    return { ok: false, response: limited };
  }

  const salonSlug = args.salonSlug?.trim();
  if (!salonSlug) {
    return {
      ok: false,
      response: typedError(404, 'SALON_NOT_FOUND', 'Salon not found.'),
    };
  }

  const salon = await getSalonBySlug(salonSlug);
  if (!salon) {
    return {
      ok: false,
      response: typedError(404, 'SALON_NOT_FOUND', 'Salon not found.'),
    };
  }

  const access = await requireAdmin(salon.id);
  if (!access.ok) {
    return access;
  }

  const impersonation = await getAdminImpersonationForAdmin(access.admin);
  if (access.admin.isSuperAdmin && !impersonation) {
    return {
      ok: false,
      response: typedError(
        403,
        'SUPER_ADMIN_MUST_IMPERSONATE',
        'Super administrators must impersonate this salon before accessing deposit records.',
      ),
    };
  }

  const appointment = args.appointmentId
    ? await loadAppointmentForSalon(args.appointmentId, salon.id)
    : null;
  if (args.appointmentId && !appointment) {
    return {
      ok: false,
      response: typedError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.'),
    };
  }

  const actor = resolveDepositActor({
    admin: access.admin,
    impersonation,
    salonId: salon.id,
  });

  return {
    ok: true,
    admin: access.admin,
    salon,
    appointment,
    impersonation,
    actor,
  };
}

/** Tenant-scoped authorization for the four owner money mutations. */
export async function requireDepositMoneyActor(args: RateLimitedRequest & {
  salonSlug: string | null | undefined;
  appointmentId: string;
}): Promise<DepositMoneyAccess | GuardFailure> {
  const access = await requireSalonAdmin(args);
  if (!access.ok) {
    return access;
  }

  const [deposit] = await db
    .select()
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.salonId, access.salon.id),
      eq(appointmentDepositSchema.appointmentId, args.appointmentId),
    ))
    .orderBy(
      sql`CASE
        WHEN ${appointmentDepositSchema.status} = 'paid' THEN 0
        WHEN ${appointmentDepositSchema.status} = 'checkout_created' THEN 1
        ELSE 2
      END`,
      desc(appointmentDepositSchema.createdAt),
      desc(appointmentDepositSchema.id),
    )
    .limit(1);

  if (!deposit) {
    return {
      ok: false,
      response: typedError(404, 'DEPOSIT_NOT_FOUND', 'Deposit not found.'),
    };
  }

  return { ...access, deposit };
}

export function requireDepositReadActor(
  args: CrossSalonReadArgs,
): Promise<DepositCrossSalonReadAccess | GuardFailure>;
export function requireDepositReadActor(
  args: SalonScopedReadArgs,
): Promise<DepositAdminAccess | GuardFailure>;
/**
 * Explicitly separates the two owner GETs from the cross-salon health GET.
 * Cross-salon mode performs only the BILLING rate limit; its route separately
 * invokes requireSuperAdmin, preserving a reachable unimpersonated caller.
 */
export async function requireDepositReadActor(
  args: CrossSalonReadArgs | SalonScopedReadArgs,
): Promise<DepositCrossSalonReadAccess | DepositAdminAccess | GuardFailure> {
  if (args.crossSalon === true) {
    const limited = applyBillingRateLimit(args);
    return limited
      ? { ok: false, response: limited }
      : { ok: true, crossSalon: true };
  }

  const access = await requireSalonAdmin(args);
  if (!access.ok) {
    return access;
  }

  if (access.impersonation) {
    void logAuditEvent({
      salonId: access.salon.id,
      actorType: 'super_admin',
      actorId: access.impersonation.adminUserId,
      action: 'deposit_records_viewed',
      entityType: args.appointmentId ? 'appointment' : 'salon',
      entityId: args.appointmentId ?? access.salon.id,
      metadata: {
        impersonated: true,
        superAdminUserId: access.impersonation.adminUserId,
        impersonatedSalonId: access.impersonation.salonId,
      },
      ip: getClientIp(args.request),
      userAgent: args.request.headers.get('user-agent'),
    });
  }

  return access;
}
