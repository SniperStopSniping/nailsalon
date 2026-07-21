/**
 * Server-side proof that add-ons are never standalone bookable items.
 *
 * The client only offers add-ons after a base service is picked
 * (BookServiceClient.test.tsx covers that), but the UI is not the guarantee —
 * validatePublicBookingSelection is. An add-on with no service_add_on row for
 * the chosen service, or one the owner deactivated, must be refused even when
 * a hand-crafted request asks for it directly.
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
import { BookingSelectionError, validatePublicBookingSelection } from './bookingQuote';
/* eslint-enable import/first */

const SALON_ID = 'salon_addon_gating';
const MANICURE_ID = 'srv_gating_manicure';
const PEDICURE_ID = 'srv_gating_pedicure';
const LINKED_ADD_ON = 'addon_gating_linked';
const UNLINKED_ADD_ON = 'addon_gating_unlinked';
const INACTIVE_ADD_ON = 'addon_gating_inactive';

let client: PGlite;
let db: PgliteDatabase<typeof schema>;

function select(serviceId: string, addOnIds: string[]) {
  return {
    salonId: SALON_ID,
    selection: {
      baseServiceId: serviceId,
      selectedAddOns: addOnIds.map(addOnId => ({ addOnId, quantity: 1 })),
    },
  };
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Gating Salon',
    slug: 'gating-salon',
    settings: {},
  });
  await db.insert(schema.serviceSchema).values([
    { id: MANICURE_ID, salonId: SALON_ID, name: 'Gel Manicure', category: 'manicure', price: 4500, durationMinutes: 60 },
    { id: PEDICURE_ID, salonId: SALON_ID, name: 'Gel Pedicure', category: 'pedicure', price: 5500, durationMinutes: 60 },
  ]);
  await db.insert(schema.addOnSchema).values([
    { id: LINKED_ADD_ON, salonId: SALON_ID, name: 'Chrome', slug: 'chrome', category: 'nail_art', priceCents: 1000, durationMinutes: 15 },
    { id: UNLINKED_ADD_ON, salonId: SALON_ID, name: 'French Toes', slug: 'french-toes', category: 'nail_art', priceCents: 1000, durationMinutes: 15 },
    { id: INACTIVE_ADD_ON, salonId: SALON_ID, name: 'Retired Art', slug: 'retired-art', category: 'nail_art', priceCents: 500, durationMinutes: 10, isActive: false },
  ]);
  // Chrome is offered with the manicure only; the retired add-on is linked but
  // deactivated, so the link alone must not make it bookable.
  await db.insert(schema.serviceAddOnSchema).values([
    { id: 'svcaddon_gating_chrome', salonId: SALON_ID, serviceId: MANICURE_ID, addOnId: LINKED_ADD_ON, selectionMode: 'optional', displayOrder: 0 },
    { id: 'svcaddon_gating_retired', salonId: SALON_ID, serviceId: MANICURE_ID, addOnId: INACTIVE_ADD_ON, selectionMode: 'optional', displayOrder: 1 },
  ]);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('validatePublicBookingSelection — add-on gating', () => {
  it('accepts an add-on linked to the chosen base service', async () => {
    const result = await validatePublicBookingSelection(select(MANICURE_ID, [LINKED_ADD_ON]));

    expect(result.addOns.map(addOn => addOn.id)).toEqual([LINKED_ADD_ON]);
    expect(result.quote.subtotalCents).toBe(5500);
  });

  it('refuses an add-on that is not offered with the chosen service', async () => {
    await expect(validatePublicBookingSelection(select(MANICURE_ID, [UNLINKED_ADD_ON])))
      .rejects.toThrow(BookingSelectionError);
  });

  it('refuses an add-on linked to a different service than the one booked', async () => {
    // Chrome is manicure-only; asking for it alongside the pedicure fails.
    await expect(validatePublicBookingSelection(select(PEDICURE_ID, [LINKED_ADD_ON])))
      .rejects.toThrow(BookingSelectionError);
  });

  it('refuses a deactivated add-on even though the link still exists', async () => {
    await expect(validatePublicBookingSelection(select(MANICURE_ID, [INACTIVE_ADD_ON])))
      .rejects.toThrow(BookingSelectionError);
  });

  it('refuses an add-on booked as if it were the service itself', async () => {
    // An add-on id is not a service id: there is no standalone path in.
    await expect(validatePublicBookingSelection(select(LINKED_ADD_ON, [])))
      .rejects.toThrow(BookingSelectionError);
  });
});
