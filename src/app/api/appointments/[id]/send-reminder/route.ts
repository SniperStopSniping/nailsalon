import { z } from 'zod';

import { mintAppointmentManageLink } from '@/libs/appointmentManageLink';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import {
  getAppointmentServiceNames,
  getSalonById,
  getTechnicianById,
} from '@/libs/queries';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import { sendSmartAppointmentReminder } from '@/libs/SMS';
import type { SalonSettings } from '@/types/salonPolicy';

export const dynamic = 'force-dynamic';

const MANAGEABLE_STATUSES = new Set(['pending', 'confirmed']);
const requestSchema = z.object({
  force: z.boolean().optional().default(false),
});

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  manualFallback?: {
    phone: string;
    body: string;
  };
};

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const access = await requireAppointmentManagerAccess(params.id, {
    assignedOnly: true,
    wrongRoleMessage: 'Only salon staff or admins can send appointment reminders',
    assignmentForbiddenMessage: 'You can only message clients for your own appointments',
    tenantForbiddenMessage: 'Appointment does not belong to your salon',
    salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
  });
  if (!access.ok) {
    return access.response;
  }

  const parsedBody = await parseRequestBody(request);
  if (!parsedBody.success) {
    return Response.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid reminder request',
          details: parsedBody.error.flatten(),
        },
      } satisfies ErrorResponse,
      { status: 400 },
    );
  }

  const appointment = access.appointment;
  const now = new Date();
  if (
    !MANAGEABLE_STATUSES.has(appointment.status)
    || appointment.deletedAt
    || appointment.startTime.getTime() <= now.getTime()
  ) {
    return Response.json(
      {
        error: {
          code: 'APPOINTMENT_NOT_UPCOMING',
          message: 'Reminders can only be sent for upcoming appointments.',
        },
      } satisfies ErrorResponse,
      { status: 409 },
    );
  }

  try {
    const [salon, services, technician] = await Promise.all([
      getSalonById(appointment.salonId),
      getAppointmentServiceNames(appointment.id),
      appointment.technicianId
        ? getTechnicianById(appointment.technicianId, appointment.salonId)
        : Promise.resolve(null),
    ]);

    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: 'The salon for this appointment could not be found.',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    let manageUrl: string;
    try {
      manageUrl = await mintAppointmentManageLink(appointment);
    } catch (error) {
      console.error('[AppointmentReminder] could not mint management link', error);
      return Response.json(
        {
          error: {
            code: 'MANAGE_LINK_FAILED',
            message: 'The secure appointment link could not be prepared. Please try again.',
          },
        } satisfies ErrorResponse,
        { status: 500 },
      );
    }

    const bookingConfig = resolveBookingConfigFromSettings(
      (salon.settings as SalonSettings | null | undefined) ?? null,
    );
    const result = await sendSmartAppointmentReminder(appointment.salonId, {
      phone: appointment.clientPhone,
      clientName: appointment.clientName ?? undefined,
      appointmentId: appointment.id,
      salonName: salon.name,
      startTime: appointment.startTime.toISOString(),
      hoursUntil: Math.max(
        1,
        Math.ceil((appointment.startTime.getTime() - now.getTime()) / 3600000),
      ),
      services,
      technicianName: technician?.name ?? null,
      timeZone: bookingConfig.timezone,
      manageUrl,
      force: parsedBody.data.force,
      now,
    });

    if (result.outcome === 'manual') {
      return Response.json({
        data: {
          mode: 'manual' as const,
          sent: false,
          reason: result.reason,
          phone: result.phone,
          body: result.body,
        },
      });
    }

    if (result.outcome === 'provider_failure') {
      return Response.json(
        {
          error: {
            code: 'SMS_DELIVERY_FAILED',
            message: 'Twilio could not confirm delivery. Prepare a manual text only if the client did not receive it.',
            details: result.errorCode ? { providerCode: result.errorCode } : undefined,
          },
          manualFallback: {
            phone: result.phone,
            body: result.body,
          },
        } satisfies ErrorResponse,
        { status: 502 },
      );
    }

    return Response.json({
      data: {
        mode: 'automatic' as const,
        sent: true,
        ...(result.outcome === 'duplicate'
          ? { reason: 'DUPLICATE_SUPPRESSED' }
          : {}),
        sentAt: result.sentAt,
      },
    });
  } catch (error) {
    console.error('[AppointmentReminder] failed to prepare reminder', error);
    return Response.json(
      {
        error: {
          code: 'REMINDER_FAILED',
          message: 'The appointment reminder could not be prepared. Please try again.',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

async function parseRequestBody(request: Request) {
  const rawBody = await request.text();
  if (!rawBody.trim()) {
    return requestSchema.safeParse({});
  }

  try {
    return requestSchema.safeParse(JSON.parse(rawBody));
  } catch {
    return requestSchema.safeParse(null);
  }
}
