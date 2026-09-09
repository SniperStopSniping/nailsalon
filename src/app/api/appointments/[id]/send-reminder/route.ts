import { z } from 'zod';

import { mintAppointmentManageLink } from '@/libs/appointmentManageLink';
import {
  resolveOperationalSalonClientContact,
  resolveOperationalSalonClientContactByPhone,
} from '@/libs/clientLifecycleStabilization';
import { queueAppointmentReminder } from '@/libs/communicationMaterialization';
import { getSalonById } from '@/libs/queries';
import { isReminderEligibleAppointment } from '@/libs/reminderEligibility';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';

export const dynamic = 'force-dynamic';

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

export async function POST(request: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
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

  const requestId = request.headers.get('Idempotency-Key')?.trim();
  if ((parsedBody.data.force && !requestId) || (requestId !== undefined && (requestId.length === 0 || requestId.length > 128))) {
    return Response.json({
      error: {
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'The reminder request could not be prepared. Reload the appointment and try again.',
      },
    } satisfies ErrorResponse, { status: 400 });
  }

  const appointment = access.appointment;
  const now = new Date();
  if (
    !isReminderEligibleAppointment(appointment)
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
    const [salon, operationalClient] = await Promise.all([
      getSalonById(appointment.salonId),
      appointment.salonClientId
        ? resolveOperationalSalonClientContact({
          salonId: appointment.salonId,
          clientId: appointment.salonClientId,
          allowArchived: true,
        })
        : resolveOperationalSalonClientContactByPhone({
          salonId: appointment.salonId,
          phone: appointment.clientPhone,
          allowArchived: true,
        }),
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

    const result = await queueAppointmentReminder({
      salonId: appointment.salonId,
      appointmentId: appointment.id,
      phone: operationalClient?.phone ?? appointment.clientPhone,
      ...(operationalClient?.id ? { clientId: operationalClient.id } : {}),
      manageUrl,
      requestId,
      now,
    });
    return Response.json({
      data: {
        mode: 'automatic' as const,
        sent: result.status === 'sent',
        queued: ['pending', 'claimed', 'sending', 'blocked_no_credit'].includes(result.status),
        status: result.status,
        intentId: result.intentId,
        scheduledFor: result.scheduledFor,
        ...(!result.created ? { reason: 'DUPLICATE_SUPPRESSED' } : {}),
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const knownErrors: Record<string, string> = {
      INVALID_CLIENT_PHONE: 'Add a valid mobile number to this client before sending.',
      APPOINTMENT_NOT_UPCOMING: 'Reminders can only be sent for accepted upcoming appointments.',
      SMS_DISABLED: 'Enable SMS in Communications settings before sending a reminder.',
      QUIET_HOURS_STALE: 'Quiet hours leave no useful sending window before this appointment.',
    };
    if (knownErrors[code]) {
      return Response.json({ error: { code, message: knownErrors[code] } }, { status: 409 });
    }
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
