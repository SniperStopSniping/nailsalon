import { bookingPolicyUpdateSchema, resolveBookingExperience } from '@/libs/bookingExperience';

import type { SetupDocument } from './contracts';

/** Strip derived versions; only the existing policy validator may normalize input. */
export function setupPolicyInput(policy?: SetupDocument['bookingPolicy']) {
  const source = policy ?? resolveBookingExperience(null, { includeAcknowledgmentConfiguration: true }).policy;
  return bookingPolicyUpdateSchema.shape.policy.parse({ enabled: source.enabled, title: source.title, text: source.text, showOnServicePage: source.showOnServicePage, showBeforeConfirmation: source.showBeforeConfirmation, showAfterConfirmation: source.showAfterConfirmation, showInConfirmationEmail: source.showInConfirmationEmail, acknowledgment: source.acknowledgment ? { required: source.acknowledgment.required, text: source.acknowledgment.text } : { required: false, text: null } });
}

export function resolveSetupPolicy(values: ReturnType<typeof setupPolicyInput>, current?: SetupDocument['bookingPolicy']) {
  const policy = bookingPolicyUpdateSchema.shape.policy.parse({ ...values, acknowledgment: values.acknowledgment ?? setupPolicyInput(current).acknowledgment });
  return resolveBookingExperience({ bookingExperience: { policy } }, { includeAcknowledgmentConfiguration: true }).policy;
}

/** Old customer projections omitted acceptance details; omission is not a request to weaken them. */
export function hydrateSetupPolicy(saved: SetupDocument['bookingPolicy'], current: SetupDocument['bookingPolicy']) {
  if (!saved) {
    return current;
  }
  if (saved.acknowledgment) {
    return saved;
  }
  const acknowledgment = setupPolicyInput(current).acknowledgment;
  return resolveSetupPolicy(setupPolicyInput({ ...saved, acknowledgment: acknowledgment ? { ...acknowledgment, required: saved.enabled && acknowledgment.required } : undefined }), current);
}
