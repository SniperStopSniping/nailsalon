import { z } from 'zod';

import { REVIEW_DELAY_MINUTES, reviewSettingsSchema } from '@/libs/reviewRequests';

export const REVIEW_AUTOMATION_MODES = [
  'manual',
  'marked_completed',
  'scheduled_end',
] as const;

export type ReviewAutomationMode = (typeof REVIEW_AUTOMATION_MODES)[number];
export type ReviewRepeatCooldownDays = 90 | 180 | 365 | 'never';
export type ReviewAutomationDelayMinutes = number;

export const REVIEW_REPEAT_COOLDOWN_OPTIONS = [90, 180, 365, 'never'] as const;
/** UI choices; existing salons may have another persisted delay. */
export const REVIEW_AUTOMATION_DELAY_MINUTES = REVIEW_DELAY_MINUTES;
export const MAX_REVIEW_AUTOMATION_DELAY_MINUTES = 10080;

/** Explicit policy writes coexist with the unchanged legacy boolean contract. */
export const reviewAutomationSettingsSchema = reviewSettingsSchema.omit({ automaticEnabled: true }).extend({
  automationMode: z.enum(REVIEW_AUTOMATION_MODES),
  delayMinutes: z.number().int().min(0).max(MAX_REVIEW_AUTOMATION_DELAY_MINUTES),
  repeatCooldownDays: z.union([z.literal(90), z.literal(180), z.literal(365), z.literal('never')]),
}).strict();

export const reviewSettingsUpdateSchema = z.union([reviewSettingsSchema, reviewAutomationSettingsSchema]);

export type ReviewAutomationPolicy = {
  mode: ReviewAutomationMode;
  delayMinutes: ReviewAutomationDelayMinutes;
  repeatCooldownDays: ReviewRepeatCooldownDays;
};

/** Recommended during new-salon setup; existing salons never receive it implicitly. */
export const NEW_SALON_REVIEW_AUTOMATION_POLICY: ReviewAutomationPolicy = {
  mode: 'scheduled_end',
  delayMinutes: 60,
  repeatCooldownDays: 90,
};

/** Existing automatic reviews are completion-triggered; their legacy repeat limit is forever. */
export const LEGACY_AUTOMATIC_REVIEW_AUTOMATION_POLICY: ReviewAutomationPolicy = {
  mode: 'marked_completed',
  delayMinutes: 60,
  repeatCooldownDays: 'never',
};

export const LEGACY_MANUAL_REVIEW_AUTOMATION_POLICY: ReviewAutomationPolicy = {
  mode: 'manual',
  delayMinutes: 60,
  repeatCooldownDays: 'never',
};

export type StoredReviewAutomationSettings = {
  automaticReviewRequests?: boolean | null;
  reviewRequestAutomationMode?: ReviewAutomationMode | null;
  reviewRequestDelayMinutes?: number | null;
  reviewRequestRepeatCooldownDays?: number | 'never' | null;
};

function isMode(value: unknown): value is ReviewAutomationMode {
  return typeof value === 'string' && REVIEW_AUTOMATION_MODES.includes(value as ReviewAutomationMode);
}

function isDelay(value: unknown): value is ReviewAutomationDelayMinutes {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= MAX_REVIEW_AUTOMATION_DELAY_MINUTES;
}

function isCooldown(value: unknown): value is ReviewRepeatCooldownDays {
  return REVIEW_REPEAT_COOLDOWN_OPTIONS.includes(value as ReviewRepeatCooldownDays);
}

/**
 * Normalizes persisted review settings without making a write decision.
 *
 * Absence is never enough evidence that a salon is new. Missing rows and
 * present legacy rows both preserve the old completion/manual behavior and
 * lifetime repeat limit. Setup must apply the new-salon recommendation
 * explicitly after the owner accepts it.
 */
export function resolveReviewAutomationPolicy(
  settings: StoredReviewAutomationSettings | null | undefined,
): ReviewAutomationPolicy {
  if (settings == null) {
    return LEGACY_MANUAL_REVIEW_AUTOMATION_POLICY;
  }

  const delayMinutes = isDelay(settings.reviewRequestDelayMinutes)
    ? settings.reviewRequestDelayMinutes
    : 60;
  const repeatCooldownDays = isCooldown(settings.reviewRequestRepeatCooldownDays)
    ? settings.reviewRequestRepeatCooldownDays
    : 'never';
  const configuredMode = isMode(settings.reviewRequestAutomationMode)
    ? settings.reviewRequestAutomationMode
    : settings.automaticReviewRequests === true
      ? 'marked_completed'
      : 'manual';

  return {
    mode: settings.automaticReviewRequests === false ? 'manual' : configuredMode,
    delayMinutes,
    repeatCooldownDays,
  };
}

/**
 * Compatibility adapter for the existing automatic boolean writer. Enabling
 * restores an explicitly stored trigger when one exists; disabling changes
 * only the active mode to manual. Reapplying either value is idempotent.
 */
export function applyLegacyAutomaticReviewUpdate(
  settings: StoredReviewAutomationSettings | null | undefined,
  automaticEnabled: boolean,
): ReviewAutomationPolicy {
  const current = resolveReviewAutomationPolicy(settings);
  if (!automaticEnabled) {
    return { ...current, mode: 'manual' };
  }
  if (isMode(settings?.reviewRequestAutomationMode)
    && settings.reviewRequestAutomationMode !== 'manual') {
    return { ...current, mode: settings.reviewRequestAutomationMode };
  }
  return {
    ...current,
    mode: current.mode === 'manual' ? 'marked_completed' : current.mode,
  };
}

export type ScheduledEndReviewAppointment = {
  status: string;
  createdAt: Date | null;
  startTime: Date;
  endTime: Date;
};

export type ScheduledEndReviewEligibilityInput = {
  appointment: ScheduledEndReviewAppointment;
  policy: ReviewAutomationPolicy;
  now: Date;
  automationEnabledAt: Date | null;
  reviewRequestsEligibleAfter?: Date | null;
};

export type ScheduledEndReviewEligibility = {
  /** Eligible to create one scheduled review request; not an instruction to send it yet. */
  eligible: boolean;
  triggerReached: boolean;
  /** The persisted intent may dispatch only when this is true. */
  sendDue: boolean;
  scheduledFor: Date | null;
  reason:
    | 'wrong_mode'
    | 'not_activated'
    | 'invalid_appointment_time'
    | 'future_created'
    | 'backdated_creation'
    | 'invalid_status'
    | 'before_activation'
    | 'invalid_unsuppression_boundary'
    | 'before_unsuppression'
    | 'waiting_for_end'
    | null;
};

function validDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * Decides only whether a scheduled-end trigger may be produced. When the end
 * is reached, callers may record a scheduled request even while `sendDue` is
 * false; the existing intent controls later delivery. Contact,
 * consent, suppression state itself, duplicate requests, payment and delivery
 * remain the dispatcher/domain layer's responsibility.
 */
export function evaluateScheduledEndReviewEligibility(
  input: ScheduledEndReviewEligibilityInput,
): ScheduledEndReviewEligibility {
  const { appointment, policy, now, automationEnabledAt, reviewRequestsEligibleAfter } = input;
  if (policy.mode !== 'scheduled_end') {
    return { eligible: false, triggerReached: false, sendDue: false, scheduledFor: null, reason: 'wrong_mode' };
  }
  if (!validDate(automationEnabledAt)) {
    return { eligible: false, triggerReached: false, sendDue: false, scheduledFor: null, reason: 'not_activated' };
  }
  if (!validDate(appointment.endTime) || !validDate(appointment.startTime)
    || appointment.startTime >= appointment.endTime || !validDate(appointment.createdAt) || !validDate(now)) {
    return { eligible: false, triggerReached: false, sendDue: false, scheduledFor: null, reason: 'invalid_appointment_time' };
  }
  if (appointment.createdAt > now) {
    return { eligible: false, triggerReached: false, sendDue: false, scheduledFor: null, reason: 'future_created' };
  }
  if (appointment.createdAt > appointment.endTime) {
    return { eligible: false, triggerReached: false, sendDue: false, scheduledFor: null, reason: 'backdated_creation' };
  }
  if (!['confirmed', 'in_progress', 'completed'].includes(appointment.status)) {
    return { eligible: false, triggerReached: false, sendDue: false, scheduledFor: null, reason: 'invalid_status' };
  }
  if (appointment.endTime <= automationEnabledAt) {
    return { eligible: false, triggerReached: false, sendDue: false, scheduledFor: null, reason: 'before_activation' };
  }
  if (reviewRequestsEligibleAfter != null && !validDate(reviewRequestsEligibleAfter)) {
    return { eligible: false, triggerReached: false, sendDue: false, scheduledFor: null, reason: 'invalid_unsuppression_boundary' };
  }
  if (validDate(reviewRequestsEligibleAfter) && appointment.endTime <= reviewRequestsEligibleAfter) {
    return { eligible: false, triggerReached: false, sendDue: false, scheduledFor: null, reason: 'before_unsuppression' };
  }
  const scheduledFor = new Date(appointment.endTime.getTime() + policy.delayMinutes * 60_000);
  if (now < appointment.endTime) {
    return { eligible: false, triggerReached: false, sendDue: false, scheduledFor, reason: 'waiting_for_end' };
  }
  return {
    eligible: true,
    triggerReached: true,
    sendDue: now >= scheduledFor,
    scheduledFor,
    reason: null,
  };
}
