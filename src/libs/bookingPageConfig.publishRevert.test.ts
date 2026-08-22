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

async function readStoredSettings(salonId = SALON_ID): Promise<unknown> {
  const [row] = await db
    .select({ settings: schema.salonSchema.settings })
    .from(schema.salonSchema)
    .where(eq(schema.salonSchema.id, salonId));
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

  describe('S2 (Stage 1): a bare layout switch PRESERVES presentation state', () => {
    const LAYOUT_SWITCH_SALON_ID = 'salon_booking_page_layout_switch';

    beforeAll(async () => {
      await db.insert(schema.salonSchema).values({
        id: LAYOUT_SWITCH_SALON_ID,
        name: 'Layout Switch Salon',
        slug: 'layout-switch-salon',
        settings: {},
      });
    });

    /**
     * DELIBERATE REVERSAL OF A PREVIOUSLY GREEN TEST.
     *
     * This block was `PR 6: layout switch resets sectionOrder to the new layout
     * default`, and it asserted the exact opposite of what it now asserts.
     *
     * OLD BEHAVIOUR (PR 6): a bare `{ layout }` patch reset BOTH `sectionOrder`
     * and `hiddenSections` to the destination layout's defaults. PR 6's reasoning
     * was that a caller sending only `{ layout }` could not reasonably intend to
     * keep the previous layout's order.
     *
     * WHY IT CHANGED: the frozen post-reconciliation Owner contract (Stage 1,
     * Amendment B) supersedes that. An ordinary layout change must never silently
     * discard owner state — hidden sections in particular were being silently
     * un-hidden by a single unconfirmed click, which is destructive and invisible
     * at the moment it happens.
     *
     * NEW BEHAVIOUR: presentation state is preserved exactly unless the caller
     * sends the explicit `resetPresentation: true` intent, covered below. The
     * ordinary admin layout selector does not send it.
     */
    it('a bare `{ layout }` patch preserves sectionOrder byte-for-byte', async () => {
      const seeded = await updateBookingPageDraft(LAYOUT_SWITCH_SALON_ID, {
        layout: 'quick_book',
        sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'bookingCta'],
      });
      const orderBefore = seeded?.draft.sectionOrder;

      const switched = await updateBookingPageDraft(LAYOUT_SWITCH_SALON_ID, { layout: 'editorial' });

      expect(switched?.draft.layout).toBe('editorial');
      expect(switched?.draft.sectionOrder).toEqual(orderBefore);
    });

    it('a bare `{ layout }` patch preserves hiddenSections byte-for-byte', async () => {
      const withHiddenPolicies = await updateBookingPageDraft(LAYOUT_SWITCH_SALON_ID, {
        layout: 'quick_book',
        hiddenSections: ['policies'],
      });

      expect(withHiddenPolicies?.draft.hiddenSections).toEqual(['policies']);

      const switched = await updateBookingPageDraft(LAYOUT_SWITCH_SALON_ID, { layout: 'editorial' });

      expect(switched?.draft.layout).toBe('editorial');
      // The owner hid this section. Changing layout is not consent to un-hide it.
      expect(switched?.draft.hiddenSections).toEqual(['policies']);
    });

    it('an explicit `resetPresentation: true` DOES replace both with the selected layout defaults', async () => {
      await updateBookingPageDraft(LAYOUT_SWITCH_SALON_ID, {
        layout: 'quick_book',
        hiddenSections: ['policies'],
      });

      const reset = await updateBookingPageDraft(LAYOUT_SWITCH_SALON_ID, {
        layout: 'editorial',
        resetPresentation: true,
      });

      expect(reset?.draft.layout).toBe('editorial');
      expect(reset?.draft.hiddenSections).toEqual([]);
      expect(reset?.draft.sectionOrder).toEqual([
        'salonProfile',
        'featuredServices',
        'technicianProfile',
        'portfolio',
        'reviews',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ]);
    });

    it('`resetPresentation: true` without a layout resets to the CURRENT layout defaults', async () => {
      await updateBookingPageDraft(LAYOUT_SWITCH_SALON_ID, {
        layout: 'quick_book',
        hiddenSections: ['policies', 'socialLinks'],
      });

      const reset = await updateBookingPageDraft(LAYOUT_SWITCH_SALON_ID, { resetPresentation: true });

      expect(reset?.draft.layout).toBe('quick_book');
      expect(reset?.draft.hiddenSections).toEqual([]);
    });

    it('`resetPresentation` is never persisted into the stored side', async () => {
      const result = await updateBookingPageDraft(LAYOUT_SWITCH_SALON_ID, {
        layout: 'quick_book',
        resetPresentation: true,
      });

      expect(result?.draft).not.toHaveProperty('resetPresentation');
      expect(result?.live).not.toHaveProperty('resetPresentation');
    });

    it('a patch that sets layout AND an explicit sectionOrder keeps that explicit order — the reset never overrides it', async () => {
      const result = await updateBookingPageDraft(LAYOUT_SWITCH_SALON_ID, {
        layout: 'quick_book',
        sectionOrder: ['salonProfile', 'serviceMenu', 'bookingCta'],
      });

      expect(result?.draft.layout).toBe('quick_book');
      expect(result?.draft.sectionOrder).toEqual(['salonProfile', 'serviceMenu', 'bookingCta']);
    });

    it('re-patching the SAME layout leaves the current sectionOrder untouched (no reset when layout does not actually change)', async () => {
      const before = await updateBookingPageDraft(LAYOUT_SWITCH_SALON_ID, { businessMode: 'solo' });

      expect(before?.draft.layout).toBe('quick_book');
      expect(before?.draft.sectionOrder).toEqual(['salonProfile', 'serviceMenu', 'bookingCta']);

      const after = await updateBookingPageDraft(LAYOUT_SWITCH_SALON_ID, { layout: 'quick_book' });

      expect(after?.draft.sectionOrder).toEqual(['salonProfile', 'serviceMenu', 'bookingCta']);
    });
  });

  describe('typed section-variant lifecycle', () => {
    const VARIANT_PUBLISH_SALON_ID = 'salon_booking_page_variant_publish';
    const VARIANT_LAYOUT_SALON_ID = 'salon_booking_page_variant_layout';

    beforeAll(async () => {
      await db.insert(schema.salonSchema).values([
        {
          id: VARIANT_PUBLISH_SALON_ID,
          name: 'Variant Publish Salon',
          slug: 'variant-publish-salon',
          settings: {},
        },
        {
          id: VARIANT_LAYOUT_SALON_ID,
          name: 'Variant Layout Salon',
          slug: 'variant-layout-salon',
          settings: {},
        },
      ]);
    });

    it('round-trips valid same-section variants from draft through publish/live storage', async () => {
      const sectionVariants = {
        salonProfile: 'hero_image',
        technicianProfile: 'cards',
        featuredServices: 'signature',
        serviceMenu: 'grouped_categories',
        hoursLocation: 'location_cards',
        policies: 'inline',
        socialLinks: 'labeled',
        bookingCta: 'sticky',
      } as const;

      const drafted = await updateBookingPageDraft(VARIANT_PUBLISH_SALON_ID, {
        layout: 'editorial',
        sectionVariants,
      });

      expect(drafted?.draft.sectionVariants).toEqual(sectionVariants);
      expect(drafted?.live.sectionVariants).toEqual({});

      const published = await publishBookingPageConfig(VARIANT_PUBLISH_SALON_ID);

      expect(published?.draft.sectionVariants).toEqual(sectionVariants);
      expect(published?.live.sectionVariants).toEqual(sectionVariants);
      expect(await readStoredSettings(VARIANT_PUBLISH_SALON_ID)).toMatchObject({
        bookingPage: {
          draft: { sectionVariants },
          live: { sectionVariants },
        },
      });
    });

    it('preserves sectionVariants byte-for-byte across a bare layout switch', async () => {
      const sectionVariants = {
        salonProfile: 'compact',
        featuredServices: 'carousel',
        policies: 'card',
      } as const;

      const seeded = await updateBookingPageDraft(VARIANT_LAYOUT_SALON_ID, {
        layout: 'quick_book',
        sectionVariants,
      });

      expect(seeded?.draft.sectionVariants).toEqual(sectionVariants);

      const switched = await updateBookingPageDraft(VARIANT_LAYOUT_SALON_ID, {
        layout: 'editorial',
      });

      expect(switched?.draft.layout).toBe('editorial');
      expect(switched?.draft.sectionVariants).toEqual(sectionVariants);
      expect(await readStoredSettings(VARIANT_LAYOUT_SALON_ID)).toMatchObject({
        bookingPage: {
          draft: { layout: 'editorial', sectionVariants },
        },
      });
    });
  });
});
