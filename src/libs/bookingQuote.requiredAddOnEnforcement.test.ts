/**
 * Server-side proof for PR 1 stage (e) — required-add-on HARD ENFORCEMENT,
 * config-gated and default-off.
 *
 * Stage (b) (bookingQuote.requiredAddOnObservation.test.ts) proved the gap is
 * observed on both code paths without blocking anything. This file proves the
 * enforcement half:
 *
 *  - with the gate off (every salon today) behaviour is unchanged — the gap is
 *    still only observed, and the booking still succeeds;
 *  - with the gate on the same selection is refused with
 *    `missing_required_add_on` on BOTH paths, including the zero-add-on
 *    early-return path where a missing required add-on hides;
 *  - the gate itself can only ever be turned on deliberately: absent, null, and
 *    malformed settings values all resolve to false and never throw.
 *
 * It also pins the deactivated-add-on trap: a required rule pointing at an
 * add-on the owner deactivated makes the service unbookable online while the
 * gate is on, because the add-on cannot be selected either. That is the reason
 * the gate must stay off until a salon's inventory has been checked with
 * `npm run db:report:required-addon-rules`.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

/* eslint-disable import/first */
import { resolveBookingConfigFromSettings } from './bookingConfig';
import { BookingSelectionError, validatePublicBookingSelection } from './bookingQuote';
/* eslint-enable import/first */

// Two salons with identical catalogs, differing only in the gate, so every
// assertion below is about the setting and nothing else.
const OFF_SALON_ID = 'salon_required_addon_enforce_off';
const ON_SALON_ID = 'salon_required_addon_enforce_on';

const SERVICE_WITH_REQUIRED_ID = 'srv_enforce_gelx';
const SERVICE_WITHOUT_REQUIRED_ID = 'srv_enforce_manicure';
const SERVICE_WITH_DEAD_REQUIRED_ID = 'srv_enforce_dead_required';
const REQUIRED_ADD_ON = 'addon_enforce_removal';
const OPTIONAL_ADD_ON = 'addon_enforce_chrome';
const DEACTIVATED_REQUIRED_ADD_ON = 'addon_enforce_retired';

let client: PGlite;
let db: PgliteDatabase<typeof schema>;

function select(salonId: string, serviceId: string, addOnIds: string[]) {
  return {
    salonId,
    selection: {
      baseServiceId: serviceId,
      selectedAddOns: addOnIds.map(addOnId => ({ addOnId, quantity: 1 })),
    },
  };
}

async function seedCatalogFor(salonId: string) {
  await db.insert(schema.serviceSchema).values([
    { id: `${SERVICE_WITH_REQUIRED_ID}_${salonId}`, salonId, name: 'Gel-X New Set', category: 'extensions', price: 9000, durationMinutes: 105 },
    { id: `${SERVICE_WITHOUT_REQUIRED_ID}_${salonId}`, salonId, name: 'Gel Manicure', category: 'manicure', price: 4500, durationMinutes: 60 },
    { id: `${SERVICE_WITH_DEAD_REQUIRED_ID}_${salonId}`, salonId, name: 'Hard Gel Overlay', category: 'extensions', price: 7000, durationMinutes: 90 },
  ]);
  await db.insert(schema.addOnSchema).values([
    { id: `${REQUIRED_ADD_ON}_${salonId}`, salonId, name: 'Removal', slug: 'removal', category: 'removal', priceCents: 1500, durationMinutes: 20 },
    { id: `${OPTIONAL_ADD_ON}_${salonId}`, salonId, name: 'Chrome', slug: 'chrome', category: 'nail_art', priceCents: 1000, durationMinutes: 15 },
    // The trap: linked as `required`, but deactivated by the owner.
    { id: `${DEACTIVATED_REQUIRED_ADD_ON}_${salonId}`, salonId, name: 'Retired Prep', slug: 'retired-prep', category: 'removal', priceCents: 800, durationMinutes: 10, isActive: false },
  ]);
  await db.insert(schema.serviceAddOnSchema).values([
    { id: `svcaddon_enforce_removal_${salonId}`, salonId, serviceId: `${SERVICE_WITH_REQUIRED_ID}_${salonId}`, addOnId: `${REQUIRED_ADD_ON}_${salonId}`, selectionMode: 'required', displayOrder: 0 },
    { id: `svcaddon_enforce_chrome_gelx_${salonId}`, salonId, serviceId: `${SERVICE_WITH_REQUIRED_ID}_${salonId}`, addOnId: `${OPTIONAL_ADD_ON}_${salonId}`, selectionMode: 'optional', displayOrder: 1 },
    { id: `svcaddon_enforce_chrome_mani_${salonId}`, salonId, serviceId: `${SERVICE_WITHOUT_REQUIRED_ID}_${salonId}`, addOnId: `${OPTIONAL_ADD_ON}_${salonId}`, selectionMode: 'optional', displayOrder: 0 },
    { id: `svcaddon_enforce_dead_${salonId}`, salonId, serviceId: `${SERVICE_WITH_DEAD_REQUIRED_ID}_${salonId}`, addOnId: `${DEACTIVATED_REQUIRED_ADD_ON}_${salonId}`, selectionMode: 'required', displayOrder: 0 },
  ]);
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    // No `enforceRequiredAddOns` key at all: exactly the shape of every salon
    // in the database on the day this ships.
    { id: OFF_SALON_ID, name: 'Enforcement Off Salon', slug: 'enforcement-off-salon', settings: { booking: { bufferMinutes: 10 } } },
    { id: ON_SALON_ID, name: 'Enforcement On Salon', slug: 'enforcement-on-salon', settings: { booking: { enforceRequiredAddOns: true } } },
  ]);

  await seedCatalogFor(OFF_SALON_ID);
  await seedCatalogFor(ON_SALON_ID);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('resolveBookingConfigFromSettings — enforceRequiredAddOns gate', () => {
  it('defaults to false when settings are empty, null, or have no booking block', () => {
    expect(resolveBookingConfigFromSettings(null).enforceRequiredAddOns).toBe(false);
    expect(resolveBookingConfigFromSettings(undefined).enforceRequiredAddOns).toBe(false);
    expect(resolveBookingConfigFromSettings({}).enforceRequiredAddOns).toBe(false);
    expect(resolveBookingConfigFromSettings({ booking: {} }).enforceRequiredAddOns).toBe(false);
  });

  it('resolves to true only for an explicit boolean true', () => {
    expect(resolveBookingConfigFromSettings({ booking: { enforceRequiredAddOns: true } }).enforceRequiredAddOns).toBe(true);
    expect(resolveBookingConfigFromSettings({ booking: { enforceRequiredAddOns: false } }).enforceRequiredAddOns).toBe(false);
  });

  it('resolves malformed values to false without throwing', () => {
    // Legacy/hand-edited JSONB can hold anything. A value that is not a boolean
    // must never be read as opt-in, and must never take the booking config
    // resolver down with it.
    const malformed: unknown[] = ['true', 'false', '', 1, 0, null, [], {}, Number.NaN];

    for (const value of malformed) {
      const settings = { booking: { enforceRequiredAddOns: value } } as unknown as Parameters<typeof resolveBookingConfigFromSettings>[0];

      expect(() => resolveBookingConfigFromSettings(settings)).not.toThrow();
      expect(resolveBookingConfigFromSettings(settings).enforceRequiredAddOns).toBe(false);
    }
  });
});

describe('validatePublicBookingSelection — gate OFF (default)', () => {
  it('still succeeds and still observes the gap with zero add-ons selected', async () => {
    const result = await validatePublicBookingSelection(
      select(OFF_SALON_ID, `${SERVICE_WITH_REQUIRED_ID}_${OFF_SALON_ID}`, []),
    );

    expect(result.observedRequiredAddOnGaps).toEqual([`${REQUIRED_ADD_ON}_${OFF_SALON_ID}`]);
    expect(result.quote.subtotalCents).toBe(9000);
  });

  it('still succeeds and still observes the gap with a non-required add-on selected', async () => {
    const result = await validatePublicBookingSelection(
      select(OFF_SALON_ID, `${SERVICE_WITH_REQUIRED_ID}_${OFF_SALON_ID}`, [`${OPTIONAL_ADD_ON}_${OFF_SALON_ID}`]),
    );

    expect(result.observedRequiredAddOnGaps).toEqual([`${REQUIRED_ADD_ON}_${OFF_SALON_ID}`]);
    expect(result.quote.subtotalCents).toBe(10000);
  });

  it('still succeeds for a service whose required add-on is deactivated', async () => {
    const result = await validatePublicBookingSelection(
      select(OFF_SALON_ID, `${SERVICE_WITH_DEAD_REQUIRED_ID}_${OFF_SALON_ID}`, []),
    );

    expect(result.observedRequiredAddOnGaps).toEqual([`${DEACTIVATED_REQUIRED_ADD_ON}_${OFF_SALON_ID}`]);
    expect(result.quote.subtotalCents).toBe(7000);
  });
});

describe('validatePublicBookingSelection — gate ON', () => {
  it('refuses a zero-add-on selection that misses a required add-on (early-return path)', async () => {
    await expect(validatePublicBookingSelection(
      select(ON_SALON_ID, `${SERVICE_WITH_REQUIRED_ID}_${ON_SALON_ID}`, []),
    )).rejects.toMatchObject({
      name: 'BookingSelectionError',
      code: 'missing_required_add_on',
      missingRequiredAddOnIds: [`${REQUIRED_ADD_ON}_${ON_SALON_ID}`],
    });

    await expect(validatePublicBookingSelection(
      select(ON_SALON_ID, `${SERVICE_WITH_REQUIRED_ID}_${ON_SALON_ID}`, []),
    )).rejects.toThrow(BookingSelectionError);
  });

  it('refuses when a different, non-required add-on is selected but the required one is missing', async () => {
    await expect(validatePublicBookingSelection(
      select(ON_SALON_ID, `${SERVICE_WITH_REQUIRED_ID}_${ON_SALON_ID}`, [`${OPTIONAL_ADD_ON}_${ON_SALON_ID}`]),
    )).rejects.toMatchObject({
      name: 'BookingSelectionError',
      code: 'missing_required_add_on',
      missingRequiredAddOnIds: [`${REQUIRED_ADD_ON}_${ON_SALON_ID}`],
    });
  });

  it('succeeds when the required add-on is selected', async () => {
    const result = await validatePublicBookingSelection(
      select(ON_SALON_ID, `${SERVICE_WITH_REQUIRED_ID}_${ON_SALON_ID}`, [`${REQUIRED_ADD_ON}_${ON_SALON_ID}`]),
    );

    expect(result.observedRequiredAddOnGaps).toEqual([]);
    expect(result.quote.subtotalCents).toBe(10500);
  });

  it('succeeds when the required add-on is selected alongside an optional one', async () => {
    const result = await validatePublicBookingSelection(
      select(ON_SALON_ID, `${SERVICE_WITH_REQUIRED_ID}_${ON_SALON_ID}`, [
        `${REQUIRED_ADD_ON}_${ON_SALON_ID}`,
        `${OPTIONAL_ADD_ON}_${ON_SALON_ID}`,
      ]),
    );

    expect(result.observedRequiredAddOnGaps).toEqual([]);
    expect(result.quote.subtotalCents).toBe(11500);
  });

  it('succeeds for a service with no required rules at all', async () => {
    const result = await validatePublicBookingSelection(
      select(ON_SALON_ID, `${SERVICE_WITHOUT_REQUIRED_ID}_${ON_SALON_ID}`, []),
    );

    expect(result.observedRequiredAddOnGaps).toEqual([]);
    expect(result.quote.subtotalCents).toBe(4500);
  });

  it('succeeds for a service whose only rules are optional and unselected', async () => {
    const result = await validatePublicBookingSelection(
      select(ON_SALON_ID, `${SERVICE_WITHOUT_REQUIRED_ID}_${ON_SALON_ID}`, [`${OPTIONAL_ADD_ON}_${ON_SALON_ID}`]),
    );

    expect(result.observedRequiredAddOnGaps).toEqual([]);
    expect(result.quote.subtotalCents).toBe(5500);
  });

  /**
   * THE TRAP, pinned deliberately: a `required` rule pointing at a deactivated
   * add-on makes the service unbookable online for as long as the gate is on.
   * Omitting the add-on is refused with `missing_required_add_on`; selecting it
   * is refused with `invalid_add_on` (deactivated add-ons are not bookable —
   * see bookingQuote.addOnGating.test.ts). There is no third option, so the
   * only fixes are owner-side: reactivate the add-on, or stop marking the rule
   * required. This is why enforcement is per-salon opt-in and why the inventory
   * report exists.
   */
  it('makes a service with a deactivated required add-on unbookable both ways', async () => {
    await expect(validatePublicBookingSelection(
      select(ON_SALON_ID, `${SERVICE_WITH_DEAD_REQUIRED_ID}_${ON_SALON_ID}`, []),
    )).rejects.toMatchObject({
      name: 'BookingSelectionError',
      code: 'missing_required_add_on',
      missingRequiredAddOnIds: [`${DEACTIVATED_REQUIRED_ADD_ON}_${ON_SALON_ID}`],
    });

    await expect(validatePublicBookingSelection(
      select(ON_SALON_ID, `${SERVICE_WITH_DEAD_REQUIRED_ID}_${ON_SALON_ID}`, [`${DEACTIVATED_REQUIRED_ADD_ON}_${ON_SALON_ID}`]),
    )).rejects.toMatchObject({
      name: 'BookingSelectionError',
      code: 'invalid_add_on',
    });
  });

  it('reports invalid_add_on, not missing_required_add_on, when the selection is also invalid', async () => {
    // An add-on that belongs to another service must keep its own, more
    // specific classification even though a required add-on is missing too.
    await expect(validatePublicBookingSelection(
      select(ON_SALON_ID, `${SERVICE_WITH_REQUIRED_ID}_${ON_SALON_ID}`, [`${DEACTIVATED_REQUIRED_ADD_ON}_${ON_SALON_ID}`]),
    )).rejects.toMatchObject({
      name: 'BookingSelectionError',
      code: 'invalid_add_on',
    });
  });
});
