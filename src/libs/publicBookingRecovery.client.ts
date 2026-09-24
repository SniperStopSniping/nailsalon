/** Browser-owned attempt identity; uncertainty never authorizes another create. */
export type PublicBookingAttempt = {
  version: 1 | 2;
  startedAt?: string;
  salonId: string;
  attemptId: string;
  recoveryKey: string;
  confirmationPath: string;
  state: 'pending' | 'resolved';
  response?: any;
};

const key = (salonId: string) => `luster.public-booking-attempt.v1.${salonId}`;
export function isPublicBookingReceipt(value: any): boolean {
  return typeof value?.data?.appointmentId === 'string'
    && value.data.appointmentId.length > 0
    && value.data.appointment?.id === value.data.appointmentId
    && typeof value.data.appointment.status === 'string';
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readPublicBookingAttempt(salonId: string): PublicBookingAttempt | null {
  const raw = sessionStorage.getItem(key(salonId));
  if (!raw) {
    return null;
  }
  const value = JSON.parse(raw) as PublicBookingAttempt;
  if (![1, 2].includes(value.version) || (value.version === 2 && (!value.startedAt || !Number.isFinite(Date.parse(value.startedAt)))) || value.salonId !== salonId || !uuid.test(value.attemptId)
    || !uuid.test(value.recoveryKey) || typeof value.confirmationPath !== 'string'
    || !value.confirmationPath.startsWith('/') || value.confirmationPath.startsWith('//')
    || value.confirmationPath.includes('\\') || [...value.confirmationPath].some(character => character.charCodeAt(0) <= 32)
    || !['pending', 'resolved'].includes(value.state)
    || (value.state === 'resolved' && !isPublicBookingReceipt(value.response))) {
    throw new Error('BOOKING_RECOVERY_STORAGE_INVALID');
  }
  return value;
}

function save(value: PublicBookingAttempt): void {
  sessionStorage.setItem(key(value.salonId), JSON.stringify(value));
  const saved = readPublicBookingAttempt(value.salonId);
  if (saved?.attemptId !== value.attemptId || saved.recoveryKey !== value.recoveryKey || saved.state !== value.state) {
    throw new Error('BOOKING_RECOVERY_STORAGE_UNAVAILABLE');
  }
}

export function beginPublicBookingAttempt(args: { salonId: string; attemptId: string; confirmationPath: string; protocolVersion?: 1 | 2 }): PublicBookingAttempt {
  const existing = readPublicBookingAttempt(args.salonId);
  if (existing?.state === 'pending') {
    throw new Error('BOOKING_RECOVERY_REQUIRED');
  }
  const { protocolVersion = 2, ...identity } = args;
  const value: PublicBookingAttempt = { ...identity, version: protocolVersion, ...(protocolVersion === 2 ? { startedAt: new Date().toISOString() } : {}), recoveryKey: crypto.randomUUID(), state: 'pending' };
  save(value);
  return value;
}

export function resolvePublicBookingAttempt(salonId: string, response: any): void {
  const existing = readPublicBookingAttempt(salonId);
  if (!existing || !isPublicBookingReceipt(response)) {
    throw new Error('BOOKING_RECOVERY_INVALID_RECEIPT');
  }
  save({ ...existing, state: 'resolved', response });
}

/** Only a definitive pre-commit failure may release the pending identity. */
export function clearPublicBookingAttempt(salonId: string): void {
  sessionStorage.removeItem(key(salonId));
}

/**
 * A new service selection supersedes a completed receipt, even if it later
 * reaches the exact same confirmation URL. Pending attempts still need recovery.
 */
export function clearResolvedPublicBookingAttempt(salonId: string): void {
  const attempt = readPublicBookingAttempt(salonId);
  if (attempt?.state === 'resolved') {
    clearPublicBookingAttempt(salonId);
  }
}

export async function recoverPublicBookingAttempt(salonId: string): Promise<any | null> {
  const attempt = readPublicBookingAttempt(salonId);
  if (!attempt) {
    return null;
  }
  if (attempt.state === 'resolved') {
    return attempt.response;
  }
  for (const delay of [0, 500, 1500, 3000]) {
    if (delay) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`/api/public/booking-attempt/${encodeURIComponent(salonId)}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attemptId: attempt.attemptId, recoveryKey: attempt.recoveryKey, ...(attempt.version === 2 ? { version: 2, startedAt: attempt.startedAt } : {}) }),
        cache: 'no-store',
        signal: controller.signal,
      });
      const result = response.ok ? await response.json() : null;
      if (result?.kind === 'resolved_failure') {
        // Only an authoritative server failure releases this exact capability.
        // A delayed response must never clear a newer attempt in the same tab.
        const current = readPublicBookingAttempt(salonId);
        if (current?.attemptId !== attempt.attemptId || current.recoveryKey !== attempt.recoveryKey) {
          return null;
        }
        clearPublicBookingAttempt(salonId);
        return { kind: 'resolved_failure' };
      }
      if (['resolved', 'resolved_success'].includes(result?.kind) && isPublicBookingReceipt(result.response)) {
        // Do not overwrite a newer attempt if another lifecycle resolved this one.
        const current = readPublicBookingAttempt(salonId);
        if (current?.attemptId !== attempt.attemptId || current.recoveryKey !== attempt.recoveryKey) {
          throw new Error('BOOKING_RECOVERY_CHANGED');
        }
        resolvePublicBookingAttempt(salonId, result.response);
        return result.response;
      }
    } catch {
      // An unavailable receipt is never proof that the booking failed.
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}
