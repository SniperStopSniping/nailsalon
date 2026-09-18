import path from 'node:path';

import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

// The runtime database guard deliberately provides an isolated in-memory
// PGlite database when DATABASE_URL is absent. DB announces that fallback on
// first import; this test asserts its behavior rather than treating that
// expected test-harness notice as product output.
vi.hoisted(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

/* eslint-disable import/first */
import { db } from '@/libs/DB';

import { BookingSelectionError, validatePublicBookingSelection } from './bookingQuote';
import { buildCustomerProposal } from './customerAssistant/catalogue.server';
/* eslint-enable import/first */

const SALON = 'l1-parity-salon';
const OTHER = 'l1-parity-other';
const SERVICE = 'l1-parity-service';
const PARENT = 'l1-parity-parent';
const CHILD = 'l1-parity-child';
const AUTO = 'l1-parity-auto';
const REQUIRED = 'l1-parity-required';
const QUANTITY = 'l1-parity-quantity';
const FRENCH = 'l1-parity-french';
const REQUIRED_SECOND = 'l1-parity-required-second';
const TECH = 'l1-parity-tech';
const INACTIVE_TECH = 'l1-parity-inactive-tech';
const OTHER_TECH = 'l1-parity-other-tech';
const CAPABILITY = 'l1-parity-capability';
const features = { catalog: { variantsV1: true, addOnGroupsV1: false, bookingModesV1: false } };

beforeAll(async () => {
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  await db.insert(schema.salonSchema).values([
    { id: SALON, slug: 'l1-parity', name: 'L1 Parity', features, settings: { booking: { timezone: 'America/Toronto', currency: 'CAD', enforceRequiredAddOns: true } } },
    { id: OTHER, slug: 'l1-parity-other', name: 'Other', features, settings: {} },
  ]);
  await db.insert(schema.serviceSchema).values([
    { id: SERVICE, salonId: SALON, name: 'Fifty minute service', category: 'manicure', price: 5000, durationMinutes: 45, isActive: true },
    { id: PARENT, salonId: SALON, name: 'Variant parent', category: 'manicure', price: 6000, durationMinutes: 55, isActive: true },
    { id: CHILD, salonId: SALON, name: 'Variant long', category: 'manicure', price: 7000, durationMinutes: 60, isActive: true, parentServiceId: PARENT, variantLabel: 'Long' },
  ]);
  await db.insert(schema.addOnGroupSchema).values({ id: 'l1-parity-group', salonId: SALON, name: 'Required choices', slug: 'required-choices', minSelections: 1, maxSelections: 1 });
  await db.insert(schema.addOnSchema).values([
    { id: AUTO, salonId: SALON, name: 'Automatic prep', slug: 'automatic-prep', category: 'removal', priceCents: 0, durationMinutes: 5, groupId: null, isActive: true },
    { id: REQUIRED, salonId: SALON, name: 'Required shape', slug: 'required-shape', category: 'nail_art', priceCents: 500, durationMinutes: 0, groupId: 'l1-parity-group', isActive: true },
    { id: REQUIRED_SECOND, salonId: SALON, name: 'Required oval', slug: 'required-oval', category: 'nail_art', priceCents: 700, durationMinutes: 0, groupId: 'l1-parity-group', isActive: true },
    { id: FRENCH, salonId: SALON, name: 'French optional', slug: 'french-optional', category: 'nail_art', priceCents: 1000, durationMinutes: 10, groupId: null, isActive: true },
    { id: QUANTITY, salonId: SALON, name: 'Nail repair', slug: 'nail-repair', category: 'nail_art', priceCents: 250, durationMinutes: 1, pricingType: 'per_unit', maxQuantity: 3, groupId: null, isActive: true },
  ]);
  await db.insert(schema.serviceAddOnSchema).values([
    { id: 'l1-parity-auto-binding', salonId: SALON, serviceId: SERVICE, addOnId: AUTO, selectionMode: 'optional' },
    { id: 'l1-parity-required-binding', salonId: SALON, serviceId: SERVICE, addOnId: REQUIRED, selectionMode: 'required' },
    { id: 'l1-parity-required-second-binding', salonId: SALON, serviceId: SERVICE, addOnId: REQUIRED_SECOND, selectionMode: 'optional' },
    { id: 'l1-parity-french-binding', salonId: SALON, serviceId: SERVICE, addOnId: FRENCH, selectionMode: 'optional' },
    { id: 'l1-parity-parent-french-binding', salonId: SALON, serviceId: PARENT, addOnId: FRENCH, selectionMode: 'optional' },
    { id: 'l1-parity-quantity-binding', salonId: SALON, serviceId: SERVICE, addOnId: QUANTITY, selectionMode: 'optional' },
  ]);
  await db.insert(schema.capabilitySchema).values({ id: CAPABILITY, salonId: SALON, slug: 'l1-parity-skill', name: 'L1 Parity Skill' });
  await db.insert(schema.catalogRuleSchema).values([
    { id: 'l1-parity-auto-rule', salonId: SALON, serviceId: SERVICE, ruleType: 'include', subjectServiceId: SERVICE, subjectAddOnId: null, objectAddOnId: AUTO, capabilityId: null, params: { autoAdd: true }, priority: 0, isActive: true, note: null },
    { id: 'l1-parity-mutual-rule', salonId: SALON, serviceId: SERVICE, ruleType: 'mutually_exclusive', subjectServiceId: null, subjectAddOnId: FRENCH, objectAddOnId: QUANTITY, capabilityId: null, params: {}, priority: 1, isActive: true, note: null },
    { id: 'l1-parity-capability-rule', salonId: SALON, serviceId: null, ruleType: 'requires_capability', subjectServiceId: SERVICE, subjectAddOnId: null, objectAddOnId: null, capabilityId: CAPABILITY, params: {}, priority: 1, isActive: true, note: null },
  ]);
  await db.insert(schema.technicianSchema).values([
    { id: TECH, salonId: SALON, name: 'Assigned', isActive: true },
    { id: INACTIVE_TECH, salonId: SALON, name: 'Inactive', isActive: false },
    { id: OTHER_TECH, salonId: OTHER, name: 'Other tenant', isActive: true },
  ]);
  await db.insert(schema.technicianServicesSchema).values([
    { technicianId: TECH, serviceId: SERVICE, enabled: true },
    { technicianId: INACTIVE_TECH, serviceId: SERVICE, enabled: true },
    { technicianId: TECH, serviceId: CHILD, enabled: true },
  ]);
  await db.insert(schema.technicianCapabilitySchema).values({ id: 'l1-parity-capability-assignment', salonId: SALON, technicianId: TECH, capabilityId: CAPABILITY });
}, 60_000);

describe('L1 public and customer quote parity', () => {
  it('keeps the same authoritative 50-minute price and auto-added ids', async () => {
    const selection = { baseServiceId: SERVICE, selectedAddOns: [{ addOnId: REQUIRED, quantity: 1 }] };
    const [publicSelection, customer] = await Promise.all([
      validatePublicBookingSelection({ salonId: SALON, selection }),
      buildCustomerProposal(SALON, features, selection),
    ]);

    expect(publicSelection.quote.visibleDurationMinutes).toBe(50);
    expect(publicSelection.quote.subtotalCents).toBe(5500);
    expect(publicSelection.quote.addOns.map(line => line.addOnId).sort()).toEqual([AUTO, REQUIRED]);
    expect(publicSelection.l1?.eligibleTechnicianIds).toEqual([TECH]);
    expect(customer.durationMinutes).toBe(publicSelection.quote.visibleDurationMinutes);
    expect(customer.subtotalCents).toBe(publicSelection.quote.subtotalCents);
    expect(customer.addOns.map(line => line.id).sort()).toEqual([AUTO, REQUIRED]);
  });

  it('keeps per-unit quantities in parity through the same capability-qualified technician', async () => {
    const selection = { baseServiceId: SERVICE, selectedAddOns: [{ addOnId: REQUIRED, quantity: 1 }, { addOnId: QUANTITY, quantity: 2 }] };
    const [publicSelection, customer] = await Promise.all([
      validatePublicBookingSelection({ salonId: SALON, selection }),
      buildCustomerProposal(SALON, features, selection),
    ]);

    expect(publicSelection.quote.subtotalCents).toBe(6000);
    expect(publicSelection.quote.visibleDurationMinutes).toBe(52);
    expect(publicSelection.quote.addOns.find(line => line.addOnId === QUANTITY)).toMatchObject({ quantity: 2, lineTotalCents: 500, lineDurationMinutes: 2 });
    expect(customer).toMatchObject({ subtotalCents: 6000, durationMinutes: 52 });
  });

  it('uses the parent binding inherited by an active child variant in both paths', async () => {
    const selection = { baseServiceId: CHILD, selectedAddOns: [{ addOnId: FRENCH, quantity: 1 }] };
    const [manual, ai] = await Promise.all([validatePublicBookingSelection({ salonId: SALON, selection }), buildCustomerProposal(SALON, features, selection)]);

    expect(manual.quote).toMatchObject({ subtotalCents: 8000, visibleDurationMinutes: 70 });
    expect(manual.quote.addOns).toHaveLength(1);
    expect(manual.quote.addOns[0]).toMatchObject({ addOnId: FRENCH, lineTotalCents: 1000, lineDurationMinutes: 10 });
    expect(ai).toMatchObject({ subtotalCents: 8000, durationMinutes: 70 });
    expect(ai.addOns).toEqual([expect.objectContaining({ id: FRENCH, priceCents: 1000 })]);
  });

  it('keeps optional French and multiple add-ons identical for manual and AI paths', async () => {
    const selection = { baseServiceId: SERVICE, selectedAddOns: [{ addOnId: REQUIRED, quantity: 1 }, { addOnId: FRENCH, quantity: 1 }] };
    const [manual, ai] = await Promise.all([validatePublicBookingSelection({ salonId: SALON, selection }), buildCustomerProposal(SALON, features, selection)]);

    expect(manual.quote).toMatchObject({ subtotalCents: 6500, visibleDurationMinutes: 60 });
    expect(manual.quote.addOns.map(line => line.addOnId).sort()).toEqual([AUTO, FRENCH, REQUIRED]);
    expect(ai).toMatchObject({ subtotalCents: 6500, durationMinutes: 60 });
    expect(ai.addOns.map(line => line.id).sort()).toEqual([AUTO, FRENCH, REQUIRED]);
  });

  it('rejects group max, mutual exclusion, inactive options, and capability removal on both paths', async () => {
    const required = { baseServiceId: SERVICE, selectedAddOns: [{ addOnId: REQUIRED, quantity: 1 }] };
    const invalids = [
      { baseServiceId: SERVICE, selectedAddOns: [{ addOnId: REQUIRED, quantity: 1 }, { addOnId: REQUIRED_SECOND, quantity: 1 }] },
      { baseServiceId: SERVICE, selectedAddOns: [{ addOnId: REQUIRED, quantity: 1 }, { addOnId: FRENCH, quantity: 1 }, { addOnId: QUANTITY, quantity: 1 }] },
    ];
    for (const selection of invalids) {
      await expect(validatePublicBookingSelection({ salonId: SALON, selection })).rejects.toBeInstanceOf(BookingSelectionError);
      await expect(buildCustomerProposal(SALON, features, selection)).rejects.toBeInstanceOf(Error);
    }
    await db.update(schema.addOnSchema).set({ isActive: false }).where(eq(schema.addOnSchema.id, FRENCH));
    const inactive = { baseServiceId: SERVICE, selectedAddOns: [{ addOnId: REQUIRED, quantity: 1 }, { addOnId: FRENCH, quantity: 1 }] };

    await expect(validatePublicBookingSelection({ salonId: SALON, selection: inactive })).rejects.toBeInstanceOf(Error);
    await expect(buildCustomerProposal(SALON, features, inactive)).rejects.toBeInstanceOf(Error);

    await db.update(schema.addOnSchema).set({ isActive: true }).where(eq(schema.addOnSchema.id, FRENCH));
    await db.delete(schema.technicianCapabilitySchema).where(eq(schema.technicianCapabilitySchema.id, 'l1-parity-capability-assignment'));

    await expect(validatePublicBookingSelection({ salonId: SALON, selection: required })).rejects.toBeInstanceOf(Error);
    await expect(buildCustomerProposal(SALON, features, required)).rejects.toBeInstanceOf(Error);

    await db.insert(schema.technicianCapabilitySchema).values({ id: 'l1-parity-capability-assignment', salonId: SALON, technicianId: TECH, capabilityId: CAPABILITY });
  });

  it('keeps inactive required bindings fail-closed, including inherited bindings', async () => {
    const inactiveId = 'l1-parity-inactive-required';
    await db.insert(schema.addOnSchema).values({ id: inactiveId, salonId: SALON, name: 'Inactive required option', slug: inactiveId, category: 'nail_art', priceCents: 100, durationMinutes: 1, isActive: false });
    await db.insert(schema.serviceAddOnSchema).values([SERVICE, PARENT].map(serviceId => ({ id: `${inactiveId}-${serviceId}`, salonId: SALON, serviceId, addOnId: inactiveId, selectionMode: 'required' as const })));
    try {
      for (const selection of [
        { baseServiceId: SERVICE, selectedAddOns: [{ addOnId: REQUIRED, quantity: 1 }] },
        { baseServiceId: CHILD, selectedAddOns: [] },
      ]) {
        await expect(validatePublicBookingSelection({ salonId: SALON, selection })).rejects.toMatchObject({ code: 'missing_required_add_on' });
        await expect(buildCustomerProposal(SALON, features, selection)).rejects.toMatchObject({ code: 'missing_required_add_on' });
      }
    } finally {
      await db.delete(schema.serviceAddOnSchema).where(eq(schema.serviceAddOnSchema.addOnId, inactiveId));
      await db.delete(schema.addOnSchema).where(eq(schema.addOnSchema.id, inactiveId));
    }
  });

  it('fails closed for unsupported inherited consultation mode', async () => {
    await db.update(schema.serviceSchema).set({ confirmationMode: 'consultation' }).where(eq(schema.serviceSchema.id, PARENT));
    try {
      const selection = { baseServiceId: CHILD, selectedAddOns: [] };

      await expect(validatePublicBookingSelection({ salonId: SALON, selection })).rejects.toMatchObject({ code: 'unavailable' });
      await expect(buildCustomerProposal(SALON, features, selection)).rejects.toBeInstanceOf(Error);
    } finally {
      await db.update(schema.serviceSchema).set({ confirmationMode: null }).where(eq(schema.serviceSchema.id, PARENT));
    }
  });

  it('uses fresh modified base and automatic material in both paths', async () => {
    const selection = { baseServiceId: SERVICE, selectedAddOns: [{ addOnId: REQUIRED, quantity: 1 }] };
    await db.update(schema.serviceSchema).set({ price: 5300, durationMinutes: 47 }).where(eq(schema.serviceSchema.id, SERVICE));
    await db.update(schema.addOnSchema).set({ priceCents: 300, durationMinutes: 6 }).where(eq(schema.addOnSchema.id, AUTO));
    const [manual, ai] = await Promise.all([validatePublicBookingSelection({ salonId: SALON, selection }), buildCustomerProposal(SALON, features, selection)]);

    expect(manual.quote).toMatchObject({ subtotalCents: 6100, visibleDurationMinutes: 53 });
    expect(manual.quote.addOns.find(line => line.addOnId === AUTO)).toMatchObject({ lineTotalCents: 300, lineDurationMinutes: 6 });
    expect(ai).toMatchObject({ subtotalCents: 6100, durationMinutes: 53 });

    await db.update(schema.serviceSchema).set({ price: 5000, durationMinutes: 45 }).where(eq(schema.serviceSchema.id, SERVICE));
    await db.update(schema.addOnSchema).set({ priceCents: 0, durationMinutes: 5 }).where(eq(schema.addOnSchema.id, AUTO));
  });

  it('rejects a missing required group choice and never accepts a wrong-tenant technician', async () => {
    await expect(validatePublicBookingSelection({ salonId: SALON, selection: { baseServiceId: SERVICE, selectedAddOns: [] } })).rejects.toBeInstanceOf(BookingSelectionError);
    await expect(validatePublicBookingSelection({ salonId: SALON, technicianId: OTHER_TECH, selection: { baseServiceId: SERVICE, selectedAddOns: [{ addOnId: REQUIRED, quantity: 1 }] } })).rejects.toMatchObject({ code: 'unsupported_technician' });
    await expect(validatePublicBookingSelection({ salonId: SALON, technicianId: INACTIVE_TECH, selection: { baseServiceId: SERVICE, selectedAddOns: [{ addOnId: REQUIRED, quantity: 1 }] } })).rejects.toMatchObject({ code: 'unsupported_technician' });
  });
});
