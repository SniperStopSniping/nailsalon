import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { logAppointmentChange } from '@/libs/appointmentAudit';
import {
  AppointmentManageError,
  getAppointmentManageDetail,
  runAppointmentManageMutation,
} from '@/libs/appointmentManage';
import { db } from '@/libs/DB';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import { type AppointmentAuditAction, type AuditPerformerRole, salonSchema } from '@/models/Schema';

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
    durationMinutes: z.number().int().min(15).max(480).optional(),
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

type AuditActor = {
  performedBy: string;
  performedByRole: AuditPerformerRole;
  performedByName: string | null;
};

/**
 * The acting owner/staff member for the audit row. Mirrors
 * `resolveCheckoutActor`, which cannot be imported here: it is a
 * `server-only` module and this route's siblings are exercised from the
 * jsdom test environment. Returns null only if the guard ever yields an
 * identity-less actor, in which case the mutation still succeeds and the
 * audit row is skipped rather than the write being failed.
 */
function resolveAuditActor(access: {
  actorRole: string;
  admin?: { id: string; name?: string | null } | null;
  session?: { technicianId: string; technicianName?: string | null } | null;
}): AuditActor | null {
  if (access.actorRole === 'staff' && access.session?.technicianId) {
    return {
      performedBy: `staff:${access.session.technicianId}`,
      performedByRole: 'staff',
      performedByName: access.session.technicianName ?? null,
    };
  }
  if (access.actorRole === 'admin' && access.admin?.id) {
    return {
      performedBy: access.admin.id,
      performedByRole: 'admin',
      performedByName: access.admin.name ?? null,
    };
  }
  return null;
}

const MANAGE_AUDIT_ACTIONS: Record<
  z.infer<typeof patchSchema>['operation'],
  AppointmentAuditAction
> = {
  move: 'time_changed',
  moveToNextAvailable: 'time_changed',
  changeService: 'items_changed',
  reassignTechnician: 'tech_reassigned',
};

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

export async function GET(request: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  try {
    const access = await requireAppointmentManagerAccess(params.id, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can manage this appointment',
      assignmentForbiddenMessage: 'You can only manage your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
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

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  try {
    const access = await requireAppointmentManagerAccess(params.id, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can manage this appointment',
      assignmentForbiddenMessage: 'You can only manage your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
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
      durationMinutes: 'durationMinutes' in parsed.data ? parsed.data.durationMinutes : undefined,
      baseServiceId: 'baseServiceId' in parsed.data ? parsed.data.baseServiceId : undefined,
      technicianId: 'technicianId' in parsed.data ? parsed.data.technicianId : undefined,
      canReassignTechnician,
      notifyCustomerOnReschedule: true,
    });

    // "Who moved this client, from when, and why" was unanswerable: this
    // route wrote no appointment_audit_log row at all, while every other
    // appointment mutation does. The row is written after the mutation
    // committed, with the acting owner/staff member as performer.
    // logAppointmentChange never throws, so a failed audit write cannot undo
    // a successful move.
    const previous = access.appointment;
    const actor = resolveAuditActor(access);
    if (actor) {
      await logAppointmentChange({
        appointmentId: params.id,
        salonId: previous.salonId,
        action: MANAGE_AUDIT_ACTIONS[parsed.data.operation],
        performedBy: actor.performedBy,
        performedByRole: actor.performedByRole,
        performedByName: actor.performedByName ?? undefined,
        previousValue: {
          startTime: previous.startTime?.toISOString() ?? null,
          endTime: previous.endTime?.toISOString() ?? null,
          technicianId: previous.technicianId ?? null,
        },
        newValue: {
          operation: parsed.data.operation,
          startTime: result.detail.appointment.startTime ?? null,
          endTime: result.detail.appointment.endTime ?? null,
          technicianId: result.detail.appointment.technicianId ?? null,
          baseServiceId: result.detail.appointment.baseServiceId ?? null,
        },
      });
    }

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
