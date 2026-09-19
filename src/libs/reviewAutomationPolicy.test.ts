import { describe, expect, it } from 'vitest';

import {
  applyLegacyAutomaticReviewUpdate,
  evaluateScheduledEndReviewEligibility,
  LEGACY_AUTOMATIC_REVIEW_AUTOMATION_POLICY,
  LEGACY_MANUAL_REVIEW_AUTOMATION_POLICY,
  NEW_SALON_REVIEW_AUTOMATION_POLICY,
  resolveReviewAutomationPolicy,
} from './reviewAutomationPolicy';

const now = new Date('2030-09-12T20:30:00.000Z');
const enabledAt = new Date('2030-09-01T00:00:00.000Z');
const scheduledEndPolicy = { ...NEW_SALON_REVIEW_AUTOMATION_POLICY };

describe('resolveReviewAutomationPolicy', () => {
  it('does not infer a new salon from an absent settings row', () => {
    expect(resolveReviewAutomationPolicy(null)).toEqual(LEGACY_MANUAL_REVIEW_AUTOMATION_POLICY);
    expect(resolveReviewAutomationPolicy(undefined)).toEqual(LEGACY_MANUAL_REVIEW_AUTOMATION_POLICY);
    expect(NEW_SALON_REVIEW_AUTOMATION_POLICY).toEqual({
      mode: 'scheduled_end',
      delayMinutes: 60,
      repeatCooldownDays: 90,
    });
  });

  it('preserves present legacy settings as completed automation or manual-only with a lifetime cooldown', () => {
    expect(resolveReviewAutomationPolicy({ automaticReviewRequests: true, reviewRequestDelayMinutes: 120 }))
      .toEqual({ ...LEGACY_AUTOMATIC_REVIEW_AUTOMATION_POLICY, delayMinutes: 120 });
    expect(resolveReviewAutomationPolicy({ automaticReviewRequests: false }))
      .toEqual(LEGACY_MANUAL_REVIEW_AUTOMATION_POLICY);
    expect(resolveReviewAutomationPolicy({})).toEqual(LEGACY_MANUAL_REVIEW_AUTOMATION_POLICY);
  });

  it('honours an explicit new policy and preserves every valid persisted delay', () => {
    expect(resolveReviewAutomationPolicy({
      automaticReviewRequests: true,
      reviewRequestAutomationMode: 'scheduled_end',
      reviewRequestDelayMinutes: 60,
      reviewRequestRepeatCooldownDays: 90,
    })).toEqual(NEW_SALON_REVIEW_AUTOMATION_POLICY);

    for (const delayMinutes of [17, 180, 10_080]) {
      expect(resolveReviewAutomationPolicy({
        automaticReviewRequests: true,
        reviewRequestAutomationMode: 'scheduled_end',
        reviewRequestDelayMinutes: delayMinutes,
        reviewRequestRepeatCooldownDays: 30,
      })).toEqual({
        ...NEW_SALON_REVIEW_AUTOMATION_POLICY,
        delayMinutes,
        repeatCooldownDays: 'never',
      });
    }
  });

  it('falls back only for an invalid persisted delay', () => {
    for (const reviewRequestDelayMinutes of [-1, 1.5, 10_081]) {
      expect(resolveReviewAutomationPolicy({
        automaticReviewRequests: true,
        reviewRequestAutomationMode: 'scheduled_end',
        reviewRequestDelayMinutes,
      })).toEqual({
        ...NEW_SALON_REVIEW_AUTOMATION_POLICY,
        repeatCooldownDays: 'never',
      });
    }
  });
});

describe('applyLegacyAutomaticReviewUpdate', () => {
  it('keeps an explicitly configured scheduled-end trigger when a legacy boolean is enabled', () => {
    const configured = {
      automaticReviewRequests: false,
      reviewRequestAutomationMode: 'scheduled_end' as const,
      reviewRequestDelayMinutes: 30,
      reviewRequestRepeatCooldownDays: 90 as const,
    };

    expect(applyLegacyAutomaticReviewUpdate(configured, true)).toEqual({
      mode: 'scheduled_end',
      delayMinutes: 30,
      repeatCooldownDays: 90,
    });
  });

  it('is idempotent and maps a legacy enable without a trigger to completed automation', () => {
    const legacy = { automaticReviewRequests: true, reviewRequestDelayMinutes: 60 };
    const enabled = applyLegacyAutomaticReviewUpdate(legacy, true);

    expect(applyLegacyAutomaticReviewUpdate({ ...legacy, reviewRequestAutomationMode: enabled.mode }, true))
      .toEqual(enabled);
    expect(applyLegacyAutomaticReviewUpdate(legacy, false)).toEqual({
      ...enabled,
      mode: 'manual',
    });
    expect(applyLegacyAutomaticReviewUpdate({ ...legacy, automaticReviewRequests: false }, false))
      .toEqual({ ...enabled, mode: 'manual' });
    expect(applyLegacyAutomaticReviewUpdate(null, true))
      .toEqual(LEGACY_AUTOMATIC_REVIEW_AUTOMATION_POLICY);
  });
});

describe('evaluateScheduledEndReviewEligibility', () => {
  function evaluate(overrides: Partial<Parameters<typeof evaluateScheduledEndReviewEligibility>[0]> = {}) {
    return evaluateScheduledEndReviewEligibility({
      appointment: {
        status: 'confirmed',
        createdAt: new Date('2030-09-12T17:00:00.000Z'),
        endTime: new Date('2030-09-12T19:00:00.000Z'),
      },
      policy: scheduledEndPolicy,
      now,
      automationEnabledAt: enabledAt,
      ...overrides,
    });
  }

  it('allows confirmed, in-progress, and completed appointments to record a request at scheduled end', () => {
    for (const status of ['confirmed', 'in_progress', 'completed']) {
      expect(evaluate({ appointment: { status, createdAt: new Date('2030-09-12T17:00:00.000Z'), endTime: new Date('2030-09-12T19:00:00.000Z') } }))
        .toEqual({
          eligible: true,
          triggerReached: true,
          sendDue: true,
          scheduledFor: new Date('2030-09-12T20:00:00.000Z'),
          reason: null,
        });
    }
  });

  it('separates reaching the trigger from becoming due to send at exact boundaries', () => {
    expect(evaluate({ now: new Date('2030-09-12T18:59:59.999Z') })).toEqual({
      eligible: false,
      triggerReached: false,
      sendDue: false,
      scheduledFor: new Date('2030-09-12T20:00:00.000Z'),
      reason: 'waiting_for_end',
    });
    expect(evaluate({ now: new Date('2030-09-12T19:00:00.000Z') })).toEqual({
      eligible: true,
      triggerReached: true,
      sendDue: false,
      scheduledFor: new Date('2030-09-12T20:00:00.000Z'),
      reason: null,
    });
    expect(evaluate({ now: new Date('2030-09-12T20:00:00.000Z') })).toEqual({
      eligible: true,
      triggerReached: true,
      sendDue: true,
      scheduledFor: new Date('2030-09-12T20:00:00.000Z'),
      reason: null,
    });
    expect(evaluate({ policy: { ...scheduledEndPolicy, mode: 'marked_completed' } }))
      .toEqual({
        eligible: false,
        triggerReached: false,
        sendDue: false,
        scheduledFor: null,
        reason: 'wrong_mode',
      });
  });

  it('fails closed for invalid status, future/backdated creation, and activation boundaries', () => {
    expect(evaluate({ appointment: { status: 'no_show', createdAt: new Date('2030-09-12T17:00:00.000Z'), endTime: new Date('2030-09-12T19:00:00.000Z') } }).reason)
      .toBe('invalid_status');
    expect(evaluate({ appointment: { status: 'confirmed', createdAt: new Date('2030-09-12T21:00:00.000Z'), endTime: new Date('2030-09-12T19:00:00.000Z') } }).reason)
      .toBe('future_created');
    expect(evaluate({ now: new Date('2030-09-13T00:00:00.000Z'), appointment: { status: 'confirmed', createdAt: new Date('2030-09-12T20:00:00.000Z'), endTime: new Date('2030-09-12T19:00:00.000Z') } }).reason)
      .toBe('backdated_creation');
    expect(evaluate({ automationEnabledAt: new Date('2030-09-12T19:00:00.000Z') }).reason)
      .toBe('before_activation');
    expect(evaluate({ reviewRequestsEligibleAfter: new Date('2030-09-12T19:00:00.000Z') }).reason)
      .toBe('before_unsuppression');
    expect(evaluate({ reviewRequestsEligibleAfter: new Date('invalid') }).reason)
      .toBe('invalid_unsuppression_boundary');
  });

  it('excludes cancelled, no-show, and pending appointments without deciding contact or delivery eligibility', () => {
    for (const status of ['cancelled', 'no_show', 'pending']) {
      expect(evaluate({ appointment: { status, createdAt: new Date('2030-09-12T17:00:00.000Z'), endTime: new Date('2030-09-12T19:00:00.000Z') } }).reason)
        .toBe('invalid_status');
    }
  });
});
