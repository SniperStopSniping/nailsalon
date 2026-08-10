/**
 * Real-DB (PGlite) proof of the PR 5 draft/publish/revert lifecycle for the
 * `bookingPage` config pair: `updateBookingPageDraft` (PR 2, previously
 * untested against a real database) plus this PR's
 * `publishBookingPageConfig` / `revertBookingPageDraft`.
 *
 * Mirrors the pattern in `src/libs/bookingQuote.addOnGating.test.ts`: real
 * migrations against an in-memory PGlite instance, `@/libs/DB` mocked only so
 * the module under test can be imported.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
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
import {
  BOOKING_PAGE_CONFIG_SIDE_DEFAULTS,
  publishBookingPageConfig,
  revertBookingPageDraft,
  updateBookingPageDraft,
} from './bookingPageConfig';
/* eslint-enable import/first */

const SALON_ID = 'salon_booking_page_lifecycle';

let client: PGlite;
let db: PgliteDatabase<typeof schema>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Booking Page Lifecycle Salon',
    slug: 'booking-page-lifecycle-salon',
    settings: {},
  });
}, 60_000);

afterAll(async () => {
  await client.close();
});

async function readStoredSettings(): Promise<unknown> {
  const [row] = await db
    .select({ settings: schema.salonSchema.settings })
    .from(schema.salonSchema)
    .where(eq(schema.salonSchema.id, SALON_ID));
  return row?.settings;
}

describe('bookingPage draft/publish/revert lifecycle (PGlite)', () => {
  it('updateBookingPageDraft writes only the draft side, leaving live at defaults', async () => {
    const result = await updateBookingPageDraft(SALON_ID, { businessMode: 'team' });

    expect(result?.draft.businessMode).toBe('team');
    expect(result?.live.businessMode).toBe('solo');
    expect(result?.live).toEqual(BOOKING_PAGE_CONFIG_SIDE_DEFAULTS);

    // updateBookingPageDraft only ever writes the `draft` key — `live` is not
    // created in storage until something actually publishes to it (the
    // resolver fills in the default at READ time, which is what `result?.live`
    // above already asserted).
    const stored = await readStoredSettings();

    expect(stored).toMatchObject({
      bookingPage: {
        version: 1,
        draft: { businessMode: 'team' },
      },
    });
  });

  it('publishBookingPageConfig copies the current draft into live and leaves draft untouched', async () => {
    await updateBookingPageDraft(SALON_ID, {
      layout: 'quick_book',
      businessMode: 'team',
      hiddenSections: ['policies'],
    });

    const published = await publishBookingPageConfig(SALON_ID);

    expect(published?.live.businessMode).toBe('team');
    expect(published?.live.hiddenSections).toEqual(['policies']);
    // Draft is left exactly as it was — publishing again with no further
    // edits is a safe no-op.
    expect(published?.draft).toEqual(published?.live);
  });

  it('a further draft edit after publish does not retroactively change live', async () => {
    await updateBookingPageDraft(SALON_ID, { businessMode: 'solo' });

    const stored = await readStoredSettings() as {
      bookingPage?: {
        draft?: { businessMode?: string };
        live?: { businessMode?: string };
      };
    };

    expect(stored.bookingPage?.draft?.businessMode).toBe('solo');
    // live still reflects the last publish, from the previous test.
    expect(stored.bookingPage?.live?.businessMode).toBe('team');
  });

  it('revertBookingPageDraft resets draft to match live, discarding unpublished edits', async () => {
    // Draft currently diverges from live (businessMode 'solo' vs 'team',
    // set up by the previous test). Revert should discard that divergence.
    const reverted = await revertBookingPageDraft(SALON_ID);

    expect(reverted?.draft).toEqual(reverted?.live);
    expect(reverted?.draft.businessMode).toBe('team');
    expect(reverted?.draft.hiddenSections).toEqual(['policies']);
  });

  it('serviceMenu and bookingCta can never end up in hiddenSections, even via a direct draft patch', async () => {
    const result = await updateBookingPageDraft(SALON_ID, {
      hiddenSections: ['serviceMenu', 'bookingCta', 'policies'],
    });

    expect(result?.draft.hiddenSections).toEqual(['policies']);
    expect(result?.draft.sectionOrder).toContain('serviceMenu');
    expect(result?.draft.sectionOrder).toContain('bookingCta');
  });

  it('publish/revert return null for a salon id that does not exist', async () => {
    await expect(publishBookingPageConfig('does-not-exist')).resolves.toBeNull();
    await expect(revertBookingPageDraft('does-not-exist')).resolves.toBeNull();
  });
});
