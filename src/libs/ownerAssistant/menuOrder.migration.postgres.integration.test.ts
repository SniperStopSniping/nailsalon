import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));

const rawUrl = process.env.OWNER_ASSISTANT_TEST_DATABASE_URL ?? '';
const confirmed = process.env.OWNER_ASSISTANT_DISPOSABLE_DATABASE_CONFIRMED === 'true';
const url = rawUrl ? new URL(rawUrl) : null;
const runnable = confirmed && url?.hostname === '127.0.0.1' && url.port === '55439' && url.pathname === '/owner_assistant_disposable';
if (confirmed && !runnable) {
  throw new Error('Owner assistant migration tests require the attested disposable local PostgreSQL database.');
}

const SALON = 'owner_assistant_migration_salon';
const SECOND_SALON = 'owner_assistant_migration_second_salon';
let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function makeHistoricalMigrationFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'owner-assistant-migrations-'));
  const source = path.join(process.cwd(), 'migrations');
  const journal = JSON.parse(await readFile(path.join(source, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
  await Promise.all(journal.entries.slice(0, 78).map(async ({ tag }) => copyFile(path.join(source, `${tag}.sql`), path.join(folder, `${tag}.sql`))));
  await (async () => {
    const meta = path.join(folder, 'meta');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(meta));
    await writeFile(path.join(meta, '_journal.json'), JSON.stringify({ entries: journal.entries.slice(0, 78) }, null, 2));
  })();
  return folder;
}

function databaseUrl(databaseName: string): string {
  const derived = new URL(rawUrl);
  derived.pathname = `/${databaseName}`;
  return derived.toString();
}

async function waitForLock(observer: pg.Client, applicationName: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await observer.query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'`, [applicationName]);
    if (result.rows[0]?.count !== '0') {
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${applicationName} to block on a PostgreSQL lock.`);
}

beforeAll(async () => {
  if (!runnable) {
    return;
  }
  pool = new pg.Pool({ connectionString: rawUrl, max: 8 });
  db = drizzle(pool, { schema });
  holder.db = db;
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
});

beforeEach(async () => {
  if (!runnable) {
    return;
  }
  await pool.query('DELETE FROM salon WHERE id = $1', [SALON]);
  await pool.query('DELETE FROM salon WHERE id = $1', [SECOND_SALON]);
  await pool.query(`INSERT INTO salon (id, name, slug) VALUES ($1, 'Migration Test', $1)`, [SALON]);
  await pool.query(`
    INSERT INTO service (id, salon_id, name, price, duration_minutes, category, booking_category, sort_order)
    VALUES ('migration_svc_a', $1, 'A', 100, 30, 'manicure', 'manicure', 1),
           ('migration_svc_b', $1, 'B', 100, 30, 'manicure', 'manicure', 2)
  `, [SALON]);
});

afterAll(async () => {
  if (runnable) {
    await pool.end();
  }
});

describe.skipIf(!runnable)('owner assistant migration locking contract', () => {
  it('migrates a fresh database and upgrades a historical 0077 database without rewriting services or ledger history', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const freshName = `oa_fresh_${suffix}`;
    const upgradeName = `oa_upgrade_${suffix}`;
    const historicalFolder = await makeHistoricalMigrationFolder();
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    try {
      await pool.query(`CREATE DATABASE ${freshName}`);
      await pool.query(`CREATE DATABASE ${upgradeName}`);
      const freshPool = new pg.Pool({ connectionString: databaseUrl(freshName) });
      const upgradePool = new pg.Pool({ connectionString: databaseUrl(upgradeName) });
      try {
        await migrate(drizzle(freshPool, { schema }), { migrationsFolder: path.join(process.cwd(), 'migrations') });
        const freshLedger = await freshPool.query('SELECT hash FROM drizzle.__drizzle_migrations');
        const journal = JSON.parse(await readFile(path.join(process.cwd(), 'migrations/meta/_journal.json'), 'utf8')) as { entries: unknown[] };

        expect(freshLedger.rowCount).toBe(journal.entries.length);

        const upgradeDb = drizzle(upgradePool, { schema });
        await migrate(upgradeDb, { migrationsFolder: historicalFolder });
        await upgradePool.query(`INSERT INTO salon (id, name, slug) VALUES ('upgrade_salon', 'Upgrade', 'upgrade-salon')`);
        await upgradePool.query(`
          INSERT INTO service (id, salon_id, name, price, duration_minutes, category, booking_category, sort_order)
          VALUES ('upgrade_svc_null', 'upgrade_salon', 'Sparse', 1234, 45, 'manicure', 'manicure', NULL),
                 ('upgrade_svc_ranked', 'upgrade_salon', 'Ranked', 5678, 60, 'pedicure', 'pedicure', 99)
        `);
        const historicalLedger = await upgradePool.query<{ hash: string; created_at: string }>('SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at, hash');
        holder.db = upgradeDb;
        await vi.resetModules();
        const { reorderSalonMenu: historicalReorder } = await import('./menuOrder.server');

        await expect(historicalReorder('upgrade_salon', ['upgrade_svc_null', 'upgrade_svc_ranked'])).resolves.toMatchObject([{ id: 'upgrade_svc_null', sortOrder: 1 }, { id: 'upgrade_svc_ranked', sortOrder: 2 }]);

        await upgradePool.query(`UPDATE service SET sort_order = CASE id WHEN 'upgrade_svc_null' THEN NULL ELSE 99 END WHERE salon_id = 'upgrade_salon'`);
        const beforeService = await upgradePool.query('SELECT * FROM service WHERE salon_id = $1 ORDER BY id', ['upgrade_salon']);
        await migrate(upgradeDb, { migrationsFolder: path.join(process.cwd(), 'migrations') });
        const fullLedger = await upgradePool.query<{ hash: string; created_at: string }>('SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at, hash');
        const afterService = await upgradePool.query('SELECT * FROM service WHERE salon_id = $1 ORDER BY id', ['upgrade_salon']);

        expect(historicalLedger.rows).toHaveLength(78);
        expect(fullLedger.rows.slice(0, historicalLedger.rows.length)).toEqual(historicalLedger.rows);
        expect(fullLedger.rowCount).toBe(journal.entries.length);
        expect(afterService.rows).toEqual(beforeService.rows);

        const revisionBefore = await upgradePool.query<{ revision: string }>(`SELECT revision::text FROM service_menu_revision WHERE salon_id = 'upgrade_salon'`);

        await expect(historicalReorder('upgrade_salon', ['upgrade_svc_null', 'upgrade_svc_ranked'])).resolves.toMatchObject([{ id: 'upgrade_svc_null', sortOrder: 1 }, { id: 'upgrade_svc_ranked', sortOrder: 2 }]);

        await upgradePool.query(`INSERT INTO service (id, salon_id, name, price, duration_minutes, category, booking_category, sort_order) VALUES ('upgrade_svc_direct', 'upgrade_salon', 'Direct', 1, 5, 'manicure', 'manicure', NULL)`);
        await upgradePool.query(`UPDATE service SET name = 'Direct updated' WHERE id = 'upgrade_svc_direct'`);
        await upgradePool.query(`DELETE FROM service WHERE id = 'upgrade_svc_direct'`);
        const revisionAfter = await upgradePool.query<{ revision: string }>(`SELECT revision::text FROM service_menu_revision WHERE salon_id = 'upgrade_salon'`);

        expect(Number(revisionAfter.rows[0]?.revision)).toBe(Number(revisionBefore.rows[0]?.revision ?? '0') + 5);

        await migrate(drizzle(upgradePool, { schema }), { migrationsFolder: path.join(process.cwd(), 'migrations') });

        expect((await upgradePool.query('SELECT hash FROM drizzle.__drizzle_migrations')).rowCount).toBe(journal.entries.length);
      } finally {
        holder.db = db;
        await freshPool.end();
        await upgradePool.end();
      }
    } finally {
      await pool.query(`DROP DATABASE IF EXISTS ${freshName}`);
      await pool.query(`DROP DATABASE IF EXISTS ${upgradeName}`);
      await rm(historicalFolder, { recursive: true, force: true });
    }
  });

  it('records the complete migration ledger once and keeps it stable on rerun', async () => {
    const before = await pool.query<{ hash: string; created_at: string }>('SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at, hash');

    const journal = JSON.parse(await readFile(path.join(process.cwd(), 'migrations/meta/_journal.json'), 'utf8')) as { entries: unknown[] };

    expect(before.rows).toHaveLength(journal.entries.length);

    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    const after = await pool.query<{ hash: string; created_at: string }>('SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at, hash');

    expect(after.rows).toEqual(before.rows);
  });

  it('reproduces the flag-off cross-service writer deadlock introduced by the revision trigger', async () => {
    const writerOne = new pg.Client({ connectionString: rawUrl, application_name: 'owner-assistant-family-writer' });
    const writerTwo = new pg.Client({ connectionString: rawUrl, application_name: 'owner-assistant-single-writer' });
    const observer = new pg.Client({ connectionString: rawUrl, application_name: 'owner-assistant-lock-observer' });
    await writerOne.connect();
    await writerTwo.connect();
    await observer.connect();
    try {
      await writerOne.query('BEGIN');
      await writerOne.query(`UPDATE service SET name = 'A1' WHERE id = 'migration_svc_a'`);
      await writerTwo.query('BEGIN');
      const blockedWriterTwo = writerTwo.query(`UPDATE service SET name = 'B2' WHERE id = 'migration_svc_b'`);
      await waitForLock(observer, 'owner-assistant-single-writer');
      const writerOneSecondUpdate = writerOne.query(`UPDATE service SET name = 'B1' WHERE id = 'migration_svc_b'`);
      const outcomes = await Promise.allSettled([blockedWriterTwo, writerOneSecondUpdate]);
      const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');

      expect(rejected).toHaveLength(1);
      expect((rejected[0]?.reason as { code?: string }).code).toBe('40P01');

      await writerOne.query('ROLLBACK').catch(() => undefined);
      await writerTwo.query('ROLLBACK').catch(() => undefined);
      const rows = await pool.query<{ id: string; name: string }>(`SELECT id, name FROM service WHERE salon_id = $1 ORDER BY id`, [SALON]);

      expect(rows.rows).toEqual([{ id: 'migration_svc_a', name: 'A' }, { id: 'migration_svc_b', name: 'B' }]);
    } finally {
      await writerOne.query('ROLLBACK').catch(() => undefined);
      await writerTwo.query('ROLLBACK').catch(() => undefined);
      await writerOne.end();
      await writerTwo.end();
      await observer.end();
    }
  });

  it('does not deadlock the same ordinary writers when the 0078 trigger is absent', async () => {
    await pool.query('DROP TRIGGER service_menu_revision_bump_trigger ON service');
    const writerOne = new pg.Client({ connectionString: rawUrl, application_name: 'owner-assistant-baseline-family' });
    const writerTwo = new pg.Client({ connectionString: rawUrl, application_name: 'owner-assistant-baseline-single' });
    const observer = new pg.Client({ connectionString: rawUrl, application_name: 'owner-assistant-baseline-observer' });
    await writerOne.connect();
    await writerTwo.connect();
    await observer.connect();
    try {
      await writerOne.query('BEGIN');
      await writerOne.query(`UPDATE service SET name = 'A1' WHERE id = 'migration_svc_a'`);
      await writerTwo.query('BEGIN');
      await writerTwo.query(`UPDATE service SET name = 'B2' WHERE id = 'migration_svc_b'`);
      const writerOneSecondUpdate = writerOne.query(`UPDATE service SET name = 'B1' WHERE id = 'migration_svc_b'`);
      await waitForLock(observer, 'owner-assistant-baseline-family');
      await writerTwo.query('COMMIT');
      await writerOneSecondUpdate;
      await writerOne.query('COMMIT');
      const rows = await pool.query<{ id: string; name: string }>(`SELECT id, name FROM service WHERE salon_id = $1 ORDER BY id`, [SALON]);

      expect(rows.rows).toEqual([{ id: 'migration_svc_a', name: 'A1' }, { id: 'migration_svc_b', name: 'B1' }]);
    } finally {
      await writerOne.query('ROLLBACK').catch(() => undefined);
      await writerTwo.query('ROLLBACK').catch(() => undefined);
      await writerOne.end();
      await writerTwo.end();
      await observer.end();
      await pool.query('CREATE TRIGGER service_menu_revision_bump_trigger AFTER INSERT OR UPDATE OR DELETE ON service FOR EACH ROW EXECUTE FUNCTION service_menu_revision_bump()');
    }
  });

  it('bumps both tenant revisions on reassignment and does not resurrect one during salon cascade', async () => {
    await pool.query(`INSERT INTO salon (id, name, slug) VALUES ($1, 'Second Migration Test', $1)`, [SECOND_SALON]);
    const before = await pool.query<{ salon_id: string; revision: string }>(`SELECT salon_id, revision::text FROM service_menu_revision WHERE salon_id IN ($1, $2) ORDER BY salon_id`, [SALON, SECOND_SALON]);
    await pool.query(`UPDATE service SET salon_id = $1 WHERE id = 'migration_svc_a'`, [SECOND_SALON]);
    const after = await pool.query<{ salon_id: string; revision: string }>(`SELECT salon_id, revision::text FROM service_menu_revision WHERE salon_id IN ($1, $2) ORDER BY salon_id`, [SALON, SECOND_SALON]);

    expect(Number(after.rows.find(row => row.salon_id === SALON)?.revision)).toBe(Number(before.rows.find(row => row.salon_id === SALON)?.revision) + 1);
    expect(Number(after.rows.find(row => row.salon_id === SECOND_SALON)?.revision)).toBe(1);

    await pool.query('DELETE FROM salon WHERE id = $1', [SECOND_SALON]);
    const deletedRevision = await pool.query('SELECT 1 FROM service_menu_revision WHERE salon_id = $1', [SECOND_SALON]);

    expect(deletedRevision.rowCount).toBe(0);
  });

  it('restricts owner deletion while a durable operation exists, then permits it after salon cascade', async () => {
    await pool.query(`INSERT INTO admin_user (id, phone_e164) VALUES ('migration_owner', '+14165550999')`);
    await pool.query(`
      INSERT INTO owner_assistant_menu_operation (id, salon_id, actor_admin_id, idempotency_key, status, base_revision, old_order, new_order)
      VALUES ('migration_receipt', $1, 'migration_owner', 'migration-key', 'ready', 0, '[]'::jsonb, '[]'::jsonb)
    `, [SALON]);

    await expect(pool.query(`DELETE FROM admin_user WHERE id = 'migration_owner'`)).rejects.toMatchObject({ code: '23503' });

    await pool.query('DELETE FROM salon WHERE id = $1', [SALON]);

    await expect(pool.query(`DELETE FROM admin_user WHERE id = 'migration_owner'`)).resolves.toMatchObject({ rowCount: 1 });
  });
});
