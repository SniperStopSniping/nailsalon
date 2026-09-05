/**
 * Real-DB (PGlite) proof of `bookingPageContent.ts` — resolver defaults,
 * validation, and the draft/publish/revert lifecycle for the hero image /
 * specialty line / bio / location-presentation content fields (PR 5).
 * Mirrors `src/libs/bookingQuote.addOnGating.test.ts`'s pattern.
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
  BOOKING_PAGE_CONTENT_DEFAULTS,
  BOOKING_PAGE_CONTENT_SIDE_DEFAULTS,
  bookingPageContentPatchSchema,
  LOCATION_DISPLAY_MODES,
  publishBookingPageContent,
  resolveBookingPageContent,
  revertBookingPageContentDraft,
  updateBookingPageContentDraft,
} from './bookingPageContent';
/* eslint-enable import/first */

const SALON_ID = 'salon_booking_page_content';

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
    name: 'Booking Page Content Salon',
    slug: 'booking-page-content-salon',
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

describe('resolveBookingPageContent defaults', () => {
  it('resolves absent/malformed settings to the defaults and never throws', () => {
    for (const input of [null, undefined, {}, 'not an object', 42, [], { bookingPageContent: 'nope' }]) {
      expect(() => resolveBookingPageContent(input)).not.toThrow();
      expect(resolveBookingPageContent(input)).toEqual(BOOKING_PAGE_CONTENT_DEFAULTS);
    }
  });

  it('defaults heroImageUrl/specialtyLine/bio to null and locationDisplayMode to full_address', () => {
    expect(BOOKING_PAGE_CONTENT_SIDE_DEFAULTS).toEqual({
      heroImageUrl: null,
      specialtyLine: null,
      bio: null,
      locationDisplayMode: 'full_address',
    });
  });

  it('falls back an invalid heroImageUrl to null rather than throwing', () => {
    const resolved = resolveBookingPageContent({
      bookingPageContent: { draft: { heroImageUrl: 'not-a-url' } },
    });

    expect(resolved.draft.heroImageUrl).toBeNull();
  });

  it('fails closed for an unrecognised locationDisplayMode while a missing one keeps the default', () => {
    const unknown = resolveBookingPageContent({
      bookingPageContent: { draft: { locationDisplayMode: 'satellite_view' }, live: { locationDisplayMode: null } },
    });

    expect(unknown.draft.locationDisplayMode).toBe('city_only');
    expect(unknown.live.locationDisplayMode).toBe('city_only');
    expect(resolveBookingPageContent({ bookingPageContent: { draft: {} } }).draft.locationDisplayMode).toBe('full_address');
  });

  it('accepts all three owner choices, including "after they book"', () => {
    expect(LOCATION_DISPLAY_MODES).toEqual(['full_address', 'after_booking', 'city_only']);

    for (const mode of LOCATION_DISPLAY_MODES) {
      expect(resolveBookingPageContent({
        bookingPageContent: { draft: { locationDisplayMode: mode }, live: { locationDisplayMode: mode } },
      })).toMatchObject({ draft: { locationDisplayMode: mode }, live: { locationDisplayMode: mode } });
      expect(bookingPageContentPatchSchema.parse({ locationDisplayMode: mode })).toEqual({ locationDisplayMode: mode });
    }
  });
});

describe('bookingPageContent draft/publish/revert lifecycle (PGlite)', () => {
  it('updateBookingPageContentDraft writes only the draft side', async () => {
    const result = await updateBookingPageContentDraft(SALON_ID, {
      specialtyLine: 'Russian manicure & BIAB',
      bio: 'I focus on structure and longevity.',
      heroImageUrl: 'https://example.com/hero.jpg',
    });

    expect(result?.draft.specialtyLine).toBe('Russian manicure & BIAB');
    expect(result?.draft.bio).toBe('I focus on structure and longevity.');
    expect(result?.draft.heroImageUrl).toBe('https://example.com/hero.jpg');
    expect(result?.live).toEqual(BOOKING_PAGE_CONTENT_SIDE_DEFAULTS);

    // Like updateBookingPageDraft, updateBookingPageContentDraft only ever
    // writes the `draft` key — `live` is not created in storage until
    // something actually publishes to it.
    const stored = await readStoredSettings();

    expect(stored).toMatchObject({
      bookingPageContent: {
        version: 1,
        draft: { specialtyLine: 'Russian manicure & BIAB' },
      },
    });
  });

  it('empty-string writes normalize to null, not an empty string', async () => {
    const result = await updateBookingPageContentDraft(SALON_ID, { specialtyLine: '   ' });

    expect(result?.draft.specialtyLine).toBeNull();
  });

  it('changes only supplied keys while preserving explicit clear semantics', async () => {
    await updateBookingPageContentDraft(SALON_ID, {
      heroImageUrl: 'https://example.com/current.jpg',
      specialtyLine: 'Current specialty',
      bio: 'Current bio',
      locationDisplayMode: 'city_only',
    });

    const cleared = await updateBookingPageContentDraft(SALON_ID, { bio: null });

    expect(cleared?.draft).toEqual({
      heroImageUrl: 'https://example.com/current.jpg',
      specialtyLine: 'Current specialty',
      bio: null,
      locationDisplayMode: 'city_only',
    });
  });

  it('publishBookingPageContent copies draft into live and leaves draft untouched', async () => {
    await updateBookingPageContentDraft(SALON_ID, {
      bio: 'Published bio',
      locationDisplayMode: 'city_only',
    });

    const published = await publishBookingPageContent(SALON_ID);

    expect(published?.live.bio).toBe('Published bio');
    expect(published?.live.locationDisplayMode).toBe('city_only');
    expect(published?.draft).toEqual(published?.live);
  });

  it('revertBookingPageContentDraft resets draft to match live', async () => {
    await updateBookingPageContentDraft(SALON_ID, { bio: 'Unpublished edit' });

    const reverted = await revertBookingPageContentDraft(SALON_ID);

    expect(reverted?.draft.bio).toBe('Published bio');
    expect(reverted?.draft).toEqual(reverted?.live);
  });

  it('publish/revert/update return null for a salon id that does not exist', async () => {
    await expect(publishBookingPageContent('does-not-exist')).resolves.toBeNull();
    await expect(revertBookingPageContentDraft('does-not-exist')).resolves.toBeNull();
    await expect(updateBookingPageContentDraft('does-not-exist', { bio: 'x' })).resolves.toBeNull();
  });
});
