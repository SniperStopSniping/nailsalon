import { mintAppointmentManageLink } from '@/libs/appointmentManageLink';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';

export const dynamic = 'force-dynamic';

const MANAGEABLE_STATUSES = new Set(['pending', 'confirmed']);

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const access = await requireAppointmentManagerAccess(params.id, {
    assignedOnly: true,
    wrongRoleMessage: 'Only salon staff or admins can prepare appointment messages',
    assignmentForbiddenMessage: 'You can only message clients for your own appointments',
    tenantForbiddenMessage: 'Appointment does not belong to your salon',
    salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
  });
  if (!access.ok) {
    return access.response;
  }

  if (!MANAGEABLE_STATUSES.has(access.appointment.status)) {
    return Response.json(
      {
        error: {
          code: 'APPOINTMENT_NOT_MANAGEABLE',
          message: 'Only upcoming appointments can receive a management link.',
        },
      },
      { status: 409 },
    );
  }

  try {
    const manageUrl = await mintAppointmentManageLink(access.appointment);
    return Response.json({
      data: { manageUrl },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    console.error('[AppointmentManageLink] could not mint link', error);
    return Response.json(
      {
        error: {
          code: 'MANAGE_LINK_FAILED',
          message: 'The appointment link could not be prepared. Please try again.',
        },
      },
      { status: 500 },
    );
  }
}
