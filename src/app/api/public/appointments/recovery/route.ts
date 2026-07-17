import { z } from 'zod';

import { getActiveAppointmentsForContact } from '@/libs/activeAppointments';
import { checkBookingRecoveryRateLimit } from '@/libs/bookingRecoveryRateLimit';
import { sendBookingRecoveryEmail } from '@/libs/bookingRecoveryEmail';
import { logger } from '@/libs/Logger';
import { isValidPhone, normalizePhone } from '@/libs/phone';
import { getSalonBySlug } from '@/libs/queries';
import { getClientIp } from '@/libs/rateLimit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  salonSlug: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(320).transform(value => value.toLowerCase()).optional(),
  phone: z.string().trim().max(32).optional(),
});

// The response is intentionally identical for every outcome (no match,
// rate-limited, provider failure, unknown salon) so this endpoint can never
// be used to enumerate which contacts hold appointments. The copy is honest:
// it promises an email only if a match is found, and only to the contact on
// file.
const genericResponse = () => Response.json({
  data: {
    accepted: true,
    message: 'If we find a matching appointment, we\'ll email its secure management link to the contact on file within a few minutes.',
  },
}, { status: 202 });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return genericResponse();
  }

  const email = parsed.data.email;
  const normalizedPhone = parsed.data.phone && isValidPhone(parsed.data.phone)
    ? normalizePhone(parsed.data.phone)
    : undefined;
  if (!email && !normalizedPhone) {
    return genericResponse();
  }

  const salon = await getSalonBySlug(parsed.data.salonSlug);
  if (!salon) {
    return genericResponse();
  }

  try {
    if (!await checkBookingRecoveryRateLimit(getClientIp(request), salon.id, email ?? normalizedPhone!)) {
      return genericResponse();
    }
  } catch {
    return Response.json({ error: { code: 'RECOVERY_TEMPORARILY_UNAVAILABLE', message: 'Booking recovery is temporarily unavailable. Please try again shortly.' } }, { status: 503 });
  }

  try {
    // Read-only with respect to appointments: recovery never creates,
    // modifies, or deletes appointment rows.
    const appointments = await getActiveAppointmentsForContact({
      salonId: salon.id,
      email,
      phone: normalizedPhone,
      horizon: 'recovery',
    });
    if (!appointments.length) {
      return genericResponse();
    }

    // Send only to the address stored on the appointment — never to an
    // entered address that merely phone-matched. (When matched by email the
    // two are equal by definition.)
    const recipientEmail = appointments.find(appointment => appointment.clientEmail)?.clientEmail;
    if (!recipientEmail) {
      logger.warn({ event: 'booking_recovery_no_email_on_file', salonId: salon.id, appointmentId: appointments[0]!.id });
      return genericResponse();
    }
    const recipientAppointments = appointments.filter(
      appointment => !appointment.clientEmail || appointment.clientEmail.toLowerCase() === recipientEmail.toLowerCase(),
    );

    const result = await sendBookingRecoveryEmail({
      salon: {
        id: salon.id,
        slug: salon.slug,
        name: salon.name,
        customDomain: salon.customDomain,
        settings: salon.settings,
      },
      appointments: recipientAppointments.map(appointment => ({
        id: appointment.id,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
      })),
      recipientEmail,
    });
    if (!result.ok) {
      logger.warn({
        event: 'booking_recovery_send_failed',
        salonId: salon.id,
        deliveryId: result.deliveryId,
        errorCode: result.errorCode,
      });
    }
  } catch (error) {
    // Only constant-style codes are logged — never raw error text, which
    // could embed contact details or query parameters.
    const code = error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : 'UNEXPECTED';
    logger.error({ event: 'booking_recovery_unexpected_error', salonId: salon.id, errorCode: code });
  }

  return genericResponse();
}
