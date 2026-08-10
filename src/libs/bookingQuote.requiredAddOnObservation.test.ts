/**
 * Server-side proof for PR 1 stage (b) — required-add-on observation.
 *
 * service_add_on.selectionMode = 'required' is only honoured client-side
 * today: validatePublicBookingSelection loads the rules but never checks
 * them (see bookingQuote.addOnGating.test.ts for the compatibility checks it
 * does make). Before enforcement can be turned on, we need to know how many
 * live bookings would have been blocked. This file proves the observation
 * signal is real: it is computed on the two paths that matter (an empty
 * add-on selection, which used to skip the rules table entirely, and a
 * populated one), and it never blocks the booking either way.
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
import { validatePublicBookingSelection } from './bookingQuote';
/* eslint-enable import/first */

const SALON_ID = 'salon_required_addon_observation';
const SERVICE_WITH_REQUIRED_ID = 'srv_observation_gelx';
const SERVICE_WITHOUT_REQUIRED_ID = 'srv_observation_manicure';
const REQUIRED_ADD_ON = 'addon_observation_removal';
const OPTIONAL_ADD_ON = 'addon_observation_chrome';

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
    name: 'Observation Salon',
    slug: 'observation-salon',
    settings: {},
  });
  await db.insert(schema.serviceSchema).values([
    { id: SERVICE_WITH_REQUIRED_ID, salonId: SALON_ID, name: 'Gel-X New Set', category: 'extensions', price: 9000, durationMinutes: 105 },
    { id: SERVICE_WITHOUT_REQUIRED_ID, salonId: SALON_ID, name: 'Gel Manicure', category: 'manicure', price: 4500, durationMinutes: 60 },
  ]);
  await db.insert(schema.addOnSchema).values([
    { id: REQUIRED_ADD_ON, salonId: SALON_ID, name: 'Removal', slug: 'removal', category: 'removal', priceCents: 1500, durationMinutes: 20 },
    { id: OPTIONAL_ADD_ON, salonId: SALON_ID, name: 'Chrome', slug: 'chrome', category: 'nail_art', priceCents: 1000, durationMinutes: 15 },
  ]);
  // Gel-X requires removal of any existing product; the plain manicure has
  // no required add-ons at all, covering the case where `rules` is non-empty
  // but contains nothing with selectionMode: 'required'.
  await db.insert(schema.serviceAddOnSchema).values([
    { id: 'svcaddon_observation_removal', salonId: SALON_ID, serviceId: SERVICE_WITH_REQUIRED_ID, addOnId: REQUIRED_ADD_ON, selectionMode: 'required', displayOrder: 0 },
    { id: 'svcaddon_observation_chrome_gelx', salonId: SALON_ID, serviceId: SERVICE_WITH_REQUIRED_ID, addOnId: OPTIONAL_ADD_ON, selectionMode: 'optional', displayOrder: 1 },
    { id: 'svcaddon_observation_chrome_mani', salonId: SALON_ID, serviceId: SERVICE_WITHOUT_REQUIRED_ID, addOnId: OPTIONAL_ADD_ON, selectionMode: 'optional', displayOrder: 0 },
  ]);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('validatePublicBookingSelection — required add-on observation', () => {
  it('reports the gap and still succeeds when zero add-ons are selected (the early-return path)', async () => {
    const result = await validatePublicBookingSelection(select(SERVICE_WITH_REQUIRED_ID, []));

    expect(result.observedRequiredAddOnGaps).toEqual([REQUIRED_ADD_ON]);
    expect(result.quote.subtotalCents).toBe(9000);
  });

  it('reports the gap and still succeeds when a different, non-required add-on is selected', async () => {
    const result = await validatePublicBookingSelection(select(SERVICE_WITH_REQUIRED_ID, [OPTIONAL_ADD_ON]));

    expect(result.observedRequiredAddOnGaps).toEqual([REQUIRED_ADD_ON]);
    expect(result.quote.subtotalCents).toBe(10000);
  });

  it('reports no gap once the required add-on is selected', async () => {
    const result = await validatePublicBookingSelection(select(SERVICE_WITH_REQUIRED_ID, [REQUIRED_ADD_ON]));

    expect(result.observedRequiredAddOnGaps).toEqual([]);
  });

  it('reports no gap for a service with no required rules at all', async () => {
    const result = await validatePublicBookingSelection(select(SERVICE_WITHOUT_REQUIRED_ID, []));

    expect(result.observedRequiredAddOnGaps).toEqual([]);
  });
});
