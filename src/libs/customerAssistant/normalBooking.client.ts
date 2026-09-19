import type { CustomerBookingOperationReference, CustomerBookingStatus } from './bookingOperationContracts';
import type { NormalBookingPrepare } from './normalBookingContracts';
import { readNormalConfirmHandoff } from './normalConfirmHandoff.client';

export class NormalBookingRecoveryError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

const operationKey = (salonId: string, flowId: string) => `luster.normal-booking.operation.${salonId}.${flowId}`;
function readOperation(salonId: string, flowToken: string): CustomerBookingOperationReference | null {
  const raw = localStorage.getItem(operationKey(salonId, flowToken.split('.')[1]!));
  if (!raw) {
    return null;
  }
  const operation = JSON.parse(raw) as CustomerBookingOperationReference;
  if (typeof operation.capability !== 'string' || !Number.isInteger(operation.revision) || typeof operation.fingerprint !== 'string') {
    throw new NormalBookingRecoveryError('recovery_unavailable');
  }
  return operation;
}
function saveOperation(salonId: string, flowToken: string, operation: CustomerBookingOperationReference): void {
  localStorage.setItem(operationKey(salonId, flowToken.split('.')[1]!), JSON.stringify(operation));
  if (readOperation(salonId, flowToken)?.capability !== operation.capability) {
    throw new NormalBookingRecoveryError('storage_unavailable');
  }
}
/** Adopts a server-verified legacy operation into its reused normal-flow id. */
export function adoptNormalBookingOperation(salonId: string, flowToken: string, operation: CustomerBookingOperationReference): void {
  saveOperation(salonId, flowToken, operation);
}
async function post<T>(salonId: string, action: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/public/customer-booking/${encodeURIComponent(salonId)}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new NormalBookingRecoveryError(typeof data?.reason === 'string' ? data.reason : 'recovery_unavailable');
  }
  return data as T;
}

/** Read status before any preparation/create after reload or an ambiguous response. */
export async function recoverNormalBooking(salonId: string): Promise<CustomerBookingStatus | null> {
  const flow = readNormalConfirmHandoff(salonId);
  if (!flow) {
    throw new NormalBookingRecoveryError('handoff_missing');
  }
  const operation = readOperation(salonId, flow.flowToken);
  return operation ? post<CustomerBookingStatus>(salonId, 'status', { capability: operation.capability }) : null;
}

/** Invoked only by the existing normal Confirm button. No model is involved. */
export async function confirmNormalHandoffBooking(args: {
  salonId: string;
  booking: NormalBookingPrepare['booking'];
  displayed: NormalBookingPrepare['displayed'];
}): Promise<CustomerBookingStatus> {
  const flow = readNormalConfirmHandoff(args.salonId);
  if (!flow) {
    throw new NormalBookingRecoveryError('handoff_missing');
  }
  const existing = await recoverNormalBooking(args.salonId);
  if (existing && existing.status !== 'not_created') {
    return existing;
  }
  if (Date.parse(flow.expiresAt) <= Date.now()) {
    throw new NormalBookingRecoveryError('handoff_expired');
  }
  const prepared = await post<{ operation: CustomerBookingOperationReference } | { status: CustomerBookingStatus }>(args.salonId, 'prepare', {
    flowToken: flow.flowToken,
    expectedRevision: existing?.operation.revision ?? 0,
    booking: args.booking,
    displayed: args.displayed,
  });
  if ('status' in prepared) {
    saveOperation(args.salonId, flow.flowToken, prepared.status.operation);
    return prepared.status;
  }
  // Losing this storage write must block the create; otherwise refresh could duplicate it.
  saveOperation(args.salonId, flow.flowToken, prepared.operation);
  try {
    const status = await post<CustomerBookingStatus>(args.salonId, 'confirm', {
      ...prepared.operation,
      // expiry is presentation-only and is not part of the confirmation request.
      expiresAt: undefined,
      contact: { name: args.booking.clientName, email: args.booking.clientEmail, phone: args.booking.clientPhone },
      policyAccepted: args.booking.bookingPolicyAcknowledgment?.accepted ?? false,
    });
    saveOperation(args.salonId, flow.flowToken, status.operation);
    return status;
  } catch {
    const status = await post<CustomerBookingStatus>(args.salonId, 'status', { capability: prepared.operation.capability });
    saveOperation(args.salonId, flow.flowToken, status.operation);
    return status;
  }
}

export const normalBookingErrorMessage = (reason: string): string => ({
  handoff_missing: 'Your booking handoff could not be recovered. Reopen Help me choose before trying again.',
  handoff_expired: 'This service handoff has expired. Your selections are still here. Reopen Help me choose to review them again.',
  review_changed: 'The booking details have changed. Review the refreshed details before confirming again.',
  slot_unavailable: 'That time is no longer available. Choose another time; your services are still selected.',
  unsupported_booking_mode: 'This booking link needs the salon’s help. Your selections are saved; no new booking was created.',
  invalid_details: 'Check your contact details and selections before confirming.',
  storage_unavailable: 'Your browser could not save booking recovery information. Please allow site storage before confirming.',
}[reason] ?? 'We could not verify this booking yet. Please try again here so we can check the original booking safely.');
