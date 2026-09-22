import { z } from 'zod';

import { getActiveAppointmentsForCanonicalClient } from '@/libs/activeAppointments';
import { sendBookingRecoveryEmail } from '@/libs/bookingRecoveryEmail';
import { checkBookingRecoveryRateLimit } from '@/libs/bookingRecoveryRateLimit';
import { queueBookingRecoverySms } from '@/libs/bookingRecoverySms';
import {
  getZeroCandidateOrphanRecoveryAppointments,
  resolveCanonicalSalonClientIdentityOutcome,
} from '@/libs/clientLifecycleStabilization';
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
// be used to enumerate which contacts hold appointments. The copy never says
// which channel was used or whether a matching booking exists.
const genericResponse = () => Response.json({
  data: {
    accepted: true,
    message: 'If we find a matching appointment, we\'ll send its secure management link to the contact on file.',
  },
}, { status: 202 });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return genericResponse();
  }

  const email = parsed.data.email;
  if (parsed.data.phone && !isValidPhone(parsed.data.phone)) {
    return genericResponse();
  }
  const normalizedPhone = parsed.data.phone ? normalizePhone(parsed.data.phone) : undefined;
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
    const identityOutcome = await resolveCanonicalSalonClientIdentityOutcome({
      salonId: salon.id,
      email,
      phone: normalizedPhone,
      allowArchived: true,
    });
    if (identityOutcome.status === 'invalid_or_ambiguous_identity') {
      return genericResponse();
    }
    let recipientMode:
      | 'canonical_terminal'
      | 'zero_candidate_orphan';
    let appointments;
    if (identityOutcome.status === 'resolved_terminal') {
      if (identityOutcome.identity.externalClientId !== null) {
        return genericResponse();
      }
      recipientMode = 'canonical_terminal';
      appointments = await getActiveAppointmentsForCanonicalClient({
        salonId: salon.id,
        terminalClientId: identityOutcome.identity.terminal.id,
        horizon: 'recovery',
        allowArchived: true,
      });
    } else {
      recipientMode = 'zero_candidate_orphan';
      appointments = await getZeroCandidateOrphanRecoveryAppointments({
        salonId: salon.id,
        email,
        phone: normalizedPhone,
      });
    }
    if (!appointments.length) {
      return genericResponse();
    }

    // When both identifiers resolve to one terminal identity, email is the
    // explicit default. A phone-only lookup never falls back to email: it can
    // only queue a text to the terminal's stored phone.
    if (email) {
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
        recipientMode,
      });
      if (!result.ok) {
        logger.warn({
          event: 'booking_recovery_send_failed',
          salonId: salon.id,
          deliveryId: result.deliveryId,
          errorCode: result.errorCode,
        });
      }
    } else if (identityOutcome.status === 'resolved_terminal') {
      await queueBookingRecoverySms({
        salonId: salon.id,
        terminalClientId: identityOutcome.identity.terminal.id,
        appointments,
      });
    } else if (identityOutcome.status === 'zero_identity_candidates' && normalizedPhone) {
      // No salon client exists, so the exact matched appointment snapshot is
      // the only allowed destination. The dispatcher rechecks that snapshot
      // immediately before provider delivery.
      await queueBookingRecoverySms({
        salonId: salon.id,
        recipientPhone: normalizedPhone,
        appointments,
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
