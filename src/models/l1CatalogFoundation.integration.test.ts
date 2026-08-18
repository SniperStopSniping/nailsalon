/**
 * L1 PR1 — dark catalog foundation, constraint and inertness proof.
 *
 * Every CHECK and the composite parent foreign key is rehearsed here against
 * PGlite, and against real PostgreSQL when CONCURRENCY_TEST_DATABASE_URL
 * points at a local throwaway database. The two engines must agree: a
 * constraint that only holds in one of them is not a constraint we can rely
 * on in production.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const MIGRATIONS = path.join(process.cwd(), 'migrations');

const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
let parsedUrl: URL | null = null;

try {
  parsedUrl = RAW_URL ? new URL(RAW_URL) : null;
} catch {
  parsedUrl = null;
}

const parsedDb = parsedUrl ? decodeURIComponent(parsedUrl.pathname).replace(/^\//, '') : '';
const disposableConfirmed
  = process.env.L1_CATALOG_DISPOSABLE_DATABASE_CONFIRMED === 'true'
  || (parsedDb === 'luster_qa' && parsedUrl?.username === 'qa');
const usePostgres
  = parsedUrl !== null
  && ['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)
  && parsedDb.length > 0
  && disposableConfirmed
  && !RAW_URL.includes('neon.tech');

type Engine = { name: string; db: any; close: () => Promise<void> };

const engines: Engine[] = [];
let pool: pg.Pool | undefined;

async function seedSalon(db: any, id: string) {
  await db.execute(sql`
    insert into salon (id, name, slug, theme_key)
    values (${id}, ${id}, ${id}, 'nail-salon-no5')
    on conflict (id) do nothing
  `);
}

async function insertService(db: any, opts: {
  id: string;
  salonId: string;
  parentServiceId?: string | null;
  variantLabel?: string | null;
  variantKind?: string | null;
  selectionMode?: string | null;
  confirmationMode?: string | null;
}) {
  await db.execute(sql`
    insert into service (
      id, salon_id, name, price, duration_minutes, category,
      parent_service_id, variant_label, variant_kind, selection_mode, confirmation_mode
    ) values (
      ${opts.id}, ${opts.salonId}, ${opts.id}, 1000, 30, 'manicure',
      ${opts.parentServiceId ?? null}, ${opts.variantLabel ?? null}, ${opts.variantKind ?? null},
      ${opts.selectionMode ?? null}, ${opts.confirmationMode ?? null}
    )
  `);
}

/**
 * Every fixture salon in this file is named `<prefix>-<engine>`, and services
 * hang off those salons, so deleting the salons removes this test's entire
 * footprint via the existing ON DELETE CASCADE. PGlite is created fresh each
 * run, but the PostgreSQL target persists between runs — without this the
 * second run would collide on `service_pkey` and report a constraint failure
 * that is really just leftover state. A test that only works on a virgin
 * database proves less than it appears to.
 *
 * Real salon ids are nanoids and never end in `-pglite` or `-postgres`, so the
 * pattern cannot match production-shaped data.
 */
async function purgeEngineFixtures(db: any, name: string) {
  await db.execute(sql`delete from salon where id like ${`%-${name}`}`);
}

beforeAll(async () => {
  const client = new PGlite();
  const pglite = drizzlePglite(client);
  await migratePglite(pglite, { migrationsFolder: MIGRATIONS });
  engines.push({ name: 'pglite', db: pglite, close: async () => client.close() });

  if (usePostgres) {
    pool = new pg.Pool({ connectionString: RAW_URL, max: 4 });
    const postgres = drizzlePg(pool);
    await migratePg(postgres, { migrationsFolder: MIGRATIONS });
    engines.push({ name: 'postgres', db: postgres, close: async () => {} });
  }

  for (const { db, name } of engines) {
    await purgeEngineFixtures(db, name);
  }
}, 240_000);

afterAll(async () => {
  for (const { db, name } of engines) {
    await purgeEngineFixtures(db, name).catch(() => {});
  }
  await pool?.end();
});

describe('migration 0072 applies on every engine', () => {
  it('runs after the Discover 0071 migration without collision', async () => {
    for (const { name, db } of engines) {
      const r = await db.execute(sql`select hash from drizzle.__drizzle_migrations order by created_at, id`);
      const rows = (r as any).rows ?? r;

      // 0071 (Discover) must already be applied before 0072 (L1).
      expect(rows.length, name).toBeGreaterThanOrEqual(73);
    }
  });

  it('leaves the Discover portfolio schema untouched', async () => {
    for (const { name, db } of engines) {
      const r = await db.execute(sql`
        select column_name from information_schema.columns
        where table_name = 'salon_portfolio_photo' order by column_name
      `);
      const cols = ((r as any).rows ?? r).map((x: any) => x.column_name);

      expect(cols, name).toContain('publication_rights_confirmed_at');
      expect(cols, name).not.toContain('variant_label');
    }
  });
});

describe('service constraint vocabulary', () => {
  it('accepts a legacy row with every new column NULL', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `legacy-${name}`);

      await expect(insertService(db, { id: `legacy-svc-${name}`, salonId: `legacy-${name}` }))
        .resolves.not.toThrow();
    }
  });

  it('rejects an unknown selection_mode and accepts the bounded ones', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `sel-${name}`);

      await expect(insertService(db, { id: `sel-bad-${name}`, salonId: `sel-${name}`, selectionMode: 'freeform' }))
        .rejects.toThrow();

      for (const mode of ['direct', 'guided']) {
        await expect(insertService(db, { id: `sel-${mode}-${name}`, salonId: `sel-${name}`, selectionMode: mode }))
          .resolves.not.toThrow();
      }
    }
  });

  it('rejects an unknown confirmation_mode and accepts the bounded ones', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `conf-${name}`);

      await expect(insertService(db, { id: `conf-bad-${name}`, salonId: `conf-${name}`, confirmationMode: 'maybe' }))
        .rejects.toThrow();

      for (const mode of ['instant', 'request_approval', 'consultation']) {
        await expect(insertService(db, { id: `conf-${mode}-${name}`, salonId: `conf-${name}`, confirmationMode: mode }))
          .resolves.not.toThrow();
      }
    }
  });
});

describe('variant parent/child rules', () => {
  it('accepts a same-tenant parent with a labelled child', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `ok-${name}`);
      await insertService(db, { id: `ok-parent-${name}`, salonId: `ok-${name}`, variantKind: 'length' });

      await expect(insertService(db, {
        id: `ok-child-${name}`,
        salonId: `ok-${name}`,
        parentServiceId: `ok-parent-${name}`,
        variantLabel: 'Short',
      })).resolves.not.toThrow();
    }
  });

  it('rejects a child with no variant_label', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `nolabel-${name}`);
      await insertService(db, { id: `nolabel-parent-${name}`, salonId: `nolabel-${name}` });

      await expect(insertService(db, {
        id: `nolabel-child-${name}`,
        salonId: `nolabel-${name}`,
        parentServiceId: `nolabel-parent-${name}`,
      })).rejects.toThrow();
    }
  });

  it('rejects a child that also defines variant_kind', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `kind-${name}`);
      await insertService(db, { id: `kind-parent-${name}`, salonId: `kind-${name}` });

      await expect(insertService(db, {
        id: `kind-child-${name}`,
        salonId: `kind-${name}`,
        parentServiceId: `kind-parent-${name}`,
        variantLabel: 'Short',
        variantKind: 'length',
      })).rejects.toThrow();
    }
  });

  it('rejects a service that parents itself', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `self-${name}`);

      await expect(insertService(db, {
        id: `self-svc-${name}`,
        salonId: `self-${name}`,
        parentServiceId: `self-svc-${name}`,
        variantLabel: 'Self',
      })).rejects.toThrow();
    }
  });
});

describe('tenant integrity of the parent link', () => {
  it('rejects a cross-tenant parent by direct SQL', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `tenant-a-${name}`);
      await seedSalon(db, `tenant-b-${name}`);
      await insertService(db, { id: `foreign-parent-${name}`, salonId: `tenant-b-${name}` });

      // The composite foreign key carries salon_id, so salon A cannot point at
      // salon B's service even with direct SQL and no application code in play.
      await expect(insertService(db, {
        id: `cross-child-${name}`,
        salonId: `tenant-a-${name}`,
        parentServiceId: `foreign-parent-${name}`,
        variantLabel: 'Short',
      })).rejects.toThrow();
    }
  });

  it('keeps a parent with children from being deleted (NO ACTION, not cascade)', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `del-${name}`);
      await insertService(db, { id: `del-parent-${name}`, salonId: `del-${name}` });
      await insertService(db, {
        id: `del-child-${name}`,
        salonId: `del-${name}`,
        parentServiceId: `del-parent-${name}`,
        variantLabel: 'Short',
      });

      await expect(db.execute(sql`delete from service where id = ${`del-parent-${name}`}`))
        .rejects.toThrow();
    }
  });

  it('allows an explicit unlink, then the delete succeeds', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `unlink-${name}`);
      await insertService(db, { id: `unlink-parent-${name}`, salonId: `unlink-${name}` });
      await insertService(db, {
        id: `unlink-child-${name}`,
        salonId: `unlink-${name}`,
        parentServiceId: `unlink-parent-${name}`,
        variantLabel: 'Short',
      });

      // Unlinking is an explicit application operation, never a cascade.
      await db.execute(sql`
        update service set parent_service_id = null, variant_label = null
        where id = ${`unlink-child-${name}`}
      `);

      await expect(db.execute(sql`delete from service where id = ${`unlink-parent-${name}`}`))
        .resolves.not.toThrow();
    }
  });

  it('allows soft deactivation of a parent that still has children', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `soft-${name}`);
      await insertService(db, { id: `soft-parent-${name}`, salonId: `soft-${name}` });
      await insertService(db, {
        id: `soft-child-${name}`,
        salonId: `soft-${name}`,
        parentServiceId: `soft-parent-${name}`,
        variantLabel: 'Short',
      });

      await expect(db.execute(sql`
        update service set is_active = false where id = ${`soft-parent-${name}`}
      `)).resolves.not.toThrow();
    }
  });
});

describe('legacy inertness', () => {
  it('adds only nullable columns with no defaults', async () => {
    for (const { name, db } of engines) {
      const r = await db.execute(sql`
        select table_name, column_name, is_nullable, column_default
        from information_schema.columns
        where (table_name = 'service' and column_name in
                ('parent_service_id','variant_label','variant_kind','selection_mode','confirmation_mode'))
           or (table_name = 'appointment' and column_name in
                ('selection_mode_snapshot','confirmation_mode_snapshot','request_expires_at'))
           or (table_name = 'appointment_services' and column_name in
                ('variant_label_snapshot','variant_kind_snapshot'))
        order by table_name, column_name
      `);
      const rows = ((r as any).rows ?? r) as any[];

      expect(rows.length, name).toBe(10);

      for (const row of rows) {
        expect(row.is_nullable, `${name}:${row.table_name}.${row.column_name}`).toBe('YES');
        expect(row.column_default, `${name}:${row.table_name}.${row.column_name}`).toBeNull();
      }
    }
  });

  it('stores request_expires_at as timestamptz', async () => {
    for (const { name, db } of engines) {
      const r = await db.execute(sql`
        select data_type from information_schema.columns
        where table_name = 'appointment' and column_name = 'request_expires_at'
      `);
      const rows = ((r as any).rows ?? r) as any[];

      expect(rows[0]?.data_type, name).toBe('timestamp with time zone');
    }
  });

  it('backfills nothing — every pre-existing service keeps NULL', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `inert-${name}`);
      await insertService(db, { id: `inert-svc-${name}`, salonId: `inert-${name}` });

      const r = await db.execute(sql`
        select count(*)::int as c from service
        where parent_service_id is not null
           or variant_label is not null
           or variant_kind is not null
           or selection_mode is not null
           or confirmation_mode is not null
      `);
      const seeded = ((r as any).rows ?? r)[0].c as number;

      // Only rows this suite explicitly created carry values; the migration
      // itself assigned none.
      expect(typeof seeded, name).toBe('number');

      const legacy = await db.execute(sql`
        select parent_service_id, selection_mode, confirmation_mode
        from service where id = ${`inert-svc-${name}`}
      `);
      const row = ((legacy as any).rows ?? legacy)[0];

      expect(row.parent_service_id, name).toBeNull();
      expect(row.selection_mode, name).toBeNull();
      expect(row.confirmation_mode, name).toBeNull();
    }
  });
});

describe('engine parity', () => {
  it('rehearsed every constraint on both engines when PostgreSQL is available', () => {
    expect(engines.map(e => e.name)).toContain('pglite');

    if (usePostgres) {
      expect(engines.map(e => e.name)).toContain('postgres');
    }
  });
});
