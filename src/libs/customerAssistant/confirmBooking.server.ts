import 'server-only';

import { createAppointmentFromRequest } from '@/libs/appointmentCreation.server';

import type { CustomerBookingStatus } from './bookingOperationContracts';
import { readCustomerBookingStatus } from './bookingStatus.server';
import type { CustomerContact } from './contact';
import { CustomerBookingOperationError, type CustomerBookingTransaction, readCustomerBookingOperation, recordCustomerBookingFailure } from './operationStore.server';

/** Explicit-action adapter. The model cannot select any creation arguments. */
export async function confirmCustomerBooking(args: {
  request: Request;
  salon: { id: string; slug: string };
  secret: string;
  capability: string;
  revision: number;
  fingerprint: string;
  contact: CustomerContact;
  policyAccepted: boolean;
  /** Trusted transport fence, executed inside the canonical booking transaction. */
  executionGuard?: (tx: CustomerBookingTransaction) => Promise<void>;
}): Promise<CustomerBookingStatus> {
  const identity = { salonId: args.salon.id, capability: args.capability, secret: args.secret };
  const prior = await readCustomerBookingOperation(identity);
  if (prior.appointmentId) {
    return readCustomerBookingStatus(prior, args.secret);
  }
  if (prior.revision !== args.revision || prior.requestHash !== args.fingerprint) {
    throw new CustomerBookingOperationError('revision_changed');
  }
  const material = prior.material;
  const policy = material.review.bookingPolicy;
  if (policy.required && !args.policyAccepted) {
    throw new CustomerBookingOperationError('review_changed');
  }
  // Forward only abuse-control headers. Ambient owner/staff sessions never
  // become authority, even when this browser also has an owner login.
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const name of ['origin', 'x-forwarded-for', 'x-real-ip', 'user-agent']) {
    const value = args.request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  const request = new Request(new URL('/api/appointments', args.request.url), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      salonSlug: args.salon.slug,
      baseServiceId: material.selection.baseServiceId,
      selectedAddOns: material.selection.selectedAddOns,
      technicianId: material.technicianId ?? null,
      ...(material.locationId ? { locationId: material.locationId } : {}),
      startTime: material.startTime,
      clientName: args.contact.name,
      clientEmail: args.contact.email,
      clientPhone: args.contact.phone,
      ...(material.manualConfirmationContext
        ? {
            notes: [
              ...(material.review.manualConfirmationItems?.length ? ['Manual confirmation required:', ...material.review.manualConfirmationItems.map(item => `- ${item.name}: price to be confirmed`)] : []),
              ...(material.manualConfirmationContext.removalRequired ? ['Removal required'] : []),
              `Current product: ${({ gel_x: 'Gel-X', builder_gel: 'BIAB / Builder Gel', acrylic: 'Acrylic', gel_polish: 'Gel polish', unknown: 'Unknown' } as const)[material.manualConfirmationContext.currentProduct]}`,
            ].join('\n').slice(0, 2000),
          }
        : {}),
      smsConsent: material.smsConsent,
      catalogAcknowledgment: material.catalogAcknowledgment,
      expectedTotalCents: material.expectedTotalCents,
      expectedDiscountType: material.expectedDiscountType,
      expectedBookingFinancialQuote: material.expectedBookingFinancialQuote,
      expectedDepositFingerprint: material.expectedDepositFingerprint,
      ...(policy.required ? { bookingPolicyAcknowledgment: { accepted: true, version: policy.version, attemptId: prior.id } } : {}),
    }),
  });
  let response: Response | undefined;
  let failure: unknown;
  try {
    response = await createAppointmentFromRequest(request, {
      kind: 'anonymous_customer',
      salon: args.salon,
      contact: args.contact,
      operation: { capability: args.capability, revision: args.revision, fingerprint: args.fingerprint, secret: args.secret },
      ...(args.executionGuard ? { executionGuard: args.executionGuard } : {}),
      ...(material.nextVisitOffer ? { nextVisitOffer: material.nextVisitOffer } : {}),
    });
  } catch (error) {
    failure = error;
  }
  // This read is mandatory after success, failure, or a lost checkout response.
  // If it cannot complete, the caller must retain this capability and recover.
  const current = await readCustomerBookingOperation(identity);
  if (current.appointmentId) {
    return readCustomerBookingStatus(current, args.secret);
  }
  if (failure) {
    throw failure;
  }
  if (response && (response.status === 400 || response.status === 409)) {
    const body = await response.json().catch(() => null) as { error?: { code?: string } | string } | null;
    const code = typeof body?.error === 'string' ? body.error : body?.error?.code;
    const reason = code && ['TIME_CONFLICT', 'OUTSIDE_SCHEDULE', 'PAST_TIME', 'NO_AVAILABLE_TECHNICIAN'].includes(code)
      ? 'slot_unavailable'
      : code && ['CATALOG_SELECTION_CHANGED', 'SMART_FIT_CHANGED', 'BOOKING_FINANCIAL_QUOTE_CHANGED', 'DEPOSIT_CHANGED', 'BOOKING_POLICY_CHANGED', 'CUSTOMER_BOOKING_REVIEW_CHANGED'].includes(code)
        ? 'review_changed'
        : code === 'EXISTING_APPOINTMENT'
          ? 'existing_appointment'
          : code === 'CONTACT_IDENTITY_CONFLICT' ? 'contact_conflict' : null;
    if (reason) {
      const rejected = await recordCustomerBookingFailure({ ...identity, revision: args.revision, failure: reason });
      return readCustomerBookingStatus(rejected, args.secret);
    }
  }
  // A provider or transient failure cannot be translated to a successful booking.
  throw new Error('CUSTOMER_BOOKING_CONFIRMATION_UNRESOLVED');
}
