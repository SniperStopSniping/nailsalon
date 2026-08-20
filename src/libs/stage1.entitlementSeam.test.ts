/**
 * S1 (Stage 1) — the content/style entitlement seam, proven against an
 * ONBOARDING-REALISTIC free fixture.
 *
 * The fixture is not a hand-picked "unentitled" edge case: it is exactly what
 * `src/app/api/onboarding/luster/route.ts` writes for every salon Luster
 * creates — `plan: 'free'` plus a `freeSoloFeatures` object that contains no
 * `booking.customization` key at all. Before Stage 1 that combination made
 * booking message, policy, social links, quick facts, confirmation message and
 * the brand accent colour structurally unrenderable for EVERY Luster-onboarded
 * salon, and unwritable through the settings route.
 *
 * The controls in this file matter as much as the assertions: an "it renders"
 * test that would also pass on a fabricated default proves nothing, so every
 * positive case is paired with a no-op control on the same resolver.
 *
 * WHAT THIS FILE DOES AND DOES NOT PROVE — read before trusting it as evidence.
 *
 * `resolveBookingExperience` was NEVER entitlement-gated; the gate lived in its
 * three CALLERS. So the render and no-op blocks below are premise pins and
 * regression guards for the unchanged resolver — they pass identically on
 * origin/main and cannot observe the Stage 1 change. They are here because the
 * "nothing is fabricated" property is load-bearing once the callers stop
 * filtering, not because they demonstrate the seam moved.
 *
 * The seam itself is discriminated elsewhere, verified by reverting each seam
 * and observing the failures:
 *   - public render      -> 8 failures in book/service/BookServiceClient.test.tsx
 *   - confirmation email -> 18 failures in customerBookingEmail.test.ts and
 *                           stage1.publicSurfaces.test.ts
 *   - policy enforcement -> the acknowledgment block IN THIS FILE, which is the
 *                           one block here that does discriminate.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/* eslint-disable import/first */
import {
  BOOKING_EXPERIENCE_DEFAULTS,
  resolveBookingExperience,
} from './bookingExperience';
import { resolveRequiredBookingPolicy } from './bookingPolicyAcknowledgment';
import { resolveBookingExperienceEntitlement } from './featureEntitlements';
/* eslint-enable import/first */

/** Exactly what onboarding/luster writes. No `booking.customization` key. */
const FREE_SOLO_FEATURES = {
  booking: { onlineBooking: true, staffDashboard: true },
  marketing: { smsReminders: true, referrals: false, rewards: false },
  customBranding: true,
} as const;

const FREE_PLAN_SALON = {
  storedPlan: 'free',
  features: FREE_SOLO_FEATURES,
} as const;

const AUTHORED_SETTINGS = {
  bookingExperience: {
    primaryColor: '#AA3366',
    bookingMessage: 'Please arrive five minutes early.',
    confirmationMessage: 'See you soon!',
    socialLinks: { instagram: 'https://instagram.com/example', facebook: null, tiktok: null },
    quickFacts: {
      appointmentOnly: { enabled: true, label: 'By appointment only' },
      depositNotice: { enabled: false, label: null },
      cancellationNotice: { enabled: true, label: '24 hours notice' },
    },
    policy: {
      enabled: true,
      title: 'Booking policy',
      text: 'Cancellations inside 24 hours may incur a fee.',
      showOnServicePage: true,
      showBeforeConfirmation: true,
      showAfterConfirmation: true,
      showInConfirmationEmail: true,
    },
  },
};

/** Same salon, nothing authored. The no-op control for every case below. */
const UNAUTHORED_SETTINGS = {};

describe('S1 — the free fixture really is unentitled (non-vacuous premise)', () => {
  it('an onboarding-realistic free salon resolves as NOT entitled', () => {
    const entitlement = resolveBookingExperienceEntitlement(FREE_PLAN_SALON);

    // If this ever flips, every assertion below becomes vacuous.
    expect(entitlement.entitled).toBe(false);
  });
});

describe('S1 — universal owner-authored content renders for a free salon', () => {
  it('resolves every authored universal field, with no entitlement consulted', () => {
    const experience = resolveBookingExperience(AUTHORED_SETTINGS);

    expect(experience.bookingMessage).toBe('Please arrive five minutes early.');
    expect(experience.confirmationMessage).toBe('See you soon!');
    expect(experience.socialLinks.instagram).toBe('https://instagram.com/example');
    expect(experience.quickFacts.appointmentOnly.enabled).toBe(true);
    expect(experience.quickFacts.appointmentOnly.label).toBe('By appointment only');
    expect(experience.policy.enabled).toBe(true);
    expect(experience.policy.text).toBe('Cancellations inside 24 hours may incur a fee.');
  });

  it('resolves the authored brand accent colour', () => {
    expect(resolveBookingExperience(AUTHORED_SETTINGS).primaryColor).toBe('#AA3366');
  });
});

describe('S1 — NO-OP CONTROL: nothing is fabricated when nothing is authored', () => {
  it('an unauthored free salon resolves to the canonical defaults, unchanged', () => {
    const experience = resolveBookingExperience(UNAUTHORED_SETTINGS);

    // Byte-equality with the shipped defaults is the strongest form of "the
    // seam split did not invent content, a section, or a colour".
    expect(experience).toEqual(BOOKING_EXPERIENCE_DEFAULTS);
  });

  it('absent content stays absent field-by-field', () => {
    const experience = resolveBookingExperience(UNAUTHORED_SETTINGS);

    expect(experience.bookingMessage).toBeNull();
    expect(experience.confirmationMessage).toBeNull();
    expect(experience.primaryColor).toBeNull();
    expect(experience.policy.enabled).toBe(false);
    expect(experience.policy.text).toBeNull();
    expect(experience.socialLinks.instagram).toBeNull();
    expect(experience.quickFacts.appointmentOnly.enabled).toBe(false);
  });

  it('a null settings blob is treated the same as an empty one', () => {
    expect(resolveBookingExperience(null)).toEqual(BOOKING_EXPERIENCE_DEFAULTS);
  });
});

describe('S1 — booking-policy enforcement now agrees with what is rendered', () => {
  const ACK_SETTINGS = {
    bookingExperience: {
      ...AUTHORED_SETTINGS.bookingExperience,
      policy: {
        ...AUTHORED_SETTINGS.bookingExperience.policy,
        acknowledgment: { required: true, text: 'I have read the booking policy.' },
        version: 'v1',
      },
    },
  };

  it('requires acknowledgment for a FREE salon that authored and enabled one', () => {
    const required = resolveRequiredBookingPolicy({
      ...FREE_PLAN_SALON,
      settings: ACK_SETTINGS,
    });

    // Before Stage 1 this returned null purely because of the plan, so a free
    // salon could display an acknowledgment the server then declined to enforce.
    expect(required).not.toBeNull();
    expect(required?.acknowledgment.required).toBe(true);
    expect(required?.acknowledgment.text).toBe('I have read the booking policy.');
    // The resolver derives a content-hashed policy version rather than echoing
    // the stored string, so assert the contract rather than a literal that
    // would pin an implementation detail.
    expect(required?.version).toEqual(expect.stringContaining('policy-'));
    expect(required!.version.length).toBeGreaterThan(10);
  });

  it('NO-OP CONTROL: a salon with no policy still requires nothing', () => {
    expect(
      resolveRequiredBookingPolicy({ ...FREE_PLAN_SALON, settings: UNAUTHORED_SETTINGS }),
    ).toBeNull();
  });

  it('NO-OP CONTROL: an authored policy that does not require acknowledgment requires nothing', () => {
    expect(
      resolveRequiredBookingPolicy({ ...FREE_PLAN_SALON, settings: AUTHORED_SETTINGS }),
    ).toBeNull();
  });

  it('every other policy precondition is preserved — an enabled policy with no text still requires nothing', () => {
    const noText = {
      bookingExperience: {
        policy: {
          enabled: true,
          title: 'Booking policy',
          text: null,
          showBeforeConfirmation: true,
          acknowledgment: { required: true, text: 'I agree.' },
          version: 'v1',
        },
      },
    };

    expect(
      resolveRequiredBookingPolicy({ ...FREE_PLAN_SALON, settings: noText }),
    ).toBeNull();
  });
});

describe('S1 — premium style fields are untouched by Stage 1', () => {
  it('stylePack and tokenOverrides are NOT part of the bookingExperience seam at all', () => {
    const experience = resolveBookingExperience(AUTHORED_SETTINGS) as Record<string, unknown>;

    // They live in `bookingPageConfig`, not here. This pins the boundary so a
    // future PR cannot quietly universalize them through this resolver.
    expect(experience).not.toHaveProperty('stylePack');
    expect(experience).not.toHaveProperty('tokenOverrides');
  });

  it('DEFERRED INVARIANT: premium style is currently WRITABLE and INERT, not gated', () => {
    // Stage 1 deliberately does NOT claim stylePack/tokenOverrides are
    // entitlement-gated today — they are not. They are written through
    // `api/admin/booking-page/route.ts`, which has no entitlement guard, and no
    // production renderer reads them.
    //
    // The binding invariant recorded for the future: the first PR that gives
    // either field a production reader MUST add the premium entitlement
    // boundary in that same PR, before activation. Asserting a 403 here would
    // be a fabricated control for behaviour that does not exist.
    expect(resolveBookingExperienceEntitlement(FREE_PLAN_SALON).entitled).toBe(false);
  });
});
