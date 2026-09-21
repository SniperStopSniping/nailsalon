import { z } from 'zod';

import { DEPOSIT_FINGERPRINT_NONE, MAX_DEPOSIT_CENTS_ABSURDITY, MIN_DEPOSIT_CENTS, parseDepositDisclosureFingerprint } from '@/libs/depositPolicy';

import type { CustomerBookingOperationReference, CustomerBookingStatus } from './bookingOperationContracts';
import type { NormalBookingPrepare } from './normalBookingContracts';
import { readNormalConfirmHandoff, writeNormalConfirmHandoff } from './normalConfirmHandoff.client';

const depositUpdateSchema = z.object({
  deposit: z.discriminatedUnion('required', [
    z.object({ required: z.literal(true), amountCents: z.number().int().min(MIN_DEPOSIT_CENTS).max(MAX_DEPOSIT_CENTS_ABSURDITY), currency: z.literal('CAD'), fingerprint: z.string() }),
    z.object({ required: z.literal(false), fingerprint: z.literal(DEPOSIT_FINGERPRINT_NONE) }),
  ]),
  confirmationMode: z.enum(['instant', 'request_approval']),
}).refine(value => !value.deposit.required || parseDepositDisclosureFingerprint(value.deposit.fingerprint) === value.deposit.amountCents);

export type NormalBookingDepositUpdate = z.infer<typeof depositUpdateSchema>;

export class NormalBookingRecoveryError extends Error {
  constructor(readonly reason: string, readonly depositUpdate?: NormalBookingDepositUpdate) {
    super(reason);
  }
}

function parseStored<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new NormalBookingRecoveryError('recovery_unavailable');
  }
}

const operationKey = (salonId: string, flowId: string) => `luster.normal-booking.operation.${salonId}.${flowId}`;
function readOperation(salonId: string, flowToken: string): CustomerBookingOperationReference | null {
  const raw = localStorage.getItem(operationKey(salonId, flowToken.split('.')[1]!));
  if (!raw) {
    return null;
  }
  const operation = parseStored<CustomerBookingOperationReference>(raw);
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
async function post<T>(salonId: string, action: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/public/customer-booking/${encodeURIComponent(salonId)}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 409 && data?.reason === 'deposit_changed') {
      const parsed = depositUpdateSchema.safeParse(data);
      if (parsed.success) {
        throw new NormalBookingRecoveryError('deposit_changed', parsed.data);
      }
      throw new NormalBookingRecoveryError('review_unavailable');
    }
    throw new NormalBookingRecoveryError(typeof data?.reason === 'string' ? data.reason : 'recovery_unavailable');
  }
  return data as T;
}

const pendingKey = (salonId: string, flowToken: string) => `${operationKey(salonId, flowToken.split('.')[1]!)}.confirming`;

async function reconcileOperation(salonId: string, flowToken: string, operation: CustomerBookingOperationReference, allowUnresolved = false): Promise<CustomerBookingStatus> {
  const pending = localStorage.getItem(pendingKey(salonId, flowToken)) !== null;
  let latest: CustomerBookingStatus | null = null;
  for (const delay of pending ? [0, 500, 1500, 3000] : [0]) {
    if (delay) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      latest = await post<CustomerBookingStatus>(salonId, 'status', { capability: operation.capability }, controller.signal);
      if (latest.status !== 'not_created' || latest.lastFailure) {
        localStorage.removeItem(pendingKey(salonId, flowToken));
        return latest;
      }
    } catch (error) {
      if (!pending) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  if (!latest || (pending && !allowUnresolved)) {
    throw new NormalBookingRecoveryError('recovery_unavailable');
  }
  return latest;
}

/** Read status before any preparation/create after reload or an ambiguous response. */
export async function recoverNormalBooking(salonId: string, allowUnresolved = false): Promise<CustomerBookingStatus | null> {
  let flow = readNormalConfirmHandoff(salonId);
  if (!flow) {
    const raw = localStorage.getItem(`luster.customer-booking.operation.${salonId}`);
    if (raw) {
      const legacy = parseStored<CustomerBookingOperationReference & { version: number; salonId: string }>(raw);
      if (legacy.version !== 1 || legacy.salonId !== salonId || typeof legacy.capability !== 'string') {
        throw new NormalBookingRecoveryError('recovery_unavailable');
      }
      const restored = await post<{ handoff: { flowToken: string; expiresAt: string }; status: CustomerBookingStatus }>(salonId, 'handoff', { capability: legacy.capability });
      saveOperation(salonId, restored.handoff.flowToken, restored.status.operation);
      writeNormalConfirmHandoff(salonId, restored.handoff);
      // Legacy records did not distinguish preparation from submission. Retain
      // identity and conservatively reconcile rather than inventing an outcome.
      if (restored.status.status === 'not_created' && !restored.status.lastFailure) {
        localStorage.setItem(pendingKey(salonId, restored.handoff.flowToken), '1');
      }
      localStorage.removeItem(`luster.customer-booking.operation.${salonId}`);
      flow = restored.handoff;
    }
  }
  if (!flow) {
    throw new NormalBookingRecoveryError('handoff_missing');
  }
  const operation = readOperation(salonId, flow.flowToken);
  const remainingLegacy = localStorage.getItem(`luster.customer-booking.operation.${salonId}`);
  if (remainingLegacy) {
    const legacy = parseStored<CustomerBookingOperationReference & { version: number; salonId: string }>(remainingLegacy);
    if (legacy.version !== 1 || legacy.salonId !== salonId || !operation || legacy.capability !== operation.capability) {
      throw new NormalBookingRecoveryError('recovery_unavailable');
    }
    // Both pointers refer to the same durable operation; keep the verified new one.
    localStorage.removeItem(`luster.customer-booking.operation.${salonId}`);
  }
  return operation ? reconcileOperation(salonId, flow.flowToken, operation, allowUnresolved) : null;
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
  const existing = await recoverNormalBooking(args.salonId, true);
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
  const marker = pendingKey(args.salonId, flow.flowToken);
  localStorage.setItem(marker, '1');
  if (localStorage.getItem(marker) !== '1') {
    throw new NormalBookingRecoveryError('storage_unavailable');
  }
  try {
    const status = await post<CustomerBookingStatus>(args.salonId, 'confirm', {
      ...prepared.operation,
      // expiry is presentation-only and is not part of the confirmation request.
      expiresAt: undefined,
      contact: { name: args.booking.clientName, email: args.booking.clientEmail, phone: args.booking.clientPhone },
      policyAccepted: args.booking.bookingPolicyAcknowledgment?.accepted ?? false,
    });
    saveOperation(args.salonId, flow.flowToken, status.operation);
    if (status.status !== 'not_created' || status.lastFailure) {
      localStorage.removeItem(marker);
    }
    return status;
  } catch {
    const status = await reconcileOperation(args.salonId, flow.flowToken, prepared.operation);
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
