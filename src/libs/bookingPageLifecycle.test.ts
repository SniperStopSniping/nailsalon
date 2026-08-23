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
  getBookingPageDraftPresentationState,
  resolveBookingPageConfig,
  updateBookingPageDraft,
} from './bookingPageConfig';
import {
  BOOKING_PAGE_CONTENT_SIDE_DEFAULTS,
  resolveBookingPageContent,
  updateBookingPageContentDraft,
} from './bookingPageContent';
import {
  synchronizeBookingPageLifecycle,
  updateBookingPageDraftState,
} from './bookingPageLifecycle';
import {
  BOOKING_PAGE_PRESET_RECIPE_VERSION,
  type BookingPagePresetId,
  getBookingPagePresentationSignature,
} from './bookingPagePresetRecipes';
/* eslint-enable import/first */

let client: PGlite;
let database: PgliteDatabase<typeof schema>;

/** Pauses the first transaction before it begins while later transactions run normally. */
function createFirstTransactionGate(targetDatabase: PgliteDatabase<typeof schema>) {
  let firstTransaction = true;
  let announceTransaction: (() => void) | undefined;
  let releaseTransaction: (() => void) | undefined;
  const transactionWaiting = new Promise<void>((resolve) => {
    announceTransaction = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseTransaction = resolve;
  });

  return {
    database: new Proxy(targetDatabase, {
      get(target, property) {
        const member = Reflect.get(target, property, target) as unknown;
        if (property === 'transaction' && typeof member === 'function') {
          return (...args: unknown[]) => {
            if (!firstTransaction) {
              return Reflect.apply(member, target, args);
            }

            firstTransaction = false;
            announceTransaction?.();
            return released.then(() => Reflect.apply(member, target, args));
          };
        }
        return typeof member === 'function' ? member.bind(target) : member;
      },
    }),
    transactionWaiting,
    release: () => releaseTransaction?.(),
  };
}

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

type CoherentGenerationSettings = SalonSettings & {
  bookingPage: {
    version: 1;
    draft: Record<string, unknown>;
    live: Record<string, unknown>;
    draftPresetBase: Record<string, unknown>;
    livePresetBase: Record<string, unknown>;
  };
  bookingPageContent: {
    version: 1;
    draft: Record<string, unknown>;
    live: Record<string, unknown>;
  };
};

function coherentGenerationSettings(generation: 'one' | 'two'): CoherentGenerationSettings {
  const isSecond = generation === 'two';
  const side = {
    ...BOOKING_PAGE_CONFIG_SIDE_DEFAULTS,
    businessMode: isSecond ? 'team' as const : 'solo' as const,
  };
  const presetBase = isSecond
    ? { presetId: 'collective' as const, recipeVersion: 1 as const }
    : { presetId: 'quick_book' as const, recipeVersion: 1 as const };
  const contentSide = {
    ...BOOKING_PAGE_CONTENT_SIDE_DEFAULTS,
    bio: `Generation ${generation}`,
    locationDisplayMode: isSecond ? 'city_only' as const : 'full_address' as const,
  };

  return {
    unrelated: { retained: true },
    bookingPage: {
      version: 1,
      draft: side,
      live: side,
      draftPresetBase: presetBase,
      livePresetBase: presetBase,
    },
    bookingPageContent: {
      version: 1,
      draft: contentSide,
      live: contentSide,
    },
  } as unknown as CoherentGenerationSettings;
}

function expectLiveGeneration(settings: unknown, generation: 'one' | 'two') {
  const isSecond = generation === 'two';
  const config = resolveBookingPageConfig(settings);
  const content = resolveBookingPageContent(settings);

  expect({
    businessMode: config.live.businessMode,
    presetId: config.livePresetBase?.presetId,
    bio: content.live.bio,
    locationDisplayMode: content.live.locationDisplayMode,
  }).toEqual({
    businessMode: isSecond ? 'team' : 'solo',
    presetId: isSecond ? 'collective' : 'quick_book',
    bio: `Generation ${generation}`,
    locationDisplayMode: isSecond ? 'city_only' : 'full_address',
  });
}

async function applyPreset(salonId: string, presetId: BookingPagePresetId) {
  const config = resolveBookingPageConfig(await readSettings(salonId));
  const state = getBookingPageDraftPresentationState(config);
  const operation = {
    type: 'apply_preset',
    presetId,
    presetVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
    expectedPresentationSignature: getBookingPagePresentationSignature({
      ...state,
      presetBase: state.presetBase ?? null,
    }),
  } as const satisfies BookingPageBuilderOperation;
  const result = applyBookingPageBuilderOperation(state, operation);

  expect(result.ok).toBe(true);

  if (!result.ok) {
    throw new Error(`Expected preset ${presetId} to resolve`);
  }

  return updateBookingPageDraft(salonId, result.patch, { builderOperation: operation });
}

describe('booking-page lifecycle synchronization (PGlite)', () => {
  // Transaction-start gates below prove deterministic application ordering,
  // not genuine row-lock contention. The distinct-session proof lives in
  // bookingPageLifecycle.concurrency.integration.test.ts.
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

  it('leaves a content edit that was already pending at Publish as a new unpublished draft', async () => {
    const salonId = 'lifecycle_publish_pending_content';
    await insertSalon(salonId, coherentGenerationSettings('one'));

    const gate = createFirstTransactionGate(database);
    holder.db = gate.database;
    const pendingContentWrite = updateBookingPageContentDraft(salonId, {
      bio: 'Edit completed after Publish',
    });

    try {
      await gate.transactionWaiting;
      const published = await synchronizeBookingPageLifecycle(salonId, 'publish');
      gate.release();
      await pendingContentWrite;

      expectLiveGeneration(published, 'one');
    } finally {
      gate.release();
      holder.db = database;
      await pendingContentWrite.catch(() => undefined);
    }

    const stored = await readSettings(salonId);
    const content = resolveBookingPageContent(stored);

    expect(content.live.bio).toBe('Generation one');
    expect(content.draft.bio).toBe('Edit completed after Publish');
  });

  it('applies a preset after Publish when its transaction is delayed before starting', async () => {
    const salonId = 'lifecycle_publish_pending_preset';
    await insertSalon(salonId, coherentGenerationSettings('one'));

    const gate = createFirstTransactionGate(database);
    holder.db = gate.database;
    const pendingPresetApply = applyPreset(salonId, 'menu');

    try {
      await gate.transactionWaiting;
      const published = await synchronizeBookingPageLifecycle(salonId, 'publish');
      gate.release();
      const applied = await pendingPresetApply;

      expectLiveGeneration(published, 'one');

      expect(applied?.draftPresetBase?.presetId).toBe('menu');
    } finally {
      gate.release();
      holder.db = database;
      await pendingPresetApply.catch(() => undefined);
    }

    const stored = await readSettings(salonId);
    const config = resolveBookingPageConfig(stored);
    const content = resolveBookingPageContent(stored);

    expect(config.livePresetBase?.presetId).toBe('quick_book');
    expect(config.live.businessMode).toBe('solo');
    expect(content.live.bio).toBe('Generation one');
    expect(config.draftPresetBase?.presetId).toBe('menu');
    expect(config.draft).not.toEqual(config.live);
  });

  it('publishes a preset apply when the Publish transaction is delayed before starting', async () => {
    const salonId = 'lifecycle_preset_before_publish';
    await insertSalon(salonId, coherentGenerationSettings('one'));

    const gate = createFirstTransactionGate(database);
    holder.db = gate.database;
    const pendingPublish = synchronizeBookingPageLifecycle(salonId, 'publish');

    try {
      await gate.transactionWaiting;
      const applied = await applyPreset(salonId, 'menu');
      gate.release();
      const published = await pendingPublish;

      expect(applied?.draftPresetBase?.presetId).toBe('menu');
      expect(resolveBookingPageConfig(published).live).toEqual(applied?.draft);
      expect(resolveBookingPageConfig(published).livePresetBase).toEqual(applied?.draftPresetBase);
    } finally {
      gate.release();
      holder.db = database;
      await pendingPublish.catch(() => undefined);
    }

    const stored = await readSettings(salonId);
    const config = resolveBookingPageConfig(stored);

    expect(config.live).toEqual(config.draft);
    expect(config.livePresetBase).toEqual(config.draftPresetBase);
    expect(config.livePresetBase?.presetId).toBe('menu');
  });

  it('makes a Publish delayed before transaction start read the latest coherent generation', async () => {
    const salonId = 'lifecycle_two_publishes';
    await insertSalon(salonId, coherentGenerationSettings('one'));

    const gate = createFirstTransactionGate(database);
    holder.db = gate.database;
    const firstInvokedPublish = synchronizeBookingPageLifecycle(salonId, 'publish');

    try {
      await gate.transactionWaiting;
      const secondInvokedPublish = await synchronizeBookingPageLifecycle(salonId, 'publish');
      const firstGeneration = coherentGenerationSettings('one');
      const secondGeneration = coherentGenerationSettings('two');

      await database
        .update(schema.salonSchema)
        .set({
          settings: {
            ...firstGeneration,
            bookingPage: {
              ...firstGeneration.bookingPage,
              draft: secondGeneration.bookingPage.draft,
              draftPresetBase: secondGeneration.bookingPage.draftPresetBase,
            },
            bookingPageContent: {
              ...firstGeneration.bookingPageContent,
              draft: secondGeneration.bookingPageContent.draft,
            },
          } as SalonSettings,
        })
        .where(eq(schema.salonSchema.id, salonId));

      gate.release();
      const firstResult = await firstInvokedPublish;

      expectLiveGeneration(secondInvokedPublish, 'one');
      expectLiveGeneration(firstResult, 'two');
    } finally {
      gate.release();
      holder.db = database;
      await firstInvokedPublish.catch(() => undefined);
    }

    expectLiveGeneration(await readSettings(salonId), 'two');
  });

  it('rolls back the whole config, content, and provenance copy after an injected failure', async () => {
    const salonId = 'lifecycle_publish_rollback';
    await insertSalon(salonId, lifecycleSettings());
    const before = await readSettings(salonId);
    let transactionalResult: unknown;
    const rollbackDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return (callback: Parameters<typeof database.transaction>[0]) =>
            database.transaction(async (tx) => {
              transactionalResult = await callback(tx);
              throw new Error('INJECTED_LIFECYCLE_ROLLBACK');
            });
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    holder.db = rollbackDatabase;

    try {
      await expect(synchronizeBookingPageLifecycle(salonId, 'publish'))
        .rejects.toThrow('INJECTED_LIFECYCLE_ROLLBACK');
    } finally {
      holder.db = database;
    }

    const transientConfig = resolveBookingPageConfig(transactionalResult);
    const transientContent = resolveBookingPageContent(transactionalResult);

    expect(transientConfig.live).toEqual(transientConfig.draft);
    expect(transientConfig.livePresetBase).toEqual(transientConfig.draftPresetBase);
    expect(transientContent.live).toEqual(transientContent.draft);
    expect(await readSettings(salonId)).toEqual(before);
  });

  it('commits a combined raw config/content PATCH as one coherent draft operation', async () => {
    const salonId = 'lifecycle_combined_patch';
    await insertSalon(salonId, coherentGenerationSettings('one'));

    const updated = await updateBookingPageDraftState(salonId, {
      config: { businessMode: 'team' },
      content: { bio: 'Combined owner edit' },
    });

    const config = resolveBookingPageConfig(updated);
    const content = resolveBookingPageContent(updated);

    expect(config.draft.businessMode).toBe('team');
    expect(config.live.businessMode).toBe('solo');
    expect(content.draft).toMatchObject({
      bio: 'Combined owner edit',
      locationDisplayMode: 'full_address',
    });
    expect(content.live.bio).toBe('Generation one');
  });

  it('rolls back the first half of a combined PATCH when the second update fails', async () => {
    const salonId = 'lifecycle_combined_patch_rollback';
    await insertSalon(salonId, coherentGenerationSettings('one'));
    const before = await readSettings(salonId);
    let updateCount = 0;
    const rollbackDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return (callback: Parameters<typeof database.transaction>[0]) =>
            database.transaction(tx => callback(new Proxy(tx, {
              get(transaction, transactionProperty, transactionReceiver) {
                const value = Reflect.get(
                  transaction,
                  transactionProperty,
                  transactionReceiver,
                ) as unknown;
                if (transactionProperty === 'update' && typeof value === 'function') {
                  return (...args: unknown[]) => {
                    updateCount += 1;
                    if (updateCount === 2) {
                      throw new Error('INJECTED_COMBINED_PATCH_FAILURE');
                    }
                    return Reflect.apply(value, transaction, args);
                  };
                }
                return typeof value === 'function' ? value.bind(transaction) : value;
              },
            })));
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    holder.db = rollbackDatabase;

    try {
      await expect(updateBookingPageDraftState(salonId, {
        config: { businessMode: 'team' },
        content: { bio: 'Must roll back' },
      })).rejects.toThrow('INJECTED_COMBINED_PATCH_FAILURE');
    } finally {
      holder.db = database;
    }

    expect(updateCount).toBe(2);
    expect(await readSettings(salonId)).toEqual(before);
  });

  it('lets a draft write already pending at Revert become the next unpublished edit', async () => {
    const salonId = 'lifecycle_revert_pending_content';
    const initial = coherentGenerationSettings('one');
    initial.bookingPage.draft = {
      ...initial.bookingPage.draft,
      businessMode: 'team',
    };
    initial.bookingPageContent.draft = {
      ...initial.bookingPageContent.draft,
      bio: 'Draft',
      locationDisplayMode: 'city_only',
    };
    initial.bookingPageContent.live = {
      ...initial.bookingPageContent.live,
      bio: 'Live',
      locationDisplayMode: 'full_address',
    };
    await insertSalon(salonId, initial);

    const gate = createFirstTransactionGate(database);
    holder.db = gate.database;
    const pendingContentWrite = updateBookingPageContentDraft(salonId, {
      bio: 'Edit completed after Revert',
    });

    try {
      await gate.transactionWaiting;
      const reverted = await synchronizeBookingPageLifecycle(salonId, 'revert');
      gate.release();
      await pendingContentWrite;

      expect(resolveBookingPageConfig(reverted).draft.businessMode).toBe('solo');
      expect(resolveBookingPageContent(reverted).draft).toMatchObject({
        bio: 'Live',
        locationDisplayMode: 'full_address',
      });
    } finally {
      gate.release();
      holder.db = database;
      await pendingContentWrite.catch(() => undefined);
    }

    const stored = await readSettings(salonId);
    const config = resolveBookingPageConfig(stored);
    const content = resolveBookingPageContent(stored);

    expect(config.draft).toEqual(config.live);
    expect(config.draftPresetBase).toEqual(config.livePresetBase);
    expect(content.live).toMatchObject({
      bio: 'Live',
      locationDisplayMode: 'full_address',
    });
    expect(content.draft.bio).toBe('Edit completed after Revert');
    expect(content.draft.locationDisplayMode).toBe('full_address');
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
