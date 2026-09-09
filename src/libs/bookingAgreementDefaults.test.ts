import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_BOOKING_POLICY_ACKNOWLEDGMENT_TEXT, DEFAULT_BOOKING_POLICY_TEXT, resolveBookingExperience } from './bookingExperience';
import { resolveRequiredBookingPolicy } from './bookingPolicyAcknowledgment';

vi.mock('server-only', () => ({}));

describe('default appointment agreement', () => {
  it.each([null, {}, { bookingExperience: {} }])('requires the starter agreement for unconfigured settings %j', (settings) => {
    const policy = resolveRequiredBookingPolicy({ storedPlan: 'free', features: null, settings });

    expect(policy).toMatchObject({
      enabled: true,
      text: DEFAULT_BOOKING_POLICY_TEXT,
      showBeforeConfirmation: true,
      acknowledgment: { required: true, text: DEFAULT_BOOKING_POLICY_ACKNOWLEDGMENT_TEXT },
    });
    expect(policy?.version).toMatch(/^policy-v1:[a-f0-9]{64}$/u);
    expect(policy?.text).not.toMatch(/ban/i);
  });

  it('keeps an owner’s saved off setting off after reading it again', () => {
    const experience = resolveBookingExperience(null, { includeAcknowledgmentConfiguration: true });
    experience.policy.enabled = false;
    experience.policy.acknowledgment.required = false;
    const settings = { bookingExperience: experience };

    expect(resolveBookingExperience(settings).policy.enabled).toBe(false);
    expect(resolveRequiredBookingPolicy({ storedPlan: 'free', features: null, settings })).toBeNull();
  });

  it('preserves an existing optional policy without silently requiring acknowledgment', () => {
    const experience = resolveBookingExperience(null, { includeAcknowledgmentConfiguration: true });
    const { acknowledgment: _acknowledgment, version: _version, ...policy } = experience.policy;
    const settings = { bookingExperience: { ...experience, policy: { ...policy, text: 'Please call if you are running late.' } } };

    expect(resolveBookingExperience(settings).policy.text).toBe('Please call if you are running late.');
    expect(resolveRequiredBookingPolicy({ storedPlan: 'free', features: null, settings })).toBeNull();
  });

  it('binds acknowledgment to the owner’s edited wording', () => {
    const experience = resolveBookingExperience(null, { includeAcknowledgmentConfiguration: true });
    const originalVersion = experience.policy.version;
    experience.policy.text = 'Please give us 24 hours’ notice when cancelling.';
    const policy = resolveRequiredBookingPolicy({ storedPlan: 'free', features: null, settings: { bookingExperience: experience } });

    expect(policy?.text).toBe(experience.policy.text);
    expect(policy?.version).not.toBe(originalVersion);
  });
});
