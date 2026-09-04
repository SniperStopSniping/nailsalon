import { resolveEffectiveRequestApprovalStatus } from '@/libs/requestApprovalStatus';
import { requireAppointmentAccess } from '@/libs/routeAccessGuards';

/**
 * Luster L1 PR5 — D. Read-only EFFECTIVE request-approval status.
 *
 * A `pending` row whose `request_expires_at` has already passed is, in
 * every way that matters, no longer an open request — `appointmentBlocking
 * .ts` already stops it from occupying the slot in real time, well before
 * `approvalRequestSweeper.ts` gets around to finalizing the row into
 * `cancelled`. Any caller that read the raw `status` column directly during
 * that gap would see an ordinary `'pending'` row and could wrongly present
 * it as still awaiting the salon's decision.
 *
 * This endpoint exists to close that gap: it computes the EFFECTIVE state
 * through the exact same cutoff `appointmentBlocking.ts` uses
 * (`isPendingRequestBlocking` — strict `>`, at/after the deadline the
 * request has lapsed), so `'expired'` is reported identically whether the
 * sweep has run yet or not. It reuses `requireAppointmentAccess` — the same
 * authorization the mutation endpoints (`PATCH /api/appointments/[id]`,
 * `PATCH /api/appointments/[id]/cancel`) already enforce for staff, admin,
 * and the owning client — and returns only a small, purpose-built summary,
 * never the full appointment record, so this is not a new way to read
 * someone else's booking.
 */

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

export async function GET(request: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  try {
    const appointmentId = params.id;
    const access = await requireAppointmentAccess(appointmentId, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff, admins, or the client can view this appointment',
      assignmentForbiddenMessage: 'You can only view your own appointments',
      clientForbiddenMessage: 'You can only view your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
    });
    if (!access.ok) {
      return access.response;
    }

    const appointment = access.appointment;
    const now = new Date();

    return Response.json({
      data: {
        appointmentId: appointment.id,
        status: resolveEffectiveRequestApprovalStatus(appointment, now),
        isRequestApproval: appointment.confirmationModeSnapshot === 'request_approval',
        requestExpiresAt: appointment.requestExpiresAt
          ? appointment.requestExpiresAt.toISOString()
          : null,
      },
    });
  } catch (error) {
    console.error('Error resolving appointment request status:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to resolve appointment request status',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
