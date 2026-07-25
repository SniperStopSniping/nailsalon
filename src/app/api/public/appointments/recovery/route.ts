import { z } from 'zod';

import { getActiveAppointmentsForCanonicalClient } from '@/libs/activeAppointments';
import { sendBookingRecoveryEmail } from '@/libs/bookingRecoveryEmail';
import { checkBookingRecoveryRateLimit } from '@/libs/bookingRecoveryRateLimit';
import { resolveCanonicalSalonClientIdentity } from '@/libs/clientLifecycleStabilization';
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
    const identity = await resolveCanonicalSalonClientIdentity({
      salonId: salon.id,
      email,
      phone: normalizedPhone,
      allowArchived: true,
    });
    if (!identity || identity.externalClientId !== null) {
      return genericResponse();
    }
    const appointments = await getActiveAppointmentsForCanonicalClient({
      salonId: salon.id,
      terminalClientId: identity.terminal.id,
      horizon: 'recovery',
      allowArchived: true,
    });
    if (!appointments.length) {
      return genericResponse();
    }

    const result = await sendBookingRecoveryEmail({
      salon: {
        id: salon.id,
        slug: salon.slug,
        name: salon.name,
        customDomain: salon.customDomain,
        settings: salon.settings,
      },
      appointments: appointments.map(appointment => ({
        id: appointment.id,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
      })),
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
