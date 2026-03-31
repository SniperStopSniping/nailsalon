import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import type { AdminWithSalons } from '@/libs/adminAuth';
import { requireActiveAdminSalon, requireAdmin } from '@/libs/adminAuth';
import { normalizeClientPhone } from '@/libs/clientApiGuards';
import type { ClientSessionPrincipal } from '@/libs/clientAuth';
import { getClientSession } from '@/libs/clientAuth';
import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import type { StaffSession } from '@/libs/staffAuth';
import { requireStaffSession } from '@/libs/staffAuth';
import {
  appointmentSchema,
  type Appointment,
  type Salon,
} from '@/models/Schema';

type GuardFailure = { ok: false; response: Response };

type StaffActor = {
  actorRole: 'staff';
  session: StaffSession;
};

type AdminActor = {
  actorRole: 'admin';
  admin: AdminWithSalons;
};

type ClientActor = {
  actorRole: 'client';
  clientSession: ClientSessionPrincipal;
};

type SalonAccessSuccess = {
  ok: true;
  salon: Salon;
} & (StaffActor | AdminActor);

type AppointmentAccessSuccess = {
  ok: true;
  appointment: Appointment;
} & (StaffActor | AdminActor | ClientActor);

type AppointmentAccessOptions = {
  allowClient?: boolean;
  assignedOnly?: boolean;
  authenticationRequiredMessage?: string;
  wrongRoleMessage?: string;
  tenantForbiddenMessage?: string;
  assignmentForbiddenMessage?: string;
  clientForbiddenMessage?: string;
};

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json(
    {
      error: {
        code,
        message,
      },
    },
    { status },
  );
}

async function loadAppointmentForSalon(
  appointmentId: string,
  salonId: string,
): Promise<Appointment | null> {
  const [appointment] = await db
    .select()
    .from(appointmentSchema)
    .where(
      and(
        eq(appointmentSchema.id, appointmentId),
        eq(appointmentSchema.salonId, salonId),
      ),
    )
    .limit(1);

  return appointment ?? null;
}

function getClientPhoneVariants(phone: string): string[] {
  const normalizedPhone = normalizeClientPhone(phone);
  const rawDigits = phone.replace(/\D/g, '');

  return Array.from(
    new Set(
      [
        phone,
        rawDigits,
        normalizedPhone,
        rawDigits ? `+${rawDigits}` : null,
        normalizedPhone ? `+1${normalizedPhone}` : null,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

async function loadAppointmentForClient(
  appointmentId: string,
  phoneVariants: string[],
): Promise<Appointment | null> {
  const [appointment] = await db
    .select()
    .from(appointmentSchema)
    .where(
      and(
        eq(appointmentSchema.id, appointmentId),
        inArray(appointmentSchema.clientPhone, phoneVariants),
      ),
    )
    .limit(1);

  return appointment ?? null;
}

function clientOwnsAppointment(
  appointment: Appointment,
  clientSession: ClientSessionPrincipal,
): boolean {
  return normalizeClientPhone(appointment.clientPhone) === normalizeClientPhone(clientSession.phone);
}

export async function requireStaffOrAdminSalonAccess(
  salonSlug: string,
): Promise<SalonAccessSuccess | GuardFailure> {
  const salon = await getSalonBySlug(salonSlug);
  if (!salon) {
    return {
      ok: false,
      response: errorResponse(404, 'SALON_NOT_FOUND', 'Salon not found'),
    };
  }

  let authFailure: Response | null = null;
  let forbidden: Response | null = null;

  const staffAuth = await requireStaffSession();
  if (staffAuth.ok) {
    if (staffAuth.session.salonId !== salon.id) {
      return {
        ok: false,
        response: errorResponse(
          403,
          'FORBIDDEN',
          'You do not have access to this salon',
        ),
      };
    }

    return {
      ok: true,
      salon,
      actorRole: 'staff',
      session: staffAuth.session,
    };
  }

  if (staffAuth.response.status !== 401) {
    authFailure = staffAuth.response;
  }

  const adminGuard = await requireAdmin(salon.id);
  if (adminGuard.ok) {
    return {
      ok: true,
      salon,
      actorRole: 'admin',
      admin: adminGuard.admin,
    };
  }

  if (adminGuard.response.status === 403) {
    forbidden = adminGuard.response;
  } else if (adminGuard.response.status !== 401) {
    authFailure = adminGuard.response;
  }

  if (await getClientSession()) {
    forbidden ??= errorResponse(
      403,
      'FORBIDDEN',
      'Only salon staff or admins can access this resource',
    );
  }

  return {
    ok: false,
    response:
      forbidden
      ?? authFailure
      ?? errorResponse(401, 'UNAUTHORIZED', 'Authentication required'),
  };
}

export async function requireAppointmentManagerAccess(
  appointmentId: string,
  options: Omit<AppointmentAccessOptions, 'allowClient' | 'clientForbiddenMessage'> = {},
): Promise<AppointmentAccessSuccess | GuardFailure> {
  return requireAppointmentAccessInternal(appointmentId, {
    ...options,
    allowClient: false,
  });
}

export async function requireAppointmentAccess(
  appointmentId: string,
  options: Omit<AppointmentAccessOptions, 'allowClient'> = {},
): Promise<AppointmentAccessSuccess | GuardFailure> {
  return requireAppointmentAccessInternal(appointmentId, {
    ...options,
    allowClient: true,
  });
}

async function requireAppointmentAccessInternal(
  appointmentId: string,
  options: AppointmentAccessOptions,
): Promise<AppointmentAccessSuccess | GuardFailure> {
  let authFailure: Response | null = null;
  let forbidden: Response | null = null;

  const staffAuth = await requireStaffSession();
  if (staffAuth.ok) {
    const appointment = await loadAppointmentForSalon(
      appointmentId,
      staffAuth.session.salonId,
    );

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

    if (
      options.assignedOnly
      && appointment.technicianId !== staffAuth.session.technicianId
    ) {
      return {
        ok: false,
        response: errorResponse(
          403,
          'FORBIDDEN',
          options.assignmentForbiddenMessage
            ?? 'You can only manage your own appointments',
        ),
      };
    }

    return {
      ok: true,
      appointment,
      actorRole: 'staff',
      session: staffAuth.session,
    };
  }

  if (staffAuth.response.status !== 401) {
    authFailure = staffAuth.response;
  }

  const activeAdminContext = await requireActiveAdminSalon();
  if (activeAdminContext.salon && activeAdminContext.admin && !activeAdminContext.error) {
    const appointment = await loadAppointmentForSalon(
      appointmentId,
      activeAdminContext.salon.id,
    );

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
      actorRole: 'admin',
      admin: activeAdminContext.admin,
    };
  }

  if (activeAdminContext.error?.status === 403) {
    forbidden = activeAdminContext.error;
  } else if (activeAdminContext.error && activeAdminContext.error.status !== 401) {
    authFailure = activeAdminContext.error;
  }

  const clientSession = await getClientSession();
  if (clientSession) {
    const appointment = await loadAppointmentForClient(
      appointmentId,
      getClientPhoneVariants(clientSession.phone),
    );

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

    if (options.allowClient && clientOwnsAppointment(appointment, clientSession)) {
      return {
        ok: true,
        appointment,
        actorRole: 'client',
        clientSession,
      };
    }

    forbidden ??= errorResponse(
      403,
      'FORBIDDEN',
      options.allowClient
        ? options.clientForbiddenMessage ?? 'You can only access your own appointments'
        : options.wrongRoleMessage ?? 'Only salon staff or admins can access this appointment',
    );
  }

  return {
    ok: false,
    response:
      forbidden
      ?? authFailure
      ?? errorResponse(
        401,
        'UNAUTHORIZED',
        options.authenticationRequiredMessage ?? 'Authentication required',
      ),
  };
}
