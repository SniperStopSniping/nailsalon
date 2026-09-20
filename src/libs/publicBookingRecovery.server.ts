import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

const recoveryKeySchema = z.string().uuid();

const cachedBookingResponseSchema = z.object({
  data: z.object({
    appointmentId: z.string().min(1),
    appointment: z.object({
      id: z.string().min(1),
      status: z.string().min(1),
    }).passthrough(),
  }).passthrough(),
  meta: z.object({
    timestamp: z.string().min(1),
  }).passthrough(),
}).passthrough().refine(
  response => response.data.appointmentId === response.data.appointment.id,
  { message: 'Cached booking receipt does not identify one appointment.' },
);

const cachedBookingReceiptSchema = z.object({
  statusCode: z.literal(201),
  recoveryKeyHash: z.string().regex(/^[a-f0-9]{64}$/),
  responseBody: cachedBookingResponseSchema,
}).passthrough();

export const publicBookingRecoveryRequestSchema = z.object({
  attemptId: z.string().uuid(),
  recoveryKey: recoveryKeySchema,
}).strict();

/** The intentionally narrow successful booking receipt returned by recovery. */
export type PublicBookingRecoveryResponse = z.infer<typeof cachedBookingResponseSchema>;

/**
 * Stores a one-way proof alongside an existing idempotency receipt. The recovery
 * secret is never written to Redis, returned by this module, or logged.
 */
export function hashPublicBookingRecoveryKey(recoveryKey: string): string {
  return createHash('sha256').update(recoveryKey, 'utf8').digest('hex');
}

/**
 * The header is optional so older clients retain the existing booking path.
 * Invalid values deliberately behave as absent; they do not affect creation.
 */
export function getPublicBookingRecoveryKeyHash(request: Request): string | null {
  const parsed = recoveryKeySchema.safeParse(request.headers.get('X-Booking-Recovery-Key'));
  return parsed.success ? hashPublicBookingRecoveryKey(parsed.data) : null;
}

function hasMatchingRecoveryProof(storedHash: string, recoveryKey: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(storedHash)) {
    return false;
  }
  const suppliedHash = hashPublicBookingRecoveryKey(recoveryKey);
  return timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(suppliedHash, 'hex'));
}

/**
 * Resolves only a complete successful receipt. Missing, expired, malformed, or
 * unproven cache values intentionally remain ambiguous to the caller.
 */
export function readPublicBookingRecoveryReceipt(
  serializedReceipt: string | null,
  recoveryKey: string,
): PublicBookingRecoveryResponse | null {
  if (!serializedReceipt) {
    return null;
  }

  try {
    const receipt = cachedBookingReceiptSchema.safeParse(JSON.parse(serializedReceipt));
    if (!receipt.success || !hasMatchingRecoveryProof(receipt.data.recoveryKeyHash, recoveryKey)) {
      return null;
    }
    return receipt.data.responseBody;
  } catch {
    return null;
  }
}
