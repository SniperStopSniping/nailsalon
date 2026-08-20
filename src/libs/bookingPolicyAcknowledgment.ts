import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import {
  DEFAULT_BOOKING_POLICY_TITLE,
  resolveBookingExperience,
} from '@/libs/bookingExperience';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

export const BOOKING_POLICY_ACKNOWLEDGMENT_SOURCE = 'public_booking' as const;

export const BOOKING_POLICY_ACKNOWLEDGMENT_REQUIRED_MESSAGE
  = 'Review and acknowledge the booking policy before confirming.';
export const BOOKING_POLICY_CHANGED_MESSAGE
  = 'The salon updated its booking policy. Please review it and confirm again.';
export const BOOKING_POLICY_ATTEMPT_REUSED_MESSAGE
  = 'This booking attempt changed. Please confirm the appointment again.';
export const BOOKING_POLICY_CHECK_RETRY_MESSAGE
  = 'The booking policy is being updated. Please wait a moment and try again.';

export type RequiredBookingPolicy = {
  enabled: true;
  title: string;
  text: string;
  showOnServicePage: boolean;
  showBeforeConfirmation: true;
  showAfterConfirmation: boolean;
  showInConfirmationEmail: boolean;
  acknowledgment: {
    required: true;
    text: string;
  };
  version: string;
};

export type CustomerBookingPolicyProjection = RequiredBookingPolicy;

/**
 * Resolve the only policy that can require a public-booking acknowledgment.
 * Every accepted content field comes from the defensive canonical resolver.
 *
 * UX-OD-02 (Stage 1): booking policy is UNIVERSAL owner-authored content, so
 * this no longer consults `booking_experience_customization`. Enforcement now
 * agrees with what the public page renders: previously a free-plan salon could
 * author and display an acknowledgment-requiring policy that the server then
 * declined to enforce. Every other condition below is unchanged — a salon that
 * has authored no policy, or has not enabled acknowledgment, still returns
 * `null` here and sees no new rejection.
 *
 * `storedPlan` and `features` remain on the input type: callers pass trusted
 * salon state and the signature is shared, but neither now affects the result.
 */
export function resolveRequiredBookingPolicy(input: {
  storedPlan: unknown;
  features: SalonFeatures | null | undefined;
  settings: SalonSettings | null | undefined;
}): RequiredBookingPolicy | null {
  const experience = resolveBookingExperience(
    input.settings,
    { includeAcknowledgmentConfiguration: true },
  );
  const { policy } = experience;
  if (
    !policy.enabled
    || !policy.showBeforeConfirmation
    || !policy.text
    || !policy.acknowledgment.required
    || !policy.acknowledgment.text
    || !policy.version
  ) {
    return null;
  }

  return {
    enabled: true,
    title: policy.title ?? DEFAULT_BOOKING_POLICY_TITLE,
    text: policy.text,
    showOnServicePage: policy.showOnServicePage,
    showBeforeConfirmation: true,
    showAfterConfirmation: policy.showAfterConfirmation,
    showInConfirmationEmail: policy.showInConfirmationEmail,
    acknowledgment: {
      required: true,
      text: policy.acknowledgment.text,
    },
    version: policy.version,
  };
}

/**
 * The route constructs this object in a fixed key order from normalized,
 * server-resolved booking inputs. Hashing is unconditional and independent of
 * Redis so the database attempt binding always has a full-strength authority.
 */
export function hashCanonicalBookingRequest(
  canonicalRequest: Readonly<Record<string, unknown>>,
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalRequest), 'utf8')
    .digest('hex');
}

export function hashSensitiveBookingValue(value: string | null): string | null {
  return value === null
    ? null
    : createHash('sha256').update(value, 'utf8').digest('hex');
}

export function buildPublicBookingPolicyAcknowledgmentSnapshot(input: {
  salonId: string;
  appointmentId: string;
  policy: RequiredBookingPolicy;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  attemptId: string;
  requestHash: string;
  appointmentUpdatedAt: Date;
  acknowledgedAt?: Date;
}) {
  return {
    id: `policy_ack_${randomUUID()}`,
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    policyVersion: input.policy.version,
    policyTitleSnapshot: input.policy.title,
    policyTextSnapshot: input.policy.text,
    acknowledgmentTextSnapshot: input.policy.acknowledgment.text,
    source: BOOKING_POLICY_ACKNOWLEDGMENT_SOURCE,
    scheduledStartAtSnapshot: input.scheduledStartAt,
    scheduledEndAtSnapshot: input.scheduledEndAt,
    attemptId: input.attemptId,
    requestHash: input.requestHash,
    appointmentUpdatedAtSnapshot: input.appointmentUpdatedAt,
    reservationRevisionSnapshot: null,
    acknowledgedAt: input.acknowledgedAt ?? new Date(),
  };
}
