/**
 * Genuine-PostgreSQL proof for booking-page Publish row serialization.
 * Revert uses the same production lock/update primitive and has deterministic
 * ordering plus rollback coverage in bookingPageLifecycle.test.ts.
 *
 * PGlite has one physical session, so it can prove transactional correctness
 * but not row-lock contention. This suite runs only against the repository's
 * strictly attested disposable DATABASE_URL and uses distinct pool sessions.
 * Its gate pauses the first production transaction only after its
 * `SELECT ... FOR UPDATE` has returned, leaving that row lock held while the
 * competing production transaction enters PostgreSQL and is observed waiting.
 *
 *   LUSTER_DISPOSABLE_DATABASE=true \
 *   CONCURRENCY_TEST_DATABASE_URL='<attested disposable PostgreSQL URL>' \
 *     npx vitest run --no-file-parallelism src/libs/bookingPageLifecycle.concurrency.integration.test.ts
 */
import path from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attestDisposableDatabaseSession,
  type DisposableDatabaseTarget,
  requireDisposableDatabaseTarget,
  resolveDisposableDatabaseServerExpectation,
} from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

const REQUIRED = process.env.BOOKING_PAGE_LIFECYCLE_CONCURRENCY_REQUIRED === 'true';
// This suite must never infer the shared browser fixture database merely from
// LUSTER_DISPOSABLE_DATABASE. Its genuine lock proof is an explicit lane: the
// caller supplies the attested target and may fail-close with REQUIRED. Normal
// changed-source/full-Vitest jobs therefore collect this file but skip it.
const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
let disposableTarget: DisposableDatabaseTarget | null = null;
if (RAW_URL) {
  disposableTarget = requireDisposableDatabaseTarget({
    ...process.env,
    DATABASE_URL: RAW_URL,
  });
} else if (REQUIRED) {
  throw new TypeError(
    'Booking-page lifecycle PostgreSQL concurrency is required, but no disposable target is available.',
  );
}

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
import { synchronizeBookingPageLifecycle } from './bookingPageLifecycle';
import {
  BOOKING_PAGE_PRESET_RECIPE_VERSION,
  type BookingPagePresetId,
  getBookingPagePresentationSignature,
} from './bookingPagePresetRecipes';
/* eslint-enable import/first */

type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;
type TestTransaction = Parameters<Parameters<TestDatabase['transaction']>[0]>[0];
type TransactionCallback = Parameters<TestDatabase['transaction']>[0];

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

const SALON_ID = 'booking_page_lifecycle_concurrency';
const EXPECTED_EXECUTED_TESTS = 10;

let pool: pg.Pool;
let database: TestDatabase;
let databaseReady = false;
let executedTests = 0;

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  const withRows = result as { rows?: unknown } | null;
  return Array.isArray(withRows?.rows) ? withRows.rows as T[] : [];
}

function wrapAwaitableSelectWithPause<T extends object>(
  value: T,
  pause: () => Promise<void>,
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
            await pause();
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
          return wrapAwaitableSelectWithPause(result as object, pause);
        }
        return result;
      };
    },
  });
}

function pauseFirstSelect(
  transaction: TestTransaction,
  pause: () => Promise<void>,
): TestTransaction {
  let firstSelect = true;

  return new Proxy(transaction, {
    get(target, property) {
      const member = Reflect.get(target, property, target) as unknown;
      if (property === 'select' && typeof member === 'function' && firstSelect) {
        firstSelect = false;
        return (...args: unknown[]) => wrapAwaitableSelectWithPause(
          Reflect.apply(member, target, args) as object,
          pause,
        );
      }
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

/** Pauses the first production transaction after its locked row snapshot resolves. */
function createFirstLockedSelectGate(targetDatabase: TestDatabase) {
  let firstTransaction = true;
  let announceLockHeld = (_pid: number) => {};
  let releaseLock = () => {};
  const lockHeld = new Promise<number>((resolve) => {
    announceLockHeld = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseLock = resolve;
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
            const callback = args[0] as TransactionCallback;
            return Reflect.apply(member, target, [
              async (transaction: TestTransaction) => {
                const pidResult = await transaction.execute(sql`
                  SELECT pg_backend_pid()::int AS pid
                `);
                const pid = Number(resultRows<{ pid: number }>(pidResult)[0]?.pid);
                if (!Number.isInteger(pid)) {
                  throw new TypeError('Could not identify the lock-holding PostgreSQL session.');
                }

                return callback(pauseFirstSelect(transaction, async () => {
                  announceLockHeld(pid);
                  await released;
                }));
              },
              ...args.slice(1),
            ]);
          };
        }
        return typeof member === 'function' ? member.bind(target) : member;
      },
    }) as TestDatabase,
    lockHeld,
    release: () => releaseLock(),
  };
}

async function waitForLockHeld(
  lockHeld: Promise<number>,
  label: string,
): Promise<number> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lockHeld,
      new Promise<number>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} did not acquire its locked snapshot.`)),
          10_000,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function waitForProductionForUpdateWait({
  lockHolderPid,
  secondSettled,
}: {
  lockHolderPid: number;
  secondSettled: () => boolean;
}): Promise<number | null> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const waiting = await pool.query<{ pid: number }>(`
      SELECT activity.pid::int AS pid
      FROM pg_stat_activity AS activity
      WHERE activity.datname = current_database()
        AND activity.application_name = $1
        AND activity.pid <> $2
        AND activity.backend_type = 'client backend'
        AND activity.wait_event_type = 'Lock'
        AND activity.query ~* 'for[[:space:]]+update'
      ORDER BY activity.pid
      LIMIT 1
    `, [disposableTarget!.applicationName, lockHolderPid]);
    const waitingPid = waiting.rows[0]?.pid;
    if (waitingPid !== undefined) {
      return waitingPid;
    }
    if (secondSettled()) {
      return null;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('The competing lifecycle transaction neither waited on a row lock nor settled.');
}

async function waitForPidBlockedBy(
  blockedPid: number,
  blockerPid: number,
): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const result = await pool.query<{ blocked: boolean }>(`
      SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked
    `, [blockedPid, blockerPid]);
    if (result.rows[0]?.blocked) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`PostgreSQL session ${blockedPid} did not block behind ${blockerPid}.`);
}

function observeSettlement<T>(promise: Promise<T>, settle: () => void): void {
  void promise.then(settle, settle);
}

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

function divergentDraftLiveSettings(): CoherentGenerationSettings {
  const settings = coherentGenerationSettings('one');
  settings.bookingPageContent.draft = {
    ...BOOKING_PAGE_CONTENT_SIDE_DEFAULTS,
    bio: 'Draft',
    locationDisplayMode: 'city_only',
  };
  settings.bookingPageContent.live = {
    ...BOOKING_PAGE_CONTENT_SIDE_DEFAULTS,
    bio: 'Live',
    locationDisplayMode: 'full_address',
  };
  return settings;
}

async function seedSettings(settings: CoherentGenerationSettings): Promise<void> {
  await database
    .update(schema.salonSchema)
    .set({ settings })
    .where(eq(schema.salonSchema.id, SALON_ID));
}

function createRollbackAfterCallbackDatabase(targetDatabase: TestDatabase): TestDatabase {
  let firstTransaction = true;

  return new Proxy(targetDatabase, {
    get(target, property) {
      const member = Reflect.get(target, property, target) as unknown;
      if (property === 'transaction' && typeof member === 'function') {
        return (...args: unknown[]) => {
          if (!firstTransaction) {
            return Reflect.apply(member, target, args);
          }

          firstTransaction = false;
          const callback = args[0] as TransactionCallback;
          return Reflect.apply(member, target, [
            async (transaction: TestTransaction) => {
              await callback(transaction);
              throw new Error('Injected failure after the content write.');
            },
            ...args.slice(1),
          ]);
        };
      }
      return typeof member === 'function' ? member.bind(target) : member;
    },
  }) as TestDatabase;
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

async function readSettings(): Promise<unknown> {
  const [row] = await database
    .select({ settings: schema.salonSchema.settings })
    .from(schema.salonSchema)
    .where(eq(schema.salonSchema.id, SALON_ID));

  return row?.settings;
}

async function applyPreset(presetId: BookingPagePresetId) {
  const config = resolveBookingPageConfig(await readSettings());
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
    throw new Error(`Expected preset ${presetId} to resolve.`);
  }

  return updateBookingPageDraft(SALON_ID, result.patch, { builderOperation: operation });
}

const suite = disposableTarget ? describe.sequential : describe.skip;

suite('booking-page lifecycle — genuine PostgreSQL row-lock serialization', () => {
  beforeAll(async () => {
    if (!disposableTarget) {
      throw new Error('Disposable target unexpectedly absent inside the active lifecycle suite.');
    }

    pool = new pg.Pool({
      connectionString: disposableTarget.connectionString,
      max: 12,
    });
    const attestationClient = await pool.connect();
    try {
      await attestDisposableDatabaseSession(
        attestationClient,
        disposableTarget,
        resolveDisposableDatabaseServerExpectation(disposableTarget),
      );
    } finally {
      attestationClient.release();
    }

    database = drizzle(pool, { schema });
    holder.db = database;
    await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    databaseReady = true;
  }, 120_000);

  beforeEach(async () => {
    holder.db = database;
    await database
      .delete(schema.salonSchema)
      .where(eq(schema.salonSchema.id, SALON_ID));
    await database.insert(schema.salonSchema).values({
      id: SALON_ID,
      name: 'Booking Page Lifecycle Concurrency',
      slug: SALON_ID,
      settings: coherentGenerationSettings('one'),
    });
  });

  afterAll(async () => {
    try {
      if (databaseReady) {
        await database
          .delete(schema.salonSchema)
          .where(eq(schema.salonSchema.id, SALON_ID));
      }
    } finally {
      if (pool) {
        await pool.end();
      }
    }

    expect(executedTests).toBe(EXPECTED_EXECUTED_TESTS);

    process.stdout.write(
      `BOOKING_PAGE_LIFECYCLE_POSTGRES_TESTS_EXECUTED=${executedTests} BOOKING_PAGE_LIFECYCLE_POSTGRES_TESTS_SKIPPED=0\n`,
    );
  });

  it('makes Publish wait for a preset apply lock and then publishes that preset', async () => {
    executedTests += 1;
    const gate = createFirstLockedSelectGate(database);
    holder.db = gate.database;
    const presetApply = applyPreset('menu');
    let publish: Promise<unknown | null> | undefined;

    try {
      const lockHolderPid = await waitForLockHeld(gate.lockHeld, 'Preset apply');
      let publishSettled = false;
      publish = synchronizeBookingPageLifecycle(SALON_ID, 'publish');
      observeSettlement(publish, () => {
        publishSettled = true;
      });

      const waitingPid = await waitForProductionForUpdateWait({
        lockHolderPid,
        secondSettled: () => publishSettled,
      });

      expect(waitingPid).not.toBeNull();
      expect(waitingPid).not.toBe(lockHolderPid);

      gate.release();
      const [applied, published] = await Promise.all([presetApply, publish]);
      const publishedConfig = resolveBookingPageConfig(published);

      expect(applied?.draftPresetBase?.presetId).toBe('menu');
      expect(publishedConfig.live).toEqual(applied?.draft);
      expect(publishedConfig.livePresetBase).toEqual(applied?.draftPresetBase);
      expect(resolveBookingPageContent(published).live.bio).toBe('Generation one');
      expect(resolveBookingPageConfig(await readSettings()).livePresetBase?.presetId).toBe('menu');
    } finally {
      gate.release();
      await Promise.allSettled([
        presetApply,
        ...(publish ? [publish] : []),
      ]);
      holder.db = database;
    }
  }, 30_000);

  it('makes preset apply wait for a Publish lock and leaves that later preset unpublished', async () => {
    executedTests += 1;
    const gate = createFirstLockedSelectGate(database);
    holder.db = gate.database;
    const publish = synchronizeBookingPageLifecycle(SALON_ID, 'publish');
    let presetApply: ReturnType<typeof applyPreset> | undefined;

    try {
      const lockHolderPid = await waitForLockHeld(gate.lockHeld, 'Publish');
      let presetSettled = false;
      presetApply = applyPreset('menu');
      observeSettlement(presetApply, () => {
        presetSettled = true;
      });

      const waitingPid = await waitForProductionForUpdateWait({
        lockHolderPid,
        secondSettled: () => presetSettled,
      });

      expect(waitingPid).not.toBeNull();
      expect(waitingPid).not.toBe(lockHolderPid);

      gate.release();
      const [published, applied] = await Promise.all([publish, presetApply]);
      const stored = await readSettings();
      const storedConfig = resolveBookingPageConfig(stored);

      expectLiveGeneration(published, 'one');

      expect(applied?.draftPresetBase?.presetId).toBe('menu');
      expect(storedConfig.livePresetBase?.presetId).toBe('quick_book');
      expect(storedConfig.draftPresetBase?.presetId).toBe('menu');
      expect(storedConfig.live).not.toEqual(storedConfig.draft);

      expectLiveGeneration(stored, 'one');
    } finally {
      gate.release();
      await Promise.allSettled([
        publish,
        ...(presetApply ? [presetApply] : []),
      ]);
      holder.db = database;
    }
  }, 30_000);

  it('makes a second Publish wait and copy one coherent newer draft snapshot', async () => {
    executedTests += 1;
    const gate = createFirstLockedSelectGate(database);
    holder.db = gate.database;
    const firstPublish = synchronizeBookingPageLifecycle(SALON_ID, 'publish');
    const secondGeneration = coherentGenerationSettings('two');
    let draftWriter: pg.PoolClient | undefined;
    let draftWriterTransactionOpen = false;
    let draftUpdate: Promise<pg.QueryResult> | undefined;
    let secondPublish: Promise<unknown | null> | undefined;

    try {
      const lockHolderPid = await waitForLockHeld(gate.lockHeld, 'First Publish');

      draftWriter = await pool.connect();
      await draftWriter.query('BEGIN');
      draftWriterTransactionOpen = true;
      const writerPidResult = await draftWriter.query<{ pid: number }>(
        'SELECT pg_backend_pid()::int AS pid',
      );
      const writerPid = writerPidResult.rows[0]?.pid;
      if (writerPid === undefined) {
        throw new Error('Could not identify the queued draft-writer PostgreSQL session.');
      }

      draftUpdate = draftWriter.query(`
        UPDATE salon
        SET settings = jsonb_set(
          jsonb_set(
            jsonb_set(
              settings,
              '{bookingPage,draft}',
              $2::jsonb
            ),
            '{bookingPage,draftPresetBase}',
            $3::jsonb
          ),
          '{bookingPageContent,draft}',
          $4::jsonb
        )
        WHERE id = $1
      `, [
        SALON_ID,
        JSON.stringify(secondGeneration.bookingPage.draft),
        JSON.stringify(secondGeneration.bookingPage.draftPresetBase),
        JSON.stringify(secondGeneration.bookingPageContent.draft),
      ]);
      await waitForPidBlockedBy(writerPid, lockHolderPid);

      let secondPublishSettled = false;
      secondPublish = synchronizeBookingPageLifecycle(SALON_ID, 'publish');
      observeSettlement(secondPublish, () => {
        secondPublishSettled = true;
      });
      const waitingPid = await waitForProductionForUpdateWait({
        lockHolderPid,
        secondSettled: () => secondPublishSettled,
      });

      expect(waitingPid).not.toBeNull();
      expect(waitingPid).not.toBe(lockHolderPid);

      gate.release();
      const firstResult = await firstPublish;
      await draftUpdate;
      await draftWriter.query('COMMIT');
      draftWriterTransactionOpen = false;
      const secondResult = await secondPublish;

      expectLiveGeneration(firstResult, 'one');
      expectLiveGeneration(secondResult, 'two');
      expectLiveGeneration(await readSettings(), 'two');
    } finally {
      gate.release();
      if (draftUpdate) {
        await draftUpdate.catch(() => undefined);
      }
      if (draftWriter && draftWriterTransactionOpen) {
        await draftWriter.query('ROLLBACK').catch(() => undefined);
      }
      draftWriter?.release();
      await Promise.allSettled([
        firstPublish,
        ...(secondPublish ? [secondPublish] : []),
      ]);
      holder.db = database;
    }
  }, 30_000);

  it('makes a content PATCH wait for Revert and preserve every post-Revert sibling', async () => {
    executedTests += 1;
    await seedSettings(divergentDraftLiveSettings());

    const gate = createFirstLockedSelectGate(database);
    holder.db = gate.database;
    const revert = synchronizeBookingPageLifecycle(SALON_ID, 'revert');
    let contentPatch: ReturnType<typeof updateBookingPageContentDraft> | undefined;

    try {
      const lockHolderPid = await waitForLockHeld(gate.lockHeld, 'Revert');
      let contentPatchSettled = false;
      contentPatch = updateBookingPageContentDraft(SALON_ID, {
        bio: 'Edit completed after Revert',
      });
      observeSettlement(contentPatch, () => {
        contentPatchSettled = true;
      });

      const waitingPid = await waitForProductionForUpdateWait({
        lockHolderPid,
        secondSettled: () => contentPatchSettled,
      });

      expect(waitingPid).not.toBeNull();
      expect(waitingPid).not.toBe(lockHolderPid);

      gate.release();
      const [reverted, patched] = await Promise.all([revert, contentPatch]);
      const revertedContent = resolveBookingPageContent(reverted);
      const storedContent = resolveBookingPageContent(await readSettings());

      expect(revertedContent.draft).toEqual(revertedContent.live);
      expect(revertedContent.draft).toMatchObject({
        bio: 'Live',
        locationDisplayMode: 'full_address',
      });
      expect(patched?.draft).toMatchObject({
        bio: 'Edit completed after Revert',
        locationDisplayMode: 'full_address',
      });
      expect(storedContent.draft).toEqual(patched?.draft);
      expect(storedContent.live).toEqual(revertedContent.live);
    } finally {
      gate.release();
      await Promise.allSettled([
        revert,
        ...(contentPatch ? [contentPatch] : []),
      ]);
      holder.db = database;
    }
  }, 30_000);

  it('publishes the coherent patched draft when content PATCH acquires the lock first', async () => {
    executedTests += 1;
    await seedSettings(divergentDraftLiveSettings());

    const gate = createFirstLockedSelectGate(database);
    holder.db = gate.database;
    const contentPatch = updateBookingPageContentDraft(SALON_ID, {
      bio: 'Patched before Publish',
    });
    let publish: Promise<unknown | null> | undefined;

    try {
      const lockHolderPid = await waitForLockHeld(gate.lockHeld, 'Content PATCH');
      let publishSettled = false;
      publish = synchronizeBookingPageLifecycle(SALON_ID, 'publish');
      observeSettlement(publish, () => {
        publishSettled = true;
      });

      const waitingPid = await waitForProductionForUpdateWait({
        lockHolderPid,
        secondSettled: () => publishSettled,
      });

      expect(waitingPid).not.toBeNull();
      expect(waitingPid).not.toBe(lockHolderPid);

      gate.release();
      const [patched, published] = await Promise.all([contentPatch, publish]);
      const publishedContent = resolveBookingPageContent(published);
      const storedContent = resolveBookingPageContent(await readSettings());

      expect(patched?.draft).toMatchObject({
        bio: 'Patched before Publish',
        locationDisplayMode: 'city_only',
      });
      expect(publishedContent.live).toEqual(patched?.draft);
      expect(storedContent.live).toEqual(storedContent.draft);
      expect(storedContent.live).toEqual(publishedContent.live);
    } finally {
      gate.release();
      await Promise.allSettled([
        contentPatch,
        ...(publish ? [publish] : []),
      ]);
      holder.db = database;
    }
  }, 30_000);

  it('leaves the later content PATCH as one coherent unpublished edit when Publish locks first', async () => {
    executedTests += 1;
    await seedSettings(divergentDraftLiveSettings());

    const gate = createFirstLockedSelectGate(database);
    holder.db = gate.database;
    const publish = synchronizeBookingPageLifecycle(SALON_ID, 'publish');
    let contentPatch: ReturnType<typeof updateBookingPageContentDraft> | undefined;

    try {
      const lockHolderPid = await waitForLockHeld(gate.lockHeld, 'Publish');
      let contentPatchSettled = false;
      contentPatch = updateBookingPageContentDraft(SALON_ID, {
        bio: 'Patched after Publish',
      });
      observeSettlement(contentPatch, () => {
        contentPatchSettled = true;
      });

      const waitingPid = await waitForProductionForUpdateWait({
        lockHolderPid,
        secondSettled: () => contentPatchSettled,
      });

      expect(waitingPid).not.toBeNull();
      expect(waitingPid).not.toBe(lockHolderPid);

      gate.release();
      const [published, patched] = await Promise.all([publish, contentPatch]);
      const publishedContent = resolveBookingPageContent(published);
      const storedContent = resolveBookingPageContent(await readSettings());

      expect(publishedContent.live).toMatchObject({
        bio: 'Draft',
        locationDisplayMode: 'city_only',
      });
      expect(patched?.draft).toMatchObject({
        bio: 'Patched after Publish',
        locationDisplayMode: 'city_only',
      });
      expect(storedContent.live).toEqual(publishedContent.live);
      expect(storedContent.draft).toEqual(patched?.draft);
      expect(storedContent.draft).not.toEqual(storedContent.live);
    } finally {
      gate.release();
      await Promise.allSettled([
        publish,
        ...(contentPatch ? [contentPatch] : []),
      ]);
      holder.db = database;
    }
  }, 30_000);

  it('serializes preset apply after content PATCH without losing presentation or owner content', async () => {
    executedTests += 1;
    await seedSettings(divergentDraftLiveSettings());

    const gate = createFirstLockedSelectGate(database);
    holder.db = gate.database;
    const contentPatch = updateBookingPageContentDraft(SALON_ID, {
      bio: 'Content before preset',
    });
    let presetApply: ReturnType<typeof applyPreset> | undefined;

    try {
      const lockHolderPid = await waitForLockHeld(gate.lockHeld, 'Content PATCH');
      let presetSettled = false;
      presetApply = applyPreset('menu');
      observeSettlement(presetApply, () => {
        presetSettled = true;
      });

      const waitingPid = await waitForProductionForUpdateWait({
        lockHolderPid,
        secondSettled: () => presetSettled,
      });

      expect(waitingPid).not.toBeNull();
      expect(waitingPid).not.toBe(lockHolderPid);

      gate.release();
      const [patched, applied] = await Promise.all([contentPatch, presetApply]);
      const stored = await readSettings();
      const storedConfig = resolveBookingPageConfig(stored);
      const storedContent = resolveBookingPageContent(stored);

      expect(applied?.draftPresetBase?.presetId).toBe('menu');
      expect(storedConfig.draftPresetBase?.presetId).toBe('menu');
      expect(storedConfig.livePresetBase?.presetId).toBe('quick_book');
      expect(storedContent.draft).toEqual(patched?.draft);
      expect(storedContent.draft).toMatchObject({
        bio: 'Content before preset',
        locationDisplayMode: 'city_only',
      });
      expect(storedContent.live).toMatchObject({
        bio: 'Live',
        locationDisplayMode: 'full_address',
      });
    } finally {
      gate.release();
      await Promise.allSettled([
        contentPatch,
        ...(presetApply ? [presetApply] : []),
      ]);
      holder.db = database;
    }
  }, 30_000);

  it('serializes content PATCH after preset apply without losing presentation or owner content', async () => {
    executedTests += 1;
    await seedSettings(divergentDraftLiveSettings());

    const gate = createFirstLockedSelectGate(database);
    holder.db = gate.database;
    const presetApply = applyPreset('menu');
    let contentPatch: ReturnType<typeof updateBookingPageContentDraft> | undefined;

    try {
      const lockHolderPid = await waitForLockHeld(gate.lockHeld, 'Preset apply');
      let contentPatchSettled = false;
      contentPatch = updateBookingPageContentDraft(SALON_ID, {
        bio: 'Content after preset',
      });
      observeSettlement(contentPatch, () => {
        contentPatchSettled = true;
      });

      const waitingPid = await waitForProductionForUpdateWait({
        lockHolderPid,
        secondSettled: () => contentPatchSettled,
      });

      expect(waitingPid).not.toBeNull();
      expect(waitingPid).not.toBe(lockHolderPid);

      gate.release();
      const [applied, patched] = await Promise.all([presetApply, contentPatch]);
      const stored = await readSettings();
      const storedConfig = resolveBookingPageConfig(stored);
      const storedContent = resolveBookingPageContent(stored);

      expect(applied?.draftPresetBase?.presetId).toBe('menu');
      expect(storedConfig.draftPresetBase?.presetId).toBe('menu');
      expect(storedConfig.livePresetBase?.presetId).toBe('quick_book');
      expect(storedContent.draft).toEqual(patched?.draft);
      expect(storedContent.draft).toMatchObject({
        bio: 'Content after preset',
        locationDisplayMode: 'city_only',
      });
      expect(storedContent.live).toMatchObject({
        bio: 'Live',
        locationDisplayMode: 'full_address',
      });
    } finally {
      gate.release();
      await Promise.allSettled([
        presetApply,
        ...(contentPatch ? [contentPatch] : []),
      ]);
      holder.db = database;
    }
  }, 30_000);

  it('serializes disjoint content PATCHes so neither can resurrect a stale sibling', async () => {
    executedTests += 1;
    await seedSettings(divergentDraftLiveSettings());

    const gate = createFirstLockedSelectGate(database);
    holder.db = gate.database;
    const bioPatch = updateBookingPageContentDraft(SALON_ID, {
      bio: 'First session bio',
    });
    let locationPatch: ReturnType<typeof updateBookingPageContentDraft> | undefined;

    try {
      const lockHolderPid = await waitForLockHeld(gate.lockHeld, 'First content PATCH');
      let locationPatchSettled = false;
      locationPatch = updateBookingPageContentDraft(SALON_ID, {
        locationDisplayMode: 'full_address',
      });
      observeSettlement(locationPatch, () => {
        locationPatchSettled = true;
      });

      const waitingPid = await waitForProductionForUpdateWait({
        lockHolderPid,
        secondSettled: () => locationPatchSettled,
      });

      expect(waitingPid).not.toBeNull();
      expect(waitingPid).not.toBe(lockHolderPid);

      gate.release();
      const [bioResult, locationResult] = await Promise.all([bioPatch, locationPatch]);
      const storedContent = resolveBookingPageContent(await readSettings());

      expect(bioResult?.draft).toMatchObject({
        bio: 'First session bio',
        locationDisplayMode: 'city_only',
      });
      expect(locationResult?.draft).toMatchObject({
        bio: 'First session bio',
        locationDisplayMode: 'full_address',
      });
      expect(storedContent.draft).toEqual(locationResult?.draft);
      expect(storedContent.live).toMatchObject({
        bio: 'Live',
        locationDisplayMode: 'full_address',
      });
    } finally {
      gate.release();
      await Promise.allSettled([
        bioPatch,
        ...(locationPatch ? [locationPatch] : []),
      ]);
      holder.db = database;
    }
  }, 30_000);

  it('rolls back the complete content PATCH transaction when failure is injected before commit', async () => {
    executedTests += 1;
    await seedSettings(divergentDraftLiveSettings());
    const before = await readSettings();

    holder.db = createRollbackAfterCallbackDatabase(database);
    try {
      await expect(updateBookingPageContentDraft(SALON_ID, {
        bio: 'Must roll back',
        locationDisplayMode: 'full_address',
      })).rejects.toThrow('Injected failure after the content write.');
    } finally {
      holder.db = database;
    }

    expect(await readSettings()).toEqual(before);
  }, 30_000);
});
