/**
 * Stage 1 — public-surface guards.
 *
 * Covers:
 *   S1  the confirmation-email half of the universal-content seam
 *   S4  supported-layout WRITES vs backward-compatible legacy READS
 *   S6b the privacy-safe status identity projection
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/* eslint-disable import/first */
import { bookingPageDraftPatchSchema, WRITABLE_BOOKING_PAGE_LAYOUTS } from './bookingPageConfig';
import { resolveBookingEmailCustomization } from './customerBookingEmail';
import { resolvePublicSalonStatusIdentity } from './salonContent';
/* eslint-enable import/first */

const FREE_PLAN_SALON = {
  storedPlan: 'free',
  features: { booking: { onlineBooking: true }, customBranding: true },
} as const;

// =============================================================================
// S1 — confirmation email
// =============================================================================

describe('S1 — authored universal content reaches the confirmation email on a free plan', () => {
  it('includes the authored confirmation message', () => {
    const customization = resolveBookingEmailCustomization({
      ...FREE_PLAN_SALON,
      settings: { bookingExperience: { confirmationMessage: 'See you soon!' } },
    });

    expect(customization.confirmationMessage).toBe('See you soon!');
  });

  it('includes an authored policy marked for the confirmation email', () => {
    const customization = resolveBookingEmailCustomization({
      ...FREE_PLAN_SALON,
      settings: {
        bookingExperience: {
          policy: {
            enabled: true,
            title: 'Booking policy',
            text: 'Cancellations inside 24 hours may incur a fee.',
            showInConfirmationEmail: true,
          },
        },
      },
    });

    expect(customization.policy.kind).toBe('informational');
    expect(customization.policy).toMatchObject({
      title: 'Booking policy',
      policyText: 'Cancellations inside 24 hours may incur a fee.',
    });
  });

  it('NO-OP CONTROL: an unauthored free salon gets no customization at all', () => {
    const customization = resolveBookingEmailCustomization({
      ...FREE_PLAN_SALON,
      settings: {},
    });

    expect(customization.confirmationMessage).toBeNull();
    expect(customization.policy.kind).not.toBe('informational');
  });

  it('CONTROL: an authored policy NOT marked for email stays out of the email', () => {
    const customization = resolveBookingEmailCustomization({
      ...FREE_PLAN_SALON,
      settings: {
        bookingExperience: {
          policy: {
            enabled: true,
            title: 'Booking policy',
            text: 'Cancellations inside 24 hours may incur a fee.',
            showInConfirmationEmail: false,
          },
        },
      },
    });

    // Every non-entitlement precondition is preserved.
    expect(customization.policy.kind).not.toBe('informational');
  });
});

// =============================================================================
// S4 — supported layout writes, backward-compatible reads
// =============================================================================

describe('S4 — only implemented layouts may be WRITTEN', () => {
  it.each(['tech_profile', 'portfolio', 'catalogue'])(
    'rejects a new write of the unimplemented layout %s',
    (layout) => {
      expect(bookingPageDraftPatchSchema.safeParse({ layout }).success).toBe(false);
    },
  );

  it.each(['quick_book', 'editorial'])('accepts the implemented layout %s', (layout) => {
    expect(bookingPageDraftPatchSchema.safeParse({ layout }).success).toBe(true);
  });

  it('the writable set is exactly the two implemented layouts', () => {
    expect([...WRITABLE_BOOKING_PAGE_LAYOUTS]).toEqual(['quick_book', 'editorial']);
  });
});

// =============================================================================
// S6b — privacy-safe status identity
// =============================================================================

describe('S6b — the status-page identity projection is narrow by construction', () => {
  it('exposes exactly name and locationLabel — no other key', () => {
    const identity = resolvePublicSalonStatusIdentity({
      name: 'Isla Nail Studio',
      city: 'Toronto',
      state: 'ON',
    });

    // A superset fails. This is what stops a salon row being spread in later.
    expect(Object.keys(identity).sort()).toEqual(['locationLabel', 'name']);
  });

  it('renders city and state when both are present', () => {
    expect(
      resolvePublicSalonStatusIdentity({ name: 'Isla', city: 'Toronto', state: 'ON' }),
    ).toEqual({ name: 'Isla', locationLabel: 'Toronto, ON' });
  });

  it('renders city alone when there is no state', () => {
    expect(
      resolvePublicSalonStatusIdentity({ name: 'Isla', city: 'Toronto', state: null }),
    ).toEqual({ name: 'Isla', locationLabel: 'Toronto' });
  });

  it('NO FABRICATION: a salon with no public city gets a null location, never a placeholder', () => {
    expect(
      resolvePublicSalonStatusIdentity({ name: 'Isla', city: null, state: 'ON' }),
    ).toEqual({ name: 'Isla', locationLabel: null });
  });

  it('treats whitespace-only city/state as absent', () => {
    expect(
      resolvePublicSalonStatusIdentity({ name: 'Isla', city: '   ', state: '  ' }),
    ).toEqual({ name: 'Isla', locationLabel: null });
  });

  it('CITY-ONLY SAFETY: the projection cannot carry a street address, postal code, phone or email', () => {
    const identity = resolvePublicSalonStatusIdentity({
      name: 'Isla',
      city: 'Toronto',
      state: 'ON',
      // @ts-expect-error deliberately passing fields the projection must drop
      address: '123 Queen St W',
      zipCode: 'M5H 2M9',
      phone: '+14165551234',
      email: 'owner@example.com',
    });

    expect(Object.keys(identity).sort()).toEqual(['locationLabel', 'name']);

    const serialized = JSON.stringify(identity);

    expect(serialized).not.toContain('Queen St');
    expect(serialized).not.toContain('M5H');
    expect(serialized).not.toContain('4165551234');
    expect(serialized).not.toContain('owner@example.com');
  });
});
