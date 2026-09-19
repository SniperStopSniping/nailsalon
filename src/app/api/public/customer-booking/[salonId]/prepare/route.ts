import { isDeepStrictEqual } from 'node:util';

import { getCustomerBookingRecoverySecret } from '@/libs/customerAssistant/access.server';
import { readCustomerBookingStatus } from '@/libs/customerAssistant/bookingStatus.server';
import { normalizeCustomerContact } from '@/libs/customerAssistant/contact';
import { CUSTOMER_NO_STORE, isCustomerSameOrigin, readCustomerJson } from '@/libs/customerAssistant/http.server';
import { normalBookingPrepareSchema } from '@/libs/customerAssistant/normalBookingContracts';
import { verifyNormalConfirmHandoff } from '@/libs/customerAssistant/normalConfirmHandoff.server';
import { CustomerBookingOperationError, customerBookingOperationReference, prepareCustomerBookingOperation } from '@/libs/customerAssistant/operationStore.server';
import { prepareCustomerBookingQuote } from '@/libs/customerAssistant/prepareQuote.server';
import { checkPublicBookingRateLimit, getPublicBookingClientIp } from '@/libs/publicBookingRateLimit.server';
import { getSalonById } from '@/libs/queries';
import { guardSalonApiRoute, isOnlineBookingEnabled } from '@/libs/salonStatus';
import type { SalonFeatures } from '@/types/salonPolicy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;
const fail = (reason: string, status = 409) => Response.json({ reason }, { status, headers: CUSTOMER_NO_STORE });

export async function POST(request: Request, context: { params: Promise<{ salonId: string }> }): Promise<Response> {
  if (!isCustomerSameOrigin(request)) {
    return fail('origin', 403);
  }
  const parsed = normalBookingPrepareSchema.safeParse(await readCustomerJson(request));
  if (!parsed.success) {
    return fail('invalid_details', 400);
  }
  const { salonId } = await context.params;
  const secret = getCustomerBookingRecoverySecret();
  if (!secret) {
    return fail('unavailable', 503);
  }
  const { booking, flowToken, expectedRevision, displayed } = parsed.data;
  const contact = normalizeCustomerContact({ name: booking.clientName, email: booking.clientEmail, phone: booking.clientPhone });
  if (!contact) {
    return fail('invalid_details', 400);
  }
  let flow;
  try {
    flow = verifyNormalConfirmHandoff({ salonId, flowToken, secret });
  } catch {
    return fail('handoff_expired');
  }
  if (booking.campaignToken || booking.manageToken || booking.originalAppointmentId) {
    return fail('unsupported_booking_mode');
  }
  const limit = await checkPublicBookingRateLimit({ salonId, clientIp: getPublicBookingClientIp(request), normalizedPhone: contact.phone });
  if (!limit.allowed || limit.reason === 'unavailable') {
    return fail('temporarily_unavailable', limit.allowed ? 503 : 429);
  }
  const salon = await getSalonById(salonId);
  if (!salon || salon.slug !== booking.salonSlug || salon.publicationStatus !== 'published' || await guardSalonApiRoute(salonId) || !await isOnlineBookingEnabled(salonId)) {
    return fail('unavailable', 404);
  }
  try {
    const material = await prepareCustomerBookingQuote({
      salon,
      features: salon.features as SalonFeatures | null,
      selection: { baseServiceId: booking.baseServiceId, selectedAddOns: booking.selectedAddOns },
      preference: { date: booking.appointmentDate, earliest: '00:00', latest: '23:59' },
      startTime: booking.startTime,
      technicianId: booking.technicianId ?? undefined,
      locationId: booking.locationId,
      contact,
      smsConsent: booking.smsConsent,
    });
    if (!material) {
      return fail('slot_unavailable');
    }
    // The click may confirm only the terms already rendered by the normal page.
    const review = material.review;
    const shownTechnician = review.technician.kind === 'specific' ? { id: review.technician.id, name: review.technician.name } : null;
    if (review.salon.name !== displayed.salonName || review.timeZone !== displayed.timeZone || review.time.padStart(5, '0') !== booking.appointmentTime
      || review.financial.currency.toUpperCase() !== displayed.currency.toUpperCase()
      || review.confirmationMode !== displayed.confirmationMode || review.reminders.mode !== displayed.reminderMode
      || (review.bookingPolicy.required ? review.bookingPolicy.version : null) !== displayed.policyVersion
      || !isDeepStrictEqual(shownTechnician, displayed.technician) || !isDeepStrictEqual(review.location, displayed.location)
      || !isDeepStrictEqual(review.services, displayed.services) || !isDeepStrictEqual(review.addOns, displayed.addOns)
      || material.review.financial.totalDueCents !== displayed.totalCents || material.review.durationMinutes !== displayed.durationMinutes
      || material.expectedDepositFingerprint !== booking.expectedDepositFingerprint
      || !isDeepStrictEqual(material.catalogAcknowledgment ?? null, booking.catalogAcknowledgment ?? null)
      || (booking.expectedBookingFinancialQuote && !isDeepStrictEqual(material.expectedBookingFinancialQuote, booking.expectedBookingFinancialQuote))
      || (booking.expectedTotalCents !== undefined && material.expectedTotalCents !== booking.expectedTotalCents)
      || (booking.expectedDiscountType !== undefined && material.expectedDiscountType !== booking.expectedDiscountType)
      || (material.review.bookingPolicy.required && material.review.bookingPolicy.version !== booking.bookingPolicyAcknowledgment?.version)) {
      return fail('review_changed');
    }
    const operation = await prepareCustomerBookingOperation({ salonId, sessionId: flow.flowId, secret, contact, material, expectedRevision });
    if (operation.appointmentId) {
      return Response.json({ status: await readCustomerBookingStatus(operation, secret) }, { headers: CUSTOMER_NO_STORE });
    }
    return Response.json({ review: operation.material.review, operation: customerBookingOperationReference(operation, secret) }, { headers: CUSTOMER_NO_STORE });
  } catch (error) {
    // A lost prepare response must expose the SAME operation before any further create.
    if (error instanceof CustomerBookingOperationError && error.code === 'revision_changed' && error.operation
      && error.operation.salonId === salonId && error.operation.sessionId === flow.flowId) {
      return Response.json({ status: await readCustomerBookingStatus(error.operation, secret) }, { headers: CUSTOMER_NO_STORE });
    }
    return fail(error instanceof CustomerBookingOperationError ? error.code : 'review_unavailable', error instanceof CustomerBookingOperationError ? 409 : 503);
  }
}
