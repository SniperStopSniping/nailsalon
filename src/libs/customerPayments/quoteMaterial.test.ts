import { describe, expect, it } from 'vitest';

import { buildBookingTaxSnapshot, DISABLED_TAX_CONFIG, resolveTaxConfig } from '@/libs/taxConfig';
import type { Appointment, AppointmentAddOn, AppointmentService, SalonStripeAccount } from '@/models/Schema';

import type { CustomerPaymentQuoteMaterialInput } from './quoteMaterial';
import { buildCustomerPaymentQuoteMaterial } from './quoteMaterial';
import { customerPaymentDraftResponse, DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from './settings';

const now = new Date('2026-11-08T12:00:00.000Z');
function fixture(): CustomerPaymentQuoteMaterialInput {
  const appointment = {
    id: 'appt_1',
    salonId: 'salon_1',
    status: 'confirmed',
    deletedAt: null,
    startTime: new Date(now.getTime() + 3600000),
    endTime: new Date(now.getTime() + 7200000),
    startedAt: null,
    completedAt: null,
    lockedAt: null,
    depositHoldExpiresAt: null,
    totalPrice: 9000,
    basePriceCents: 10000,
    addOnsPriceCents: 0,
    subtotalBeforeDiscountCents: 10000,
    discountAmountCents: 1000,
    discountType: 'fixed',
    discountLabel: 'Offer',
    discountPercent: null,
    discountAppliedAt: now,
    finalPriceCents: null,
    finalSubtotalCents: null,
    finalDiscountCents: null,
    finalDiscountReason: null,
    tipCents: 0,
    paymentStatus: 'pending',
    amountPaidCents: null,
    invoiceCurrency: 'CAD',
    taxableSubtotalCents: null,
    taxAmountCents: null,
    taxExempt: null,
    taxExemptReason: null,
    bookingTaxSnapshot: buildBookingTaxSnapshot({ taxConfig: DISABLED_TAX_CONFIG, totals: { finalPriceCents: 9000, taxableSubtotalCents: 0, taxAmountCents: 0, taxApplied: false }, currency: 'CAD', capturedAt: now }),
    rescheduleTaxSnapshot: null,
    finalTaxSnapshot: null,
    updatedAt: now,
    clientName: 'PRIVATE_NAME',
    clientEmail: 'PRIVATE_EMAIL',
    notes: 'PRIVATE_NOTE',
    techNotes: 'PRIVATE_TECH_NOTE',
  } as unknown as Appointment;
  const service: AppointmentService = { id: 'as_1', appointmentId: 'appt_1', serviceId: 'svc_1', priceAtBooking: 10000, durationAtBooking: 60, nameSnapshot: 'Service', categorySnapshot: 'Nails', variantLabelSnapshot: null, variantKindSnapshot: null, priceCentsSnapshot: null, durationMinutesSnapshot: null, priceDisplayTextSnapshot: null, resolvedIntroPriceLabelSnapshot: null };
  const binding: SalonStripeAccount = { id: 'binding_1', salonId: 'salon_1', stripeAccountId: 'acct_test', livemode: false, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, requirementsDue: {}, disabledReason: null, connectedAt: now, revokedAt: null, revocationCause: null, lastSyncedAt: now, createdAt: now, updatedAt: now };
  return { appointment, salon: { id: 'salon_1', status: 'active', publicationStatus: 'published', deletedAt: null }, capability: { tokenId: 'cap_1', salonId: 'salon_1', appointmentId: 'appt_1', expiresAt: new Date(now.getTime() + 1800000), revokedAt: null }, binding, policy: customerPaymentDraftResponse(1, { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true }), services: [service], addOns: [], payments: [], deposits: [], tipCents: 2000, now };
}
function addon(): AppointmentAddOn {
  return { id: 'addon_1', appointmentId: 'appt_1', appointmentServiceId: 'as_1', addOnId: 'catalog_addon', quantitySnapshot: 2, nameSnapshot: 'Extra', categorySnapshot: 'art', pricingTypeSnapshot: 'per_unit', priceModeSnapshot: 'catalog_priced', unitPriceCentsSnapshot: 500, durationMinutesSnapshot: 5, lineTotalCentsSnapshot: 1000, lineDurationMinutesSnapshot: 10, priceDisplayTextSnapshot: null, createdAt: now };
}

describe('authoritative non-executable quote material', () => {
  it('uses frozen post-discount totals without subtracting the discount twice', () => {
    const material = buildCustomerPaymentQuoteMaterial(fixture());

    expect(material.snapshot).toMatchObject({ servicesCents: 9000, discountCents: 0, taxCents: 0, tipCents: 2000, chargeCents: 11000, applicationFeeCents: 100, customerPlatformFeeCents: 0 });
    expect(material.expiresAt.toISOString()).toBe('2026-11-08T12:05:00.000Z');
    expect(material.context.policy).toEqual({ revision: 1, settings: { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true } });
    expect(material.context.capability).toEqual({ tokenId: 'cap_1', expiresAt: '2026-11-08T12:30:00.000Z' });
  });

  it('correctly splits inclusive frozen tax without adding it twice', () => {
    const input = fixture();
    input.appointment.totalPrice = 9000;
    input.appointment.bookingTaxSnapshot = buildBookingTaxSnapshot({ taxConfig: resolveTaxConfig({ payments: { tax: {
      enabled: true,
      name: 'HST',
      rateBps: 1300,
      pricesIncludeTax: true,
    } } }, now), totals: { finalPriceCents: 7965, taxableSubtotalCents: 9000, taxAmountCents: 1035, taxApplied: true }, currency: 'CAD', capturedAt: now });

    expect(buildCustomerPaymentQuoteMaterial(input).snapshot).toMatchObject({ servicesCents: 7965, taxCents: 1035, chargeCents: 11000 });
  });

  it('allows exact fixed/per-unit add-on snapshots and rejects changed totals', () => {
    const input = fixture();
    input.services[0]!.priceAtBooking = 9000;
    input.appointment.basePriceCents = 9000;
    input.appointment.addOnsPriceCents = 1000;
    input.addOns = [addon()];

    expect(buildCustomerPaymentQuoteMaterial(input).snapshot.chargeCents).toBe(11000);

    input.addOns[0]!.lineTotalCentsSnapshot = 1001;

    expect(() => buildCustomerPaymentQuoteMaterial(input)).toThrow('ITEM_TOTAL_MISMATCH');
  });

  it('keeps original expiry stable on replay and refuses expired/extended quotes', () => {
    const input = fixture();
    const first = buildCustomerPaymentQuoteMaterial(input);
    const replay = buildCustomerPaymentQuoteMaterial({ ...input, now: new Date(now.getTime() + 60000), existingExpiresAt: first.expiresAt });

    expect(replay).toEqual(first);
    expect(() => buildCustomerPaymentQuoteMaterial({ ...input, existingExpiresAt: now })).toThrow('QUOTE_STALE');
    expect(() => buildCustomerPaymentQuoteMaterial({ ...input, existingExpiresAt: new Date(now.getTime() + 300001) })).toThrow('QUOTE_STALE');
  });

  it('caps expiry by capability and appointment start', () => {
    const input = fixture();
    input.capability.expiresAt = new Date(now.getTime() + 120000);

    expect(buildCustomerPaymentQuoteMaterial(input).expiresAt).toEqual(input.capability.expiresAt);

    input.appointment.startTime = new Date(now.getTime() + 60000);

    expect(buildCustomerPaymentQuoteMaterial(input).expiresAt).toEqual(input.appointment.startTime);
  });

  it.each(['cancelled', 'no_show', 'completed', 'awaiting_payment', 'pending', 'in_progress'])('refuses appointment state %s', (status) => {
    const input = fixture();
    input.appointment.status = status;

    expect(() => buildCustomerPaymentQuoteMaterial(input)).toThrow('APPOINTMENT_INELIGIBLE');
  });

  it('refuses deleted/final/started/held and past appointments', () => {
    for (const patch of [{ deletedAt: now }, { completedAt: now }, { startedAt: now }, { lockedAt: now }, { finalPriceCents: 9000 }, { depositHoldExpiresAt: now }, { startTime: now }]) {
      const input = fixture();
      Object.assign(input.appointment, patch);

      expect(() => buildCustomerPaymentQuoteMaterial(input)).toThrow('APPOINTMENT_INELIGIBLE');
    }
  });

  it('refuses every existing tender/deposit history and paid/comp/tip/cache scalar', () => {
    for (const patch of [{ tipCents: 1 }, { amountPaidCents: 1 }, { paymentStatus: 'paid' }, { paymentStatus: 'comp' }]) {
      const input = fixture();
      Object.assign(input.appointment, patch);

      expect(() => buildCustomerPaymentQuoteMaterial(input)).toThrow('EXISTING_MONEY_UNSUPPORTED');
    }
    const input = fixture();

    expect(() => buildCustomerPaymentQuoteMaterial({ ...input, payments: [{} as never] })).toThrow('EXISTING_MONEY_UNSUPPORTED');
    expect(() => buildCustomerPaymentQuoteMaterial({ ...input, deposits: [{} as never] })).toThrow('EXISTING_MONEY_UNSUPPORTED');
  });

  it('refuses foreign/revoked/expired capabilities and foreign salon/binding', () => {
    for (const patch of [{ salonId: 'other' }, { appointmentId: 'other' }, { revokedAt: now }, { expiresAt: now }]) {
      const input = fixture();
      Object.assign(input.capability, patch);

      expect(() => buildCustomerPaymentQuoteMaterial(input)).toThrow('ACCESS_INVALID');
    }
    const input = fixture();
    input.binding.salonId = 'other';

    expect(() => buildCustomerPaymentQuoteMaterial(input)).toThrow('BINDING_UNAVAILABLE');

    input.salon.id = 'other';

    expect(() => buildCustomerPaymentQuoteMaterial(input)).toThrow('ACCESS_INVALID');
  });

  it('refuses inactive/unpublished salons and live/revoked/unready accounts', () => {
    for (const patch of [{ status: 'inactive' }, { publicationStatus: 'draft' }, { deletedAt: now }]) {
      const input = fixture();
      Object.assign(input.salon, patch);

      expect(() => buildCustomerPaymentQuoteMaterial(input)).toThrow('SALON_UNAVAILABLE');
    }
    for (const patch of [{ livemode: true }, { revokedAt: now }, { chargesEnabled: false }, { disabledReason: 'restricted' }]) {
      const input = fixture();
      Object.assign(input.binding, patch);

      expect(() => buildCustomerPaymentQuoteMaterial(input)).toThrow('BINDING_UNAVAILABLE');
    }
  });

  it('fails closed for disabled/revision-zero/required/customer-payer policies', () => {
    for (const patch of [{ enabled: false }, { mode: 'required_deposit' }, { mode: 'full_online_required' }, { feePayer: 'customer' }]) {
      const input = fixture();
      Object.assign(input.policy.settings, patch);

      expect(() => buildCustomerPaymentQuoteMaterial(input)).toThrow();
    }
    const input = fixture();
    input.policy.revision = 0;

    expect(() => buildCustomerPaymentQuoteMaterial(input)).toThrow('DRAFT_DISABLED');
  });

  it('rejects unknown/manual/starting-price service and add-on amounts', () => {
    for (const patch of [{ priceDisplayTextSnapshot: 'From $100' }, { variantKindSnapshot: 'manual' }, { appointmentId: 'other' }, { priceCentsSnapshot: 123 }]) {
      const input = fixture();
      Object.assign(input.services[0]!, patch);

      expect(() => buildCustomerPaymentQuoteMaterial(input)).toThrow('SERVICE_UNSUPPORTED');
    }
    for (const patch of [{ priceModeSnapshot: 'manual_confirmation' }, { pricingTypeSnapshot: 'starting_at' }, { priceDisplayTextSnapshot: 'From $5' }, { appointmentServiceId: 'foreign' }]) {
      const input = fixture();
      input.addOns = [{ ...addon(), ...patch } as AppointmentAddOn];

      expect(() => buildCustomerPaymentQuoteMaterial(input)).toThrow('ADDON_UNSUPPORTED');
    }
  });

  it('rejects missing/stale frozen tax, corrupt totals and invalid tips', () => {
    const input = fixture();
    input.appointment.bookingTaxSnapshot = null;

    expect(() => buildCustomerPaymentQuoteMaterial(input)).toThrow('FROZEN_TAX_REQUIRED');

    for (const tipCents of [-1, 1.1, Number.NaN, 50000001]) {
      expect(() => buildCustomerPaymentQuoteMaterial({ ...fixture(), tipCents })).toThrow('INVALID_MONEY');
    }
    const changed = fixture();
    changed.appointment.bookingTaxSnapshot = { ...changed.appointment.bookingTaxSnapshot!, taxAmountCents: 1 };

    expect(() => buildCustomerPaymentQuoteMaterial(changed)).toThrow('FROZEN_TAX_REQUIRED');
  });

  it('whitelists privacy-safe detached JSON and sorts row identity deterministically', () => {
    const input = fixture();
    input.services = [{ ...input.services[0]!, id: 'as_b', serviceId: 'svc_b', priceAtBooking: 5000 }, { ...input.services[0]!, id: 'as_a', serviceId: 'svc_a', priceAtBooking: 5000 }];
    const material = buildCustomerPaymentQuoteMaterial(input);

    expect(buildCustomerPaymentQuoteMaterial({ ...input, services: [...input.services].reverse() }).context).toEqual(material.context);
    expect(JSON.stringify(material.context)).not.toContain('PRIVATE');
    expect(JSON.parse(JSON.stringify(material.context))).toEqual(material.context);

    input.binding.requirementsDue.currently_due = ['changed'];

    expect(JSON.stringify(material.context)).not.toContain('changed');
    expect(buildCustomerPaymentQuoteMaterial(input).context).not.toEqual(material.context);
  });

  it('changes context when material authority changes without changing the amount', () => {
    const first = buildCustomerPaymentQuoteMaterial(fixture());
    for (const mutate of [
      (input: CustomerPaymentQuoteMaterialInput) => {
        input.policy.revision++;
      },
      (input: CustomerPaymentQuoteMaterialInput) => {
        input.binding.id = 'binding_2';
      },
      (input: CustomerPaymentQuoteMaterialInput) => {
        input.binding.updatedAt = new Date(now.getTime() + 1);
      },
      (input: CustomerPaymentQuoteMaterialInput) => {
        input.capability.tokenId = 'cap_2';
      },
      (input: CustomerPaymentQuoteMaterialInput) => {
        input.services[0]!.durationAtBooking++;
      },
      (input: CustomerPaymentQuoteMaterialInput) => {
        input.policy.settings.cancellationPolicy = 'New policy';
      },
    ]) {
      const input = fixture();
      mutate(input);

      expect(buildCustomerPaymentQuoteMaterial(input).context).not.toEqual(first.context);
    }
  });
});
