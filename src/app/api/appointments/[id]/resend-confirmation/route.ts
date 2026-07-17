import { resendCustomerBookingConfirmationEmail } from '@/libs/customerBookingEmail';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const access = await requireAppointmentManagerAccess(params.id, {
    assignedOnly: true,
    wrongRoleMessage: 'Only salon staff or admins can resend confirmations',
    assignmentForbiddenMessage: 'You can only manage your own appointments',
    tenantForbiddenMessage: 'Appointment does not belong to your salon',
    salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
  });
  if (!access.ok) {
    return access.response;
  }
  if (!access.appointment.clientEmail) {
    return Response.json({ error: { code: 'EMAIL_UNAVAILABLE', message: 'This appointment has no client email address.' } }, { status: 400 });
  }
  try {
    const result = await resendCustomerBookingConfirmationEmail({
      salonId: access.appointment.salonId,
      appointmentId: access.appointment.id,
    });
    return Response.json({ data: { status: result.ok ? 'sent' : 'failed' } });
  } catch {
    return Response.json({ error: { code: 'EMAIL_QUEUED_FOR_RETRY', message: 'Email could not be delivered yet. Luster will retry automatically.' } }, { status: 502 });
  }
}
