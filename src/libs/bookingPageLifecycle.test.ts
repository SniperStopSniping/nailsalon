import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

/* eslint-disable import/first */
import {
  BOOKING_PAGE_CONFIG_SIDE_DEFAULTS,
  resolveBookingPageConfig,
} from './bookingPageConfig';
import {
  BOOKING_PAGE_CONTENT_SIDE_DEFAULTS,
  resolveBookingPageContent,
} from './bookingPageContent';
import { synchronizeBookingPageLifecycle } from './bookingPageLifecycle';
/* eslint-enable import/first */

let client: PGlite;
let database: PgliteDatabase<typeof schema>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = database;
}, 60_000);

afterAll(async () => {
  await client.close();
});

async function insertSalon(id: string, settings: SalonSettings) {
  await database.insert(schema.salonSchema).values({
    id,
    name: `Lifecycle ${id}`,
    slug: id,
    settings,
  });
}

async function readSettings(id: string): Promise<unknown> {
  const [row] = await database
    .select({ settings: schema.salonSchema.settings })
    .from(schema.salonSchema)
    .where(eq(schema.salonSchema.id, id));

  return row?.settings;
}

function lifecycleSettings(): SalonSettings {
  return {
    unrelated: { retained: true },
    bookingPage: {
      version: 1,
      draft: {
        ...BOOKING_PAGE_CONFIG_SIDE_DEFAULTS,
        businessMode: 'team',
      },
      live: {
        ...BOOKING_PAGE_CONFIG_SIDE_DEFAULTS,
        businessMode: 'solo',
      },
      draftPresetBase: { presetId: 'collective', recipeVersion: 1 },
      livePresetBase: { presetId: 'quick_book', recipeVersion: 1 },
    },
    bookingPageContent: {
      version: 1,
      draft: {
        ...BOOKING_PAGE_CONTENT_SIDE_DEFAULTS,
        bio: 'Draft biography',
        locationDisplayMode: 'city_only',
      },
      live: {
        ...BOOKING_PAGE_CONTENT_SIDE_DEFAULTS,
        bio: 'Live biography',
      },
    },
  } as unknown as SalonSettings;
}

describe('booking-page lifecycle synchronization (PGlite)', () => {
  it('publishes config, preset provenance, and content from one snapshot while preserving draft and siblings', async () => {
    const salonId = 'lifecycle_publish';
    await insertSalon(salonId, lifecycleSettings());

    const synchronized = await synchronizeBookingPageLifecycle(salonId, 'publish');

    const stored = await readSettings(salonId);
    const config = resolveBookingPageConfig(synchronized);
    const content = resolveBookingPageContent(synchronized);

    expect(synchronized).toEqual(stored);
    expect(config.live).toEqual(config.draft);
    expect(config.livePresetBase).toEqual(config.draftPresetBase);
    expect(content.live).toEqual(content.draft);
    expect(stored).toMatchObject({ unrelated: { retained: true } });
    expect(config.draft.businessMode).toBe('team');
    expect(content.draft.bio).toBe('Draft biography');
  });

  it('reverts config, preset provenance, and content from one snapshot while preserving live and siblings', async () => {
    const salonId = 'lifecycle_revert';
    await insertSalon(salonId, lifecycleSettings());

    const synchronized = await synchronizeBookingPageLifecycle(salonId, 'revert');

    const stored = await readSettings(salonId);
    const config = resolveBookingPageConfig(synchronized);
    const content = resolveBookingPageContent(synchronized);

    expect(synchronized).toEqual(stored);
    expect(config.draft).toEqual(config.live);
    expect(config.draftPresetBase).toEqual(config.livePresetBase);
    expect(content.draft).toEqual(content.live);
    expect(stored).toMatchObject({ unrelated: { retained: true } });
    expect(config.live.businessMode).toBe('solo');
    expect(content.live.bio).toBe('Live biography');
  });

  it('normalizes malformed nested storage without touching unrelated settings', async () => {
    const salonId = 'lifecycle_malformed';
    await insertSalon(salonId, {
      bookingPage: 'invalid',
      bookingPageContent: 42,
      unrelated: { retained: true },
    } as unknown as SalonSettings);

    const synchronized = await synchronizeBookingPageLifecycle(salonId, 'publish');

    const stored = await readSettings(salonId);

    expect(synchronized).toEqual(stored);
    expect(resolveBookingPageConfig(synchronized).live).toEqual(BOOKING_PAGE_CONFIG_SIDE_DEFAULTS);
    expect(resolveBookingPageContent(synchronized).live).toEqual(BOOKING_PAGE_CONTENT_SIDE_DEFAULTS);
    expect(stored).toMatchObject({ unrelated: { retained: true } });
  });

  it('fails closed when the salon no longer exists', async () => {
    await expect(synchronizeBookingPageLifecycle('missing_lifecycle_salon', 'publish'))
      .resolves.toBeNull();
  });
});
