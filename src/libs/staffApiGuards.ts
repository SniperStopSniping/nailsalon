import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  appointmentSchema,
  technicianScheduleOverrideSchema,
  type Appointment,
  type TechnicianScheduleOverride,
} from '@/models/Schema';

import { requireStaffSession, type StaffSession } from './staffAuth';

type GuardFailure = { ok: false; response: Response };

type StaffSessionGuard = { ok: true; session: StaffSession } | GuardFailure;

type StaffAppointmentGuard = {
  ok: true;
  appointment: Appointment;
  session: StaffSession;
} | GuardFailure;

type StaffOverrideGuard = {
  ok: true;
  override: TechnicianScheduleOverride;
  session: StaffSession;
} | GuardFailure;

type StaffAppointmentAccessOptions = {
  allowDeleted?: boolean;
  assignedOnly?: boolean;
  assignmentForbiddenMessage?: string;
  tenantForbiddenMessage?: string;
};

type StaffOverrideAccessOptions = {
  ownOnly?: boolean;
  ownershipForbiddenMessage?: string;
  tenantForbiddenMessage?: string;
};

function errorResponse(
  status: number,
  code: string,
  message: string,
  reason?: string,
): Response {
  return Response.json(
    {
      error: {
        code,
        message,
        ...(reason ? { reason } : {}),
      },
    },
    { status },
  );
}

export async function requireStaffApiSession(): Promise<StaffSessionGuard> {
  const auth = await requireStaffSession();
  if (!auth.ok) {
    return auth;
  }

  return { ok: true, session: auth.session };
}

export async function requireStaffAppointmentAccess(
  appointmentId: string,
  options: StaffAppointmentAccessOptions = {},
): Promise<StaffAppointmentGuard> {
  const auth = await requireStaffApiSession();
  if (!auth.ok) {
    return auth;
  }

  const [appointment] = await db
    .select()
    .from(appointmentSchema)
    .where(
      and(
        eq(appointmentSchema.id, appointmentId),
        eq(appointmentSchema.salonId, auth.session.salonId),
        ...(options.assignedOnly
          ? [eq(appointmentSchema.technicianId, auth.session.technicianId)]
          : []),
        ...(!options.allowDeleted
          ? [isNull(appointmentSchema.deletedAt)]
          : []),
      ),
    )
    .limit(1);

  if (!appointment) {
    return {
      ok: false,
      response: errorResponse(
        404,
        'APPOINTMENT_NOT_FOUND',
        `Appointment with ID "${appointmentId}" not found`,
      ),
    };
  }

  return {
    ok: true,
    appointment,
    session: auth.session,
  };
}

export async function requireStaffOverrideAccess(
  overrideId: string,
  options: StaffOverrideAccessOptions = {},
): Promise<StaffOverrideGuard> {
  const auth = await requireStaffApiSession();
  if (!auth.ok) {
    return auth;
  }

  const [override] = await db
    .select()
    .from(technicianScheduleOverrideSchema)
    .where(eq(technicianScheduleOverrideSchema.id, overrideId))
    .limit(1);

  if (!override) {
    return {
      ok: false,
      response: errorResponse(404, 'NOT_FOUND', 'Schedule override not found'),
    };
  }

  if (override.salonId !== auth.session.salonId) {
    return {
      ok: false,
      response: errorResponse(
        403,
        'FORBIDDEN',
        options.tenantForbiddenMessage
          ?? 'You do not have access to this schedule override',
      ),
    };
  }

  if (options.ownOnly && override.technicianId !== auth.session.technicianId) {
    return {
      ok: false,
      response: errorResponse(
        403,
        'FORBIDDEN',
        options.ownershipForbiddenMessage
          ?? 'You can only manage your own schedule overrides',
      ),
    };
  }

  return {
    ok: true,
    override,
    session: auth.session,
  };
}
