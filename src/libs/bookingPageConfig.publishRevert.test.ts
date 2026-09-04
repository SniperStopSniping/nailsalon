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
  applyBookingPageBuilderOperation,
  type BookingPageBuilderOperation,
} from './bookingPageBuilder';
import {
  BOOKING_PAGE_CONFIG_SIDE_DEFAULTS,
  BookingPageBuilderWriteError,
  getBookingPageDraftPresentationState,
  publishBookingPageConfig,
  resolveBookingPageConfig,
  revertBookingPageDraft,
  updateBookingPageDraft,
} from './bookingPageConfig';
import {
  BOOKING_PAGE_PRESET_RECIPE_VERSION,
  type BookingPagePresetId,
  getBookingPagePresentationSignature,
  resolveBookingPagePresetRecipe,
} from './bookingPagePresetRecipes';
import { QUICK_BOOK_SITE_LAYOUTS } from './quickBookSiteLayout';
/* eslint-enable import/first */

const SALON_ID = 'salon_booking_page_lifecycle';

let client: PGlite;
let db: PgliteDatabase<typeof schema>;

function wrapAwaitableSelectWithBarrier<T extends object>(
  value: T,
  arrive: () => Promise<void>,
): T {
  return new Proxy(value, {
    get(target, property) {
      const member = Reflect.get(target, property, target) as unknown;

      if (property === 'then' && typeof member === 'function') {
        return (
          onFulfilled?: (result: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Reflect.apply(member, target, [
          async (result: unknown) => {
            await arrive();
            return onFulfilled ? onFulfilled(result) : result;
          },
          onRejected,
        ]);
      }

      if (typeof member !== 'function') {
        return member;
      }

      return (...args: unknown[]) => {
        const result = Reflect.apply(member, target, args) as unknown;
        if ((typeof result === 'object' && result !== null) || typeof result === 'function') {
          return wrapAwaitableSelectWithBarrier(result as object, arrive);
        }
        return result;
      };
    },
  });
}

/**
 * Makes exactly two top-level Drizzle reads resolve before either caller may
 * continue to its write. That deterministically opens the stale-snapshot
 * window in the old read/apply/write implementation without sleeping or
 * depending on query timing. A transaction-scoped repair performs its read
 * through the transaction object instead, so PGlite serializes the two real
 * operations and this outer proxy remains inert.
 */
function createTwoReadBarrierDatabase(database: PgliteDatabase<typeof schema>): {
  database: PgliteDatabase<typeof schema>;
  arrivalCount: () => number;
} {
  let arrivals = 0;
  let release: (() => void) | undefined;
  const bothReadsResolved = new Promise<void>((resolve) => {
    release = resolve;
  });

  const arrive = async () => {
    arrivals += 1;
    if (arrivals === 2) {
      release?.();
    }
    await bothReadsResolved;
  };

  return {
    database: new Proxy(database, {
      get(target, property) {
        const member = Reflect.get(target, property, target) as unknown;
        if (property === 'select' && typeof member === 'function') {
          return (...args: unknown[]) => wrapAwaitableSelectWithBarrier(
            Reflect.apply(member, target, args) as object,
            arrive,
          );
        }
        return typeof member === 'function' ? member.bind(target) : member;
      },
    }),
    arrivalCount: () => arrivals,
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
    const result = await updateBookingPageDraft(SALON_ID, {
      businessMode: 'team',
      serviceMenuLayout: 'clean_list',
    });

    expect(result?.draft.businessMode).toBe('team');
    expect(result?.draft.serviceMenuLayout).toBe('clean_list');
    expect(result?.live.businessMode).toBe('solo');
    expect(result?.live.serviceMenuLayout).toBe('visual_grid');
    expect(result?.live).toEqual(BOOKING_PAGE_CONFIG_SIDE_DEFAULTS);

    // updateBookingPageDraft only ever writes the `draft` key — `live` is not
    // created in storage until something actually publishes to it (the
    // resolver fills in the default at READ time, which is what `result?.live`
    // above already asserted).
    const stored = await readStoredSettings();

    expect(stored).toMatchObject({
      bookingPage: {
        version: 1,
        draft: { businessMode: 'team', serviceMenuLayout: 'clean_list' },
      },
    });
  });

  it.each(QUICK_BOOK_SITE_LAYOUTS)(
    'persists and publishes the %s Quick Book profile composition',
    async (quickBookLayout) => {
      const updated = await updateBookingPageDraft(SALON_ID, { quickBookLayout });

      expect(updated?.draft.quickBookLayout).toBe(quickBookLayout);

      const published = await publishBookingPageConfig(SALON_ID);

      expect(published?.live.quickBookLayout).toBe(quickBookLayout);
      expect(published?.draft.quickBookLayout).toBe(quickBookLayout);
    },
  );

  it('persists and publishes the free customer-site appearance without using premium fields', async () => {
    const updated = await updateBookingPageDraft(SALON_ID, {
      sitePalettePreset: 'black_champagne',
      siteStylePreset: 'luxury',
    });

    expect(updated?.draft.sitePalettePreset).toBe('black_champagne');
    expect(updated?.draft.siteStylePreset).toBe('luxury');
    expect(updated?.draft.stylePack).toBe('default');
    expect(updated?.draft.tokenOverrides).toBeNull();

    const published = await publishBookingPageConfig(SALON_ID);

    expect(published?.live.sitePalettePreset).toBe('black_champagne');
    expect(published?.live.siteStylePreset).toBe('luxury');
    expect(published?.live.stylePack).toBe('default');
    expect(published?.live.tokenOverrides).toBeNull();
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

  describe('Quick Book profile visibility lifecycle', () => {
    const QUICK_BOOK_PROFILE_SALON_ID = 'salon_quick_book_profile_visibility';
    const LEGACY_QUICK_BOOK_PROFILE_SALON_ID = 'salon_legacy_quick_book_profile_visibility';

    beforeAll(async () => {
      await db.insert(schema.salonSchema).values({
        id: QUICK_BOOK_PROFILE_SALON_ID,
        name: 'Quick Book Profile Visibility Salon',
        slug: 'quick-book-profile-visibility-salon',
        settings: {},
      });
      await db.insert(schema.salonSchema).values({
        id: LEGACY_QUICK_BOOK_PROFILE_SALON_ID,
        name: 'Legacy Quick Book Profile Visibility Salon',
        slug: 'legacy-quick-book-profile-visibility-salon',
        settings: {
          bookingPage: {
            version: 1,
            draft: { layout: 'quick_book' },
            live: { layout: 'quick_book' },
          },
        } as unknown as SalonSettings,
      });
    });

    it('preserves legacy mode until the owner writes a compact-profile setting', async () => {
      const untouched = await updateBookingPageDraft(
        LEGACY_QUICK_BOOK_PROFILE_SALON_ID,
        { businessMode: 'solo' },
      );

      expect(untouched?.draft.quickBookProfile.version).toBe(0);
      expect(untouched?.draft.quickBookProfile.showPhone).toBe(false);

      const legacyPublished = await publishBookingPageConfig(
        LEGACY_QUICK_BOOK_PROFILE_SALON_ID,
      );

      expect(legacyPublished?.draft.quickBookProfile.version).toBe(0);
      expect(legacyPublished?.live.quickBookProfile.version).toBe(0);

      const adopted = await updateBookingPageDraft(
        LEGACY_QUICK_BOOK_PROFILE_SALON_ID,
        { quickBookProfile: { showPhone: false } },
      );

      expect(adopted?.draft.quickBookProfile.version).toBe(1);
      expect(adopted?.draft.quickBookProfile.showPhone).toBe(false);
      expect(adopted?.live.quickBookProfile.version).toBe(0);
    });

    it('merges toggle patches and preserves them across layout, preset, publish, and revert', async () => {
      await updateBookingPageDraft(QUICK_BOOK_PROFILE_SALON_ID, {
        quickBookProfile: {
          showTechName: true,
          showPhone: true,
        },
      });

      const merged = await updateBookingPageDraft(QUICK_BOOK_PROFILE_SALON_ID, {
        quickBookProfile: {
          showPhone: false,
          showBio: true,
        },
      });

      expect(merged?.draft.quickBookProfile).toEqual({
        ...BOOKING_PAGE_CONFIG_SIDE_DEFAULTS.quickBookProfile,
        showTechName: true,
        showBio: true,
      });
      expect(merged?.live.quickBookProfile).toEqual(
        BOOKING_PAGE_CONFIG_SIDE_DEFAULTS.quickBookProfile,
      );

      const layoutSwitched = await updateBookingPageDraft(
        QUICK_BOOK_PROFILE_SALON_ID,
        { layout: 'editorial' },
      );

      expect(layoutSwitched?.draft.quickBookProfile).toEqual(merged?.draft.quickBookProfile);

      const currentState = getBookingPageDraftPresentationState(layoutSwitched!);
      const operation = {
        type: 'apply_preset',
        presetId: 'collective',
        presetVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
        expectedPresentationSignature: getBookingPagePresentationSignature({
          ...currentState,
          presetBase: currentState.presetBase ?? null,
        }),
      } as const satisfies BookingPageBuilderOperation;
      const presetResult = applyBookingPageBuilderOperation(currentState, operation);

      expect(presetResult.ok).toBe(true);

      if (!presetResult.ok) {
        throw new Error(`Expected profile-preserving preset switch, got ${presetResult.code}`);
      }

      const presetSwitched = await updateBookingPageDraft(
        QUICK_BOOK_PROFILE_SALON_ID,
        presetResult.patch,
        { builderOperation: operation },
      );

      expect(presetSwitched?.draft.quickBookProfile).toEqual(merged?.draft.quickBookProfile);

      const published = await publishBookingPageConfig(QUICK_BOOK_PROFILE_SALON_ID);

      expect(published?.live.quickBookProfile).toEqual(merged?.draft.quickBookProfile);

      const unpublished = await updateBookingPageDraft(QUICK_BOOK_PROFILE_SALON_ID, {
        quickBookProfile: {
          showTechName: false,
          showLocation: true,
        },
      });

      expect(unpublished?.draft.quickBookProfile).toEqual({
        ...BOOKING_PAGE_CONFIG_SIDE_DEFAULTS.quickBookProfile,
        showLocation: true,
        showBio: true,
      });
      expect(unpublished?.live.quickBookProfile).toEqual(merged?.draft.quickBookProfile);

      const reverted = await revertBookingPageDraft(QUICK_BOOK_PROFILE_SALON_ID);

      expect(reverted?.draft.quickBookProfile).toEqual(reverted?.live.quickBookProfile);
      expect(reverted?.draft.quickBookProfile).toEqual(merged?.draft.quickBookProfile);
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

  describe('Stage 6 semantic builder persistence', () => {
    const BUILDER_VARIANT_SALON_ID = 'salon_booking_page_builder_variants';
    const BUILDER_CONCURRENCY_SALON_ID = 'salon_booking_page_builder_concurrency';

    beforeAll(async () => {
      await db.insert(schema.salonSchema).values([
        {
          id: BUILDER_VARIANT_SALON_ID,
          name: 'Builder Variant Preservation Salon',
          slug: 'builder-variant-preservation-salon',
          settings: {
            bookingPage: {
              version: 1,
              draft: {
                layout: 'editorial',
                sectionVariants: {
                  salonProfile: 'hero',
                  serviceMenu: 'future_menu',
                  policies: 'inline',
                },
              },
            },
          } as unknown as SalonSettings,
        },
        {
          id: BUILDER_CONCURRENCY_SALON_ID,
          name: 'Builder Concurrency Salon',
          slug: 'builder-concurrency-salon',
          settings: {
            bookingPage: {
              version: 1,
              draft: {
                layout: 'editorial',
              },
            },
          } as unknown as SalonSettings,
        },
      ]);
    });

    it('persists direct Services edits on the canonical layout without touching live or another tenant', async () => {
      const otherBefore = await readStoredSettings(BUILDER_CONCURRENCY_SALON_ID);
      const salonId = 'salon_builder_service_layout';
      const settings = await readStoredSettings(BUILDER_VARIANT_SALON_ID);
      await db.insert(schema.salonSchema).values({
        id: salonId,
        name: 'Builder Service Layout',
        slug: 'builder-service-layout',
        settings: settings as SalonSettings,
      });
      const before = resolveBookingPageConfig(settings);
      const select = { type: 'set_variant', sectionId: 'serviceMenu', variant: 'grouped_categories' } as const;
      const selected = await updateBookingPageDraft(salonId, {}, { builderOperation: select });

      expect(selected?.draft.serviceMenuLayout).toBe('category_menu');
      expect(selected?.draft.sectionVariants.serviceMenu).toBe('grouped_categories');
      expect(selected?.live).toEqual(before.live);

      const resetPage = {
        type: 'reset_all',
        expectedPresentationSignature: getBookingPagePresentationSignature({
          ...getBookingPageDraftPresentationState(selected!),
          presetBase: selected!.draftPresetBase,
        }),
      } as const;
      const pageReset = await updateBookingPageDraft(salonId, {}, { builderOperation: resetPage });

      expect(pageReset?.draft.serviceMenuLayout).toBe('category_menu');
      expect(pageReset?.live).toEqual(before.live);

      const resetServices = { type: 'reset_section', sectionId: 'serviceMenu' } as const;
      const servicesReset = await updateBookingPageDraft(salonId, {}, { builderOperation: resetServices });

      expect(servicesReset?.draft.serviceMenuLayout).toBe('visual_grid');
      expect(servicesReset?.live).toEqual(before.live);
      expect(await readStoredSettings(BUILDER_CONCURRENCY_SALON_ID)).toEqual(otherBefore);
    });

    it('preserves unrelated legacy/future values while persisting a targeted variant choice', async () => {
      const stored = await readStoredSettings(BUILDER_VARIANT_SALON_ID);
      const current = resolveBookingPageConfig(stored).draft;
      const builderOperation = {
        type: 'set_variant',
        sectionId: 'socialLinks',
        variant: 'labeled',
      } as const;
      const result = applyBookingPageBuilderOperation(current, builderOperation);

      expect(result.ok).toBe(true);

      if (!result.ok) {
        throw new Error('Expected the canonical social-links variant to be accepted');
      }

      const updated = await updateBookingPageDraft(
        BUILDER_VARIANT_SALON_ID,
        result.patch,
        { builderOperation },
      );

      expect(updated?.draft.sectionVariants).toEqual({
        salonProfile: 'hero',
        serviceMenu: 'future_menu',
        policies: 'inline',
        socialLinks: 'labeled',
      });
    });

    it('reapplies the semantic operation and ignores a stale/tampered route snapshot', async () => {
      const updated = await updateBookingPageDraft(
        BUILDER_VARIANT_SALON_ID,
        {
          sectionVariants: {
            salonProfile: 'new_unknown_value',
            serviceMenu: 'future_menu',
            policies: 'inline',
            socialLinks: 'icons',
          },
        },
        {
          builderOperation: {
            type: 'set_variant',
            sectionId: 'socialLinks',
            variant: 'icons',
          },
        },
      );

      expect(updated?.draft.sectionVariants).toEqual({
        salonProfile: 'hero',
        serviceMenu: 'future_menu',
        policies: 'inline',
        socialLinks: 'icons',
      });
    });

    it('does not undo a concurrent hide when a stale reorder reaches persistence later', async () => {
      const beforeHide = resolveBookingPageConfig(
        await readStoredSettings(BUILDER_VARIANT_SALON_ID),
      ).draft;
      const builderOperation = {
        type: 'move_section',
        sectionId: 'hoursLocation',
        targetSectionId: 'technicianProfile',
        direction: 'up',
      } as const;
      const staleResult = applyBookingPageBuilderOperation(beforeHide, builderOperation);

      expect(staleResult.ok).toBe(true);

      if (!staleResult.ok) {
        throw new Error('Expected the initial reorder to be valid');
      }

      await updateBookingPageDraft(BUILDER_VARIANT_SALON_ID, {
        hiddenSections: ['policies'],
      });
      const updated = await updateBookingPageDraft(
        BUILDER_VARIANT_SALON_ID,
        staleResult.patch,
        { builderOperation },
      );

      expect(updated?.draft.hiddenSections).toEqual(['policies']);
      expect(updated?.draft.sectionOrder.indexOf('hoursLocation')).toBeLessThan(
        updated?.draft.sectionOrder.indexOf('technicianProfile') ?? -1,
      );
    });

    it('serializes truly overlapping move and hide operations without losing either edit', async () => {
      const moveOperation = {
        type: 'move_section',
        sectionId: 'hoursLocation',
        targetSectionId: 'technicianProfile',
        direction: 'up',
      } as const;
      const hideOperation = {
        type: 'set_visibility',
        sectionId: 'policies',
        visible: false,
      } as const;
      const initial = resolveBookingPageConfig(
        await readStoredSettings(BUILDER_CONCURRENCY_SALON_ID),
      ).draft;
      const moveResult = applyBookingPageBuilderOperation(initial, moveOperation);
      const hideResult = applyBookingPageBuilderOperation(initial, hideOperation);

      expect(moveResult.ok).toBe(true);
      expect(hideResult.ok).toBe(true);

      if (!moveResult.ok || !hideResult.ok) {
        throw new Error('Expected both independent builder operations to be valid');
      }

      const originalDatabase = holder.db;
      const barrier = createTwoReadBarrierDatabase(db);
      holder.db = barrier.database;
      try {
        await Promise.all([
          updateBookingPageDraft(
            BUILDER_CONCURRENCY_SALON_ID,
            moveResult.patch,
            { builderOperation: moveOperation },
          ),
          updateBookingPageDraft(
            BUILDER_CONCURRENCY_SALON_ID,
            hideResult.patch,
            { builderOperation: hideOperation },
          ),
        ]);
      } finally {
        holder.db = originalDatabase;
      }

      // The old implementation reaches both top-level reads and is forced
      // through the barrier. The fixed implementation reads under a serialized
      // transaction instead, for which zero outer reads is the expected path.
      expect([0, 2]).toContain(barrier.arrivalCount());

      const persisted = resolveBookingPageConfig(
        await readStoredSettings(BUILDER_CONCURRENCY_SALON_ID),
      ).draft;

      expect(persisted.hiddenSections).toContain('policies');
      expect(persisted.sectionOrder.indexOf('hoursLocation')).toBeLessThan(
        persisted.sectionOrder.indexOf('technicianProfile'),
      );
    });
  });

  describe('Stage 7 curated preset persistence', () => {
    const PRESET_APPLY_SALON_ID = 'salon_booking_page_preset_apply';
    const PRESET_LIFECYCLE_SALON_ID = 'salon_booking_page_preset_lifecycle';
    const PRESET_RESET_SALON_ID = 'salon_booking_page_preset_reset';
    const PRESET_STALE_SALON_ID = 'salon_booking_page_preset_stale';
    const PRESET_UNSUPPORTED_SALON_ID = 'salon_booking_page_preset_unsupported';
    const PRESET_LEGACY_SALON_ID = 'salon_booking_page_preset_legacy';
    const PRESET_MALFORMED_SALON_ID = 'salon_booking_page_preset_malformed';

    beforeAll(async () => {
      await db.insert(schema.salonSchema).values([
        {
          id: PRESET_APPLY_SALON_ID,
          name: 'Preset Apply Salon',
          slug: 'preset-apply-salon',
          settings: {
            bookingPage: {
              version: 1,
              draft: {
                layout: 'quick_book',
                stylePack: 'default',
                tokenOverrides: {
                  accentColor: '#123456',
                  fontPairing: 'classic',
                },
                sectionOrder: [
                  'salonProfile',
                  'serviceMenu',
                  'featuredServices',
                  'policies',
                  'socialLinks',
                  'bookingCta',
                ],
                sectionVariants: {
                  featuredServices: 'carousel',
                  policies: 'card',
                  socialLinks: 'icons',
                },
                hiddenSections: ['socialLinks'],
                businessMode: 'team',
                startMode: 'services_first',
              },
              live: {
                layout: 'quick_book',
                stylePack: 'default',
                tokenOverrides: {
                  accentColor: '#654321',
                  cardStyle: 'legacy-card',
                },
                sectionOrder: [
                  'salonProfile',
                  'serviceMenu',
                  'featuredServices',
                  'policies',
                  'socialLinks',
                  'bookingCta',
                ],
                sectionVariants: {
                  featuredServices: 'carousel',
                  policies: 'card',
                },
                hiddenSections: ['policies'],
                businessMode: 'solo',
                startMode: 'services_first',
              },
              draftPresetBase: null,
              livePresetBase: {
                presetId: 'quick_book',
                recipeVersion: 1,
              },
            },
            bookingPageContent: {
              version: 1,
              draft: {
                specialtyLine: 'Canonical nail art content',
                bookingMessage: 'This content must survive presentation changes.',
              },
              live: {
                specialtyLine: 'Published canonical nail art content',
              },
            },
            unrelatedFeature: {
              sentinel: 'preserve-me',
            },
          } as unknown as SalonSettings,
        },
        {
          id: PRESET_LIFECYCLE_SALON_ID,
          name: 'Preset Lifecycle Salon',
          slug: 'preset-lifecycle-salon',
          settings: {},
        },
        {
          id: PRESET_RESET_SALON_ID,
          name: 'Preset Reset Salon',
          slug: 'preset-reset-salon',
          settings: {},
        },
        {
          id: PRESET_STALE_SALON_ID,
          name: 'Preset Stale Salon',
          slug: 'preset-stale-salon',
          settings: {},
        },
        {
          id: PRESET_UNSUPPORTED_SALON_ID,
          name: 'Preset Unsupported Salon',
          slug: 'preset-unsupported-salon',
          settings: {},
        },
        {
          id: PRESET_LEGACY_SALON_ID,
          name: 'Preset Legacy Salon',
          slug: 'preset-legacy-salon',
          settings: {
            bookingPage: {
              version: 1,
              draft: {
                layout: 'editorial',
                sectionOrder: ['salonProfile', 'serviceMenu', 'bookingCta'],
              },
              live: {
                layout: 'quick_book',
              },
            },
          } as unknown as SalonSettings,
        },
        {
          id: PRESET_MALFORMED_SALON_ID,
          name: 'Preset Malformed Salon',
          slug: 'preset-malformed-salon',
          settings: {
            bookingPage: {
              version: 1,
              draft: {
                layout: 'editorial',
              },
              live: {
                layout: 'quick_book',
              },
              draftPresetBase: {
                presetId: 'menu',
                recipeVersion: 2,
              },
              livePresetBase: {
                presetId: 'lookbook',
                recipeVersion: 1,
              },
            },
          } as unknown as SalonSettings,
        },
      ]);
    });

    function requiredRecipe(presetId: BookingPagePresetId) {
      const recipe = resolveBookingPagePresetRecipe({
        presetId,
        recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
      });
      if (!recipe) {
        throw new Error(`Expected ${presetId} v${BOOKING_PAGE_PRESET_RECIPE_VERSION} to resolve`);
      }
      return recipe;
    }

    async function persistBuilderOperation(
      salonId: string,
      operation: BookingPageBuilderOperation,
    ) {
      const current = resolveBookingPageConfig(await readStoredSettings(salonId));
      const result = applyBookingPageBuilderOperation(
        getBookingPageDraftPresentationState(current),
        operation,
      );

      expect(result.ok).toBe(true);

      if (!result.ok) {
        throw new Error(`Expected ${operation.type} to be valid, got ${result.code}`);
      }

      return updateBookingPageDraft(salonId, result.patch, {
        builderOperation: operation,
      });
    }

    async function applyPreset(
      salonId: string,
      presetId: BookingPagePresetId,
    ) {
      const config = resolveBookingPageConfig(await readStoredSettings(salonId));
      const state = getBookingPageDraftPresentationState(config);

      return persistBuilderOperation(salonId, {
        type: 'apply_preset',
        presetId,
        presetVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
        expectedPresentationSignature: getBookingPagePresentationSignature({
          ...state,
          presetBase: state.presetBase ?? null,
        }),
      });
    }

    it('applies one exact server-owned recipe under the semantic write lock without changing content, live state, or non-presentation draft fields', async () => {
      const beforeStored = await readStoredSettings(PRESET_APPLY_SALON_ID) as {
        bookingPage?: { live?: unknown };
        bookingPageContent?: unknown;
        unrelatedFeature?: unknown;
      };
      const before = resolveBookingPageConfig(beforeStored);
      const recipe = requiredRecipe('menu');

      const updated = await applyPreset(PRESET_APPLY_SALON_ID, 'menu');

      expect(updated).not.toBeNull();

      if (!updated) {
        throw new Error('Expected the preset draft write to return the resolved config');
      }

      expect(updated.draft).toEqual({
        ...before.draft,
        layout: recipe.layout,
        sectionOrder: [...recipe.sectionOrder],
        sectionVariants: { ...recipe.sectionVariants },
        hiddenSections: [...recipe.hiddenSections],
      });
      expect(updated.draftPresetBase).toEqual(recipe.presetBase);
      expect(updated.live).toEqual(before.live);
      expect(updated.livePresetBase).toEqual(before.livePresetBase);
      expect(updated.draft.stylePack).toBe(before.draft.stylePack);
      expect(updated.draft.tokenOverrides).toEqual(before.draft.tokenOverrides);
      expect(updated.draft.businessMode).toBe(before.draft.businessMode);
      expect(updated.draft.startMode).toBe(before.draft.startMode);

      const afterStored = await readStoredSettings(PRESET_APPLY_SALON_ID) as {
        bookingPage?: { draft?: unknown; live?: unknown; draftPresetBase?: unknown };
        bookingPageContent?: unknown;
        unrelatedFeature?: unknown;
      };

      expect(afterStored.bookingPage?.draft).toMatchObject({
        layout: recipe.layout,
        sectionOrder: [...recipe.sectionOrder],
        sectionVariants: { ...recipe.sectionVariants },
        hiddenSections: [...recipe.hiddenSections],
        stylePack: 'default',
        tokenOverrides: {
          accentColor: '#123456',
          fontPairing: 'classic',
        },
        businessMode: 'team',
        startMode: 'services_first',
      });
      expect(afterStored.bookingPage?.draftPresetBase).toEqual(recipe.presetBase);
      expect(afterStored.bookingPage?.live).toEqual(beforeStored.bookingPage?.live);
      expect(afterStored.bookingPageContent).toEqual(beforeStored.bookingPageContent);
      expect(afterStored.unrelatedFeature).toEqual(beforeStored.unrelatedFeature);
    });

    it('publishes preset provenance with the draft and restores it with the live side on revert', async () => {
      const menu = requiredRecipe('menu');
      const collective = requiredRecipe('collective');
      const menuDraft = await applyPreset(PRESET_LIFECYCLE_SALON_ID, 'menu');

      expect(menuDraft?.draftPresetBase).toEqual(menu.presetBase);

      const published = await publishBookingPageConfig(PRESET_LIFECYCLE_SALON_ID);

      expect(published?.live).toEqual(menuDraft?.draft);
      expect(published?.livePresetBase).toEqual(menu.presetBase);
      expect(published?.draftPresetBase).toEqual(menu.presetBase);

      const collectiveDraft = await applyPreset(PRESET_LIFECYCLE_SALON_ID, 'collective');

      expect(collectiveDraft?.draftPresetBase).toEqual(collective.presetBase);
      expect(collectiveDraft?.livePresetBase).toEqual(menu.presetBase);
      expect(collectiveDraft?.live).toEqual(published?.live);

      const reverted = await revertBookingPageDraft(PRESET_LIFECYCLE_SALON_ID);

      expect(reverted?.draft).toEqual(reverted?.live);
      expect(reverted?.draftPresetBase).toEqual(menu.presetBase);
      expect(reverted?.livePresetBase).toEqual(menu.presetBase);
      expect(await readStoredSettings(PRESET_LIFECYCLE_SALON_ID)).toMatchObject({
        bookingPage: {
          draftPresetBase: menu.presetBase,
          livePresetBase: menu.presetBase,
        },
      });
    });

    it('reset_section and reset_all restore the exact inherited preset recipe rather than generic layout defaults', async () => {
      const menu = requiredRecipe('menu');
      await applyPreset(PRESET_RESET_SALON_ID, 'menu');
      await persistBuilderOperation(PRESET_RESET_SALON_ID, {
        type: 'set_variant',
        sectionId: 'policies',
        variant: 'card',
      });
      await persistBuilderOperation(PRESET_RESET_SALON_ID, {
        type: 'move_section',
        sectionId: 'policies',
        targetSectionId: 'featuredServices',
        direction: 'up',
      });
      await persistBuilderOperation(PRESET_RESET_SALON_ID, {
        type: 'set_visibility',
        sectionId: 'policies',
        visible: false,
      });

      const sectionReset = await persistBuilderOperation(PRESET_RESET_SALON_ID, {
        type: 'reset_section',
        sectionId: 'policies',
      });

      expect(sectionReset?.draft.sectionOrder).toEqual([...menu.sectionOrder]);
      expect(sectionReset?.draft.hiddenSections).toEqual([...menu.hiddenSections]);
      expect(sectionReset?.draft.sectionVariants.policies).toBe(menu.sectionVariants.policies);
      expect(sectionReset?.draftPresetBase).toEqual(menu.presetBase);

      await persistBuilderOperation(PRESET_RESET_SALON_ID, {
        type: 'set_variant',
        sectionId: 'socialLinks',
        variant: 'labeled',
      });
      await persistBuilderOperation(PRESET_RESET_SALON_ID, {
        type: 'set_visibility',
        sectionId: 'featuredServices',
        visible: false,
      });
      const customized = resolveBookingPageConfig(
        await readStoredSettings(PRESET_RESET_SALON_ID),
      );
      const customizedState = getBookingPageDraftPresentationState(customized);
      const resetAll = await persistBuilderOperation(PRESET_RESET_SALON_ID, {
        type: 'reset_all',
        expectedPresentationSignature: getBookingPagePresentationSignature({
          ...customizedState,
          presetBase: customizedState.presetBase ?? null,
        }),
      });

      expect(resetAll?.draft).toMatchObject({
        layout: menu.layout,
        sectionOrder: [...menu.sectionOrder],
        sectionVariants: { ...menu.sectionVariants },
        hiddenSections: [...menu.hiddenSections],
      });
      expect(resetAll?.draftPresetBase).toEqual(menu.presetBase);
    });

    it('treats missing, malformed, unknown, and future preset provenance as safe legacy Custom state', async () => {
      const legacyStored = await readStoredSettings(PRESET_LEGACY_SALON_ID);
      const malformedStored = await readStoredSettings(PRESET_MALFORMED_SALON_ID);

      expect(() => resolveBookingPageConfig(legacyStored)).not.toThrow();
      expect(() => resolveBookingPageConfig(malformedStored)).not.toThrow();

      const legacy = resolveBookingPageConfig(legacyStored);
      const malformed = resolveBookingPageConfig(malformedStored);

      expect(legacy.draftPresetBase).toBeNull();
      expect(legacy.livePresetBase).toBeNull();
      expect(legacy.draft.layout).toBe('editorial');
      expect(malformed.draftPresetBase).toBeNull();
      expect(malformed.livePresetBase).toBeNull();
      expect(malformed.draft.layout).toBe('editorial');
      expect(malformed.live.layout).toBe('quick_book');
    });

    it('rejects a stale preset replacement after another tab commits newer presentation state', async () => {
      const staleConfig = resolveBookingPageConfig(
        await readStoredSettings(PRESET_STALE_SALON_ID),
      );
      const staleState = getBookingPageDraftPresentationState(staleConfig);
      const staleOperation = {
        type: 'apply_preset',
        presetId: 'menu',
        presetVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
        expectedPresentationSignature: getBookingPagePresentationSignature({
          ...staleState,
          presetBase: staleState.presetBase ?? null,
        }),
      } as const satisfies BookingPageBuilderOperation;
      const stalePreview = applyBookingPageBuilderOperation(staleState, staleOperation);

      expect(stalePreview.ok).toBe(true);

      if (!stalePreview.ok) {
        throw new Error('Expected the stale tab to produce a locally valid preset preview');
      }

      // A second tab commits a genuine presentation change before the first
      // tab's request acquires the row lock.
      await persistBuilderOperation(PRESET_STALE_SALON_ID, {
        type: 'set_visibility',
        sectionId: 'policies',
        visible: false,
      });
      const newer = resolveBookingPageConfig(await readStoredSettings(PRESET_STALE_SALON_ID));

      try {
        await updateBookingPageDraft(
          PRESET_STALE_SALON_ID,
          stalePreview.patch,
          { builderOperation: staleOperation },
        );
        throw new Error('Expected the stale preset replacement to be rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(BookingPageBuilderWriteError);
        expect((error as BookingPageBuilderWriteError).code).toBe('STALE_PRESENTATION');
      }

      const after = resolveBookingPageConfig(await readStoredSettings(PRESET_STALE_SALON_ID));

      expect(after.draft).toEqual(newer.draft);
      expect(after.draftPresetBase).toEqual(newer.draftPresetBase);
      expect(after.draft.hiddenSections).toContain('policies');
      expect(after.draft.layout).toBe('quick_book');
    });

    it.each([
      ['an unknown preset id', 'lookbook', 1],
      ['a future recipe version', 'menu', 2],
    ] as const)('does not write %s through the trusted semantic persistence helper', async (
      _label,
      presetId,
      presetVersion,
    ) => {
      const beforeStored = await readStoredSettings(PRESET_UNSUPPORTED_SALON_ID);
      const current = resolveBookingPageConfig(beforeStored);
      const state = getBookingPageDraftPresentationState(current);
      const unsupportedOperation = {
        type: 'apply_preset',
        presetId,
        presetVersion,
        expectedPresentationSignature: getBookingPagePresentationSignature({
          ...state,
          presetBase: state.presetBase ?? null,
        }),
      } as unknown as BookingPageBuilderOperation;

      try {
        await updateBookingPageDraft(
          PRESET_UNSUPPORTED_SALON_ID,
          {},
          { builderOperation: unsupportedOperation },
        );
        throw new Error('Expected the unavailable preset recipe to be rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(BookingPageBuilderWriteError);
        expect((error as BookingPageBuilderWriteError).code).toBe('PRESET_NOT_FOUND');
      }

      expect(await readStoredSettings(PRESET_UNSUPPORTED_SALON_ID)).toEqual(beforeStored);
    });
  });
});
