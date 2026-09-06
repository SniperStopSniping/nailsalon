/**
 * Owner-facing wording for entitlement reason codes.
 *
 * Split out of locked-feature-row.tsx so that file exports only its component
 * (the repo's buttonVariants.ts / badgeVariants.ts convention, and what
 * react-refresh wants).
 */

/**
 * Reason codes emitted by GET /api/admin/settings/modules. Callers may pass any
 * string: an unrecognised code falls back to neutral copy rather than rendering
 * an empty explanation.
 */
export type LockedFeatureReasonCode = 'UPGRADE_REQUIRED' | 'MODULE_DISABLED';

const REASON_COPY: Record<string, string> = {
  UPGRADE_REQUIRED: 'Not included in your plan yet',
  MODULE_DISABLED: 'Turned off for this salon',
};

export const LOCKED_FEATURE_FALLBACK_REASON = 'Not available for this salon yet';

/** Owner-facing sentence for a module reason code. Never returns an empty string. */
export function describeLockedFeatureReason(
  reasonCode?: string | null,
): string {
  if (!reasonCode) {
    return LOCKED_FEATURE_FALLBACK_REASON;
  }
  return REASON_COPY[reasonCode] ?? LOCKED_FEATURE_FALLBACK_REASON;
}
