import { z } from 'zod';

import {
  AppointmentManageError,
  getAppointmentManageDetail,
  runAppointmentManageMutation,
} from '@/libs/appointmentManage';
import { db } from '@/libs/DB';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import { salonSchema } from '@/models/Schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

const patchSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('move'),
    startTime: z.string().datetime(),
    technicianId: z.string().nullable().optional(),
  }).strict(),
  z.object({
    operation: z.literal('moveToNextAvailable'),
  }).strict(),
  z.object({
    operation: z.literal('changeService'),
    baseServiceId: z.string().min(1),
    startTime: z.string().datetime().optional(),
    technicianId: z.string().nullable().optional(),
  }).strict(),
  z.object({
    operation: z.literal('reassignTechnician'),
    technicianId: z.string().min(1),
  }).strict(),
]);

async function getSalonSlug(salonId: string) {
  const [salon] = await db
    .select({ slug: salonSchema.slug })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  return salon?.slug ?? '';
}

function toErrorResponse(error: unknown): Response {
  if (error instanceof AppointmentManageError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      } satisfies ErrorResponse,
      { status: error.status },
    );
  }

  console.error('[AppointmentManage] unexpected error', error);
  return Response.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred while managing the appointment.',
      },
    } satisfies ErrorResponse,
    { status: 500 },
  );
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const access = await requireAppointmentManagerAccess(params.id, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can manage this appointment',
      assignmentForbiddenMessage: 'You can only manage your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
    });
    if (!access.ok) {
      return access.response;
    }

    const salonSlug = await getSalonSlug(access.appointment.salonId);
    const detail = await getAppointmentManageDetail({
      appointmentId: access.appointment.id,
      salonId: access.appointment.salonId,
      canReassignTechnician: access.actorRole === 'admin',
      salonSlug,
    });

    return Response.json({
      data: detail,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const access = await requireAppointmentManagerAccess(params.id, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can manage this appointment',
      assignmentForbiddenMessage: 'You can only manage your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
    });
    if (!access.ok) {
      return access.response;
    }

    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid appointment manage payload.',
            details: parsed.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const canReassignTechnician = access.actorRole === 'admin';
    if (parsed.data.operation === 'reassignTechnician' && !canReassignTechnician) {
      return Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Only salon owners or admins can reassign technicians.',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

    const result = await runAppointmentManageMutation({
      appointmentId: params.id,
      salonId: access.appointment.salonId,
      operation: parsed.data.operation,
      startTime: 'startTime' in parsed.data && parsed.data.startTime
        ? new Date(parsed.data.startTime)
        : undefined,
      baseServiceId: 'baseServiceId' in parsed.data ? parsed.data.baseServiceId : undefined,
      technicianId: 'technicianId' in parsed.data ? parsed.data.technicianId : undefined,
      canReassignTechnician,
    });

    return Response.json({
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
