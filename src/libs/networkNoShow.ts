import type { SalonSettings } from '@/types/salonPolicy';

/** Owner-facing policy. Warning visibility is automatic for every salon when the platform feature is active. */
export type NoShowProtection = 'warn_only' | 'deposit_1' | 'deposit_2';

export type NetworkNoShowRisk =
  | { state: 'inactive' }
  | { state: 'unavailable' }
  | { state: 'available'; activeNoShowCount: number; windowMonths: 12 };

/**
 * Deliberately permissive at the boundary: old and malformed settings fall
 * back to warning-only, never silently create a deposit obligation.
 */
export function readNoShowProtection(settings: SalonSettings | null | undefined): NoShowProtection {
  const value = (settings as (SalonSettings & {
    payments?: { deposit?: { noShowProtection?: unknown } };
  }) | null | undefined)?.payments?.deposit?.noShowProtection;
  return value === 'deposit_1' || value === 'deposit_2' ? value : 'warn_only';
}

export function shouldRequireNoShowDeposit(
  protection: NoShowProtection,
  signal: NetworkNoShowRisk,
): boolean {
  if (signal.state !== 'available') {
    return false;
  }
  const threshold = protection === 'deposit_1' ? 1 : protection === 'deposit_2' ? 2 : null;
  return threshold !== null && signal.activeNoShowCount >= threshold;
}
