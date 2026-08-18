/**
 * L1 PR2 — dark catalog grouping / capability / rule foundation.
 *
 * Every CHECK and every composite foreign key added by migration 0073 is
 * rehearsed here against PGlite, and against real PostgreSQL when
 * CONCURRENCY_TEST_DATABASE_URL points at a local throwaway database. The two
 * engines must agree: a constraint that only holds in one of them is not a
 * constraint we can rely on in production. That matters more than usual for
 * this migration, because its tenant guarantees are what stop one salon's
 * catalog from ever referencing another's.
 *
 * Cross-tenant rejection is proved by DIRECT SQL, with no application code in
 * the path, because the whole point of a composite key is that it holds even
 * when every layer above it is wrong.
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

const rowsOf = (result: any): any[] => (result?.rows ?? result) as any[];

async function seedSalon(db: any, id: string) {
  await db.execute(sql`
    insert into salon (id, name, slug, theme_key)
    values (${id}, ${id}, ${id}, 'nail-salon-no5')
    on conflict (id) do nothing
  `);
}

async function insertGroup(db: any, opts: {
  id: string;
  salonId: string;
  slug?: string;
  minSelections?: number;
  maxSelections?: number | null;
}) {
  await db.execute(sql`
    insert into add_on_group (id, salon_id, name, slug, min_selections, max_selections)
    values (
      ${opts.id}, ${opts.salonId}, ${opts.id}, ${opts.slug ?? opts.id},
      ${opts.minSelections ?? 0}, ${opts.maxSelections ?? null}
    )
  `);
}

async function insertAddOn(db: any, opts: {
  id: string;
  salonId: string;
  groupId?: string | null;
}) {
  await db.execute(sql`
    insert into add_on (id, salon_id, name, slug, category, price_cents, duration_minutes, group_id)
    values (
      ${opts.id}, ${opts.salonId}, ${opts.id}, ${opts.id}, 'nail_art', 500, 10,
      ${opts.groupId ?? null}
    )
  `);
}

async function insertService(db: any, opts: { id: string; salonId: string }) {
  await db.execute(sql`
    insert into service (id, salon_id, name, price, duration_minutes, category)
    values (${opts.id}, ${opts.salonId}, ${opts.id}, 1000, 30, 'manicure')
  `);
}

async function insertTechnician(db: any, opts: { id: string; salonId: string }) {
  await db.execute(sql`
    insert into technician (id, salon_id, name) values (${opts.id}, ${opts.salonId}, ${opts.id})
  `);
}

async function insertCapability(db: any, opts: {
  id: string;
  salonId: string;
  slug?: string;
}) {
  await db.execute(sql`
    insert into capability (id, salon_id, slug, name)
    values (${opts.id}, ${opts.salonId}, ${opts.slug ?? opts.id}, ${opts.id})
  `);
}

async function assignCapability(db: any, opts: {
  id: string;
  salonId: string;
  technicianId: string;
  capabilityId: string;
}) {
  await db.execute(sql`
    insert into technician_capability (id, salon_id, technician_id, capability_id)
    values (${opts.id}, ${opts.salonId}, ${opts.technicianId}, ${opts.capabilityId})
  `);
}

async function insertRule(db: any, opts: {
  id: string;
  salonId: string;
  ruleType: string;
  serviceId?: string | null;
  subjectServiceId?: string | null;
  subjectAddOnId?: string | null;
  objectAddOnId?: string | null;
  capabilityId?: string | null;
  params?: string;
  priority?: number;
}) {
  await db.execute(sql`
    insert into catalog_rule (
      id, salon_id, service_id, rule_type,
      subject_service_id, subject_add_on_id, object_add_on_id, capability_id,
      params, priority
    ) values (
      ${opts.id}, ${opts.salonId}, ${opts.serviceId ?? null}, ${opts.ruleType},
      ${opts.subjectServiceId ?? null}, ${opts.subjectAddOnId ?? null},
      ${opts.objectAddOnId ?? null}, ${opts.capabilityId ?? null},
      ${opts.params ?? '{}'}::jsonb, ${opts.priority ?? 0}
    )
  `);
}

/**
 * Every fixture salon in this file is named `<prefix>-<engine>`, and every row
 * this suite creates hangs off one of those salons, so deleting the salons
 * removes the whole footprint through the existing ON DELETE CASCADE on
 * `salon_id`. PGlite is fresh each run, but a PostgreSQL target persists —
 * without this the second run would collide on a primary key and report a
 * constraint failure that is really just leftover state.
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

describe('migration 0073 applies on every engine', () => {
  it('runs after 0071 and 0072 without collision', async () => {
    for (const { name, db } of engines) {
      const rows = rowsOf(await db.execute(
        sql`select hash from drizzle.__drizzle_migrations order by created_at, id`,
      ));

      expect(rows.length, name).toBeGreaterThanOrEqual(74);
    }
  });

  it('creates all four tables', async () => {
    for (const { name, db } of engines) {
      const rows = rowsOf(await db.execute(sql`
        select table_name from information_schema.tables
        where table_schema = 'public'
          and table_name in ('add_on_group', 'capability', 'technician_capability', 'catalog_rule')
        order by table_name
      `));

      expect(rows.map(r => r.table_name), name).toEqual([
        'add_on_group',
        'capability',
        'catalog_rule',
        'technician_capability',
      ]);
    }
  });

  it('leaves the Discover portfolio and L1 variant schema untouched', async () => {
    for (const { name, db } of engines) {
      const portfolio = rowsOf(await db.execute(sql`
        select column_name from information_schema.columns
        where table_name = 'salon_portfolio_photo' order by column_name
      `)).map(r => r.column_name);

      expect(portfolio, name).toContain('publication_rights_confirmed_at');
      expect(portfolio, name).not.toContain('group_id');

      const service = rowsOf(await db.execute(sql`
        select column_name from information_schema.columns
        where table_name = 'service' order by column_name
      `)).map(r => r.column_name);

      expect(service, name).toContain('parent_service_id');
      expect(service, name).toContain('confirmation_mode');
    }
  });

  it('adds add_on.group_id as nullable with no default', async () => {
    for (const { name, db } of engines) {
      const rows = rowsOf(await db.execute(sql`
        select is_nullable, column_default from information_schema.columns
        where table_name = 'add_on' and column_name = 'group_id'
      `));

      expect(rows.length, name).toBe(1);
      expect(rows[0].is_nullable, name).toBe('YES');
      expect(rows[0].column_default, name).toBeNull();
    }
  });

  it('stores every new timestamp as timestamptz', async () => {
    for (const { name, db } of engines) {
      const rows = rowsOf(await db.execute(sql`
        select table_name, column_name, data_type from information_schema.columns
        where table_name in ('add_on_group', 'capability', 'technician_capability', 'catalog_rule')
          and column_name in ('created_at', 'updated_at')
      `));

      expect(rows.length, name).toBe(8);

      for (const row of rows) {
        expect(row.data_type, `${name}:${row.table_name}.${row.column_name}`)
          .toBe('timestamp with time zone');
      }
    }
  });
});

describe('add-on groups', () => {
  it('accepts a valid group', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `grp-${name}`);

      await expect(insertGroup(db, {
        id: `grp-ok-${name}`,
        salonId: `grp-${name}`,
        minSelections: 1,
        maxSelections: 3,
      })).resolves.not.toThrow();
    }
  });

  it('rejects a negative minimum', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `grpmin-${name}`);

      await expect(insertGroup(db, {
        id: `grpmin-bad-${name}`,
        salonId: `grpmin-${name}`,
        minSelections: -1,
      })).rejects.toThrow();
    }
  });

  it('rejects a maximum of zero', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `grpzero-${name}`);

      await expect(insertGroup(db, {
        id: `grpzero-bad-${name}`,
        salonId: `grpzero-${name}`,
        maxSelections: 0,
      })).rejects.toThrow();
    }
  });

  it('rejects a maximum below the minimum', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `grpincompat-${name}`);

      await expect(insertGroup(db, {
        id: `grpincompat-bad-${name}`,
        salonId: `grpincompat-${name}`,
        minSelections: 3,
        maxSelections: 2,
      })).rejects.toThrow();
    }
  });

  it('accepts a NULL maximum as unlimited, with a minimum', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `grpunl-${name}`);

      await expect(insertGroup(db, {
        id: `grpunl-ok-${name}`,
        salonId: `grpunl-${name}`,
        minSelections: 2,
        maxSelections: null,
      })).resolves.not.toThrow();
    }
  });

  it('scopes slug uniqueness to the salon', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `grpslug-a-${name}`);
      await seedSalon(db, `grpslug-b-${name}`);

      await insertGroup(db, { id: `grpslug-1-${name}`, salonId: `grpslug-a-${name}`, slug: 'shape' });

      // Same slug in a different salon is fine ...
      await expect(insertGroup(db, {
        id: `grpslug-2-${name}`,
        salonId: `grpslug-b-${name}`,
        slug: 'shape',
      })).resolves.not.toThrow();

      // ... but a duplicate within one salon is not.
      await expect(insertGroup(db, {
        id: `grpslug-3-${name}`,
        salonId: `grpslug-a-${name}`,
        slug: 'shape',
      })).rejects.toThrow();
    }
  });

  it('accepts an add-on joined to a group in the same salon', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `grpjoin-${name}`);
      await insertGroup(db, { id: `grpjoin-g-${name}`, salonId: `grpjoin-${name}` });

      await expect(insertAddOn(db, {
        id: `grpjoin-a-${name}`,
        salonId: `grpjoin-${name}`,
        groupId: `grpjoin-g-${name}`,
      })).resolves.not.toThrow();
    }
  });

  it('rejects a cross-tenant group by direct SQL', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `grpx-a-${name}`);
      await seedSalon(db, `grpx-b-${name}`);
      await insertGroup(db, { id: `grpx-foreign-${name}`, salonId: `grpx-b-${name}` });

      // The composite foreign key carries salon_id, so salon A cannot point an
      // add-on at salon B's group even with no application code in play.
      await expect(insertAddOn(db, {
        id: `grpx-a-addon-${name}`,
        salonId: `grpx-a-${name}`,
        groupId: `grpx-foreign-${name}`,
      })).rejects.toThrow();
    }
  });

  it('keeps a group with members from being deleted, and allows it after an explicit unlink', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `grpdel-${name}`);
      await insertGroup(db, { id: `grpdel-g-${name}`, salonId: `grpdel-${name}` });
      await insertAddOn(db, {
        id: `grpdel-a-${name}`,
        salonId: `grpdel-${name}`,
        groupId: `grpdel-g-${name}`,
      });

      await expect(db.execute(sql`delete from add_on_group where id = ${`grpdel-g-${name}`}`))
        .rejects.toThrow();

      // Unlinking is an explicit application operation, never a cascade.
      await db.execute(sql`
        update add_on set group_id = null where id = ${`grpdel-a-${name}`}
      `);

      await expect(db.execute(sql`delete from add_on_group where id = ${`grpdel-g-${name}`}`))
        .resolves.not.toThrow();
    }
  });

  it('allows soft deactivation of a group that still has members', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `grpsoft-${name}`);
      await insertGroup(db, { id: `grpsoft-g-${name}`, salonId: `grpsoft-${name}` });
      await insertAddOn(db, {
        id: `grpsoft-a-${name}`,
        salonId: `grpsoft-${name}`,
        groupId: `grpsoft-g-${name}`,
      });

      await expect(db.execute(sql`
        update add_on_group set is_active = false where id = ${`grpsoft-g-${name}`}
      `)).resolves.not.toThrow();
    }
  });
});

describe('capabilities', () => {
  it('accepts a valid capability', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `cap-${name}`);

      await expect(insertCapability(db, { id: `cap-ok-${name}`, salonId: `cap-${name}` }))
        .resolves.not.toThrow();
    }
  });

  it('scopes slug uniqueness to the salon', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `capslug-a-${name}`);
      await seedSalon(db, `capslug-b-${name}`);

      await insertCapability(db, {
        id: `capslug-1-${name}`,
        salonId: `capslug-a-${name}`,
        slug: 'hard-gel',
      });

      await expect(insertCapability(db, {
        id: `capslug-2-${name}`,
        salonId: `capslug-b-${name}`,
        slug: 'hard-gel',
      })).resolves.not.toThrow();

      await expect(insertCapability(db, {
        id: `capslug-3-${name}`,
        salonId: `capslug-a-${name}`,
        slug: 'hard-gel',
      })).rejects.toThrow();
    }
  });

  it('accepts a same-salon technician assignment', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `asg-${name}`);
      await insertTechnician(db, { id: `asg-t-${name}`, salonId: `asg-${name}` });
      await insertCapability(db, { id: `asg-c-${name}`, salonId: `asg-${name}` });

      await expect(assignCapability(db, {
        id: `asg-1-${name}`,
        salonId: `asg-${name}`,
        technicianId: `asg-t-${name}`,
        capabilityId: `asg-c-${name}`,
      })).resolves.not.toThrow();
    }
  });

  it('rejects a duplicate assignment', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `dup-${name}`);
      await insertTechnician(db, { id: `dup-t-${name}`, salonId: `dup-${name}` });
      await insertCapability(db, { id: `dup-c-${name}`, salonId: `dup-${name}` });
      await assignCapability(db, {
        id: `dup-1-${name}`,
        salonId: `dup-${name}`,
        technicianId: `dup-t-${name}`,
        capabilityId: `dup-c-${name}`,
      });

      await expect(assignCapability(db, {
        id: `dup-2-${name}`,
        salonId: `dup-${name}`,
        technicianId: `dup-t-${name}`,
        capabilityId: `dup-c-${name}`,
      })).rejects.toThrow();
    }
  });

  it('rejects assigning another salon\'s technician by direct SQL', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `xt-a-${name}`);
      await seedSalon(db, `xt-b-${name}`);
      await insertTechnician(db, { id: `xt-foreign-t-${name}`, salonId: `xt-b-${name}` });
      await insertCapability(db, { id: `xt-c-${name}`, salonId: `xt-a-${name}` });

      await expect(assignCapability(db, {
        id: `xt-1-${name}`,
        salonId: `xt-a-${name}`,
        technicianId: `xt-foreign-t-${name}`,
        capabilityId: `xt-c-${name}`,
      })).rejects.toThrow();
    }
  });

  it('rejects assigning another salon\'s capability by direct SQL', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `xc-a-${name}`);
      await seedSalon(db, `xc-b-${name}`);
      await insertTechnician(db, { id: `xc-t-${name}`, salonId: `xc-a-${name}` });
      await insertCapability(db, { id: `xc-foreign-c-${name}`, salonId: `xc-b-${name}` });

      await expect(assignCapability(db, {
        id: `xc-1-${name}`,
        salonId: `xc-a-${name}`,
        technicianId: `xc-t-${name}`,
        capabilityId: `xc-foreign-c-${name}`,
      })).rejects.toThrow();
    }
  });

  it('deactivates a capability softly, keeping its assignments', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `capsoft-${name}`);
      await insertTechnician(db, { id: `capsoft-t-${name}`, salonId: `capsoft-${name}` });
      await insertCapability(db, { id: `capsoft-c-${name}`, salonId: `capsoft-${name}` });
      await assignCapability(db, {
        id: `capsoft-1-${name}`,
        salonId: `capsoft-${name}`,
        technicianId: `capsoft-t-${name}`,
        capabilityId: `capsoft-c-${name}`,
      });

      await db.execute(sql`
        update capability set is_active = false where id = ${`capsoft-c-${name}`}
      `);

      const rows = rowsOf(await db.execute(sql`
        select count(*)::int as c from technician_capability
        where capability_id = ${`capsoft-c-${name}`}
      `));

      expect(rows[0].c, name).toBe(1);
    }
  });
});

describe('catalog rules — vocabulary and shape', () => {
  it('accepts every add-on rule type', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `rt-${name}`);
      await insertAddOn(db, { id: `rt-subject-${name}`, salonId: `rt-${name}` });
      await insertAddOn(db, { id: `rt-object-${name}`, salonId: `rt-${name}` });

      for (const type of ['include', 'exclude', 'requires', 'mutually_exclusive', 'max_quantity']) {
        await expect(insertRule(db, {
          id: `rt-${type}-${name}`,
          salonId: `rt-${name}`,
          ruleType: type,
          subjectAddOnId: `rt-subject-${name}`,
          objectAddOnId: `rt-object-${name}`,
        }), `${name}:${type}`).resolves.not.toThrow();
      }
    }
  });

  it('accepts requires_capability with a capability', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `rc-${name}`);
      await insertService(db, { id: `rc-svc-${name}`, salonId: `rc-${name}` });
      await insertCapability(db, { id: `rc-cap-${name}`, salonId: `rc-${name}` });

      await expect(insertRule(db, {
        id: `rc-ok-${name}`,
        salonId: `rc-${name}`,
        ruleType: 'requires_capability',
        subjectServiceId: `rc-svc-${name}`,
        capabilityId: `rc-cap-${name}`,
      })).resolves.not.toThrow();
    }
  });

  it('rejects an unknown rule type', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `rbad-${name}`);
      await insertAddOn(db, { id: `rbad-s-${name}`, salonId: `rbad-${name}` });
      await insertAddOn(db, { id: `rbad-o-${name}`, salonId: `rbad-${name}` });

      for (const type of ['adjust_price', 'adjust_duration', 'arbitrary_expression']) {
        await expect(insertRule(db, {
          id: `rbad-${type}-${name}`,
          salonId: `rbad-${name}`,
          ruleType: type,
          subjectAddOnId: `rbad-s-${name}`,
          objectAddOnId: `rbad-o-${name}`,
        }), `${name}:${type}`).rejects.toThrow();
      }
    }
  });

  it('rejects a rule with no subject', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `rnosub-${name}`);
      await insertAddOn(db, { id: `rnosub-o-${name}`, salonId: `rnosub-${name}` });

      await expect(insertRule(db, {
        id: `rnosub-bad-${name}`,
        salonId: `rnosub-${name}`,
        ruleType: 'requires',
        objectAddOnId: `rnosub-o-${name}`,
      })).rejects.toThrow();
    }
  });

  it('rejects a rule with two subjects', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `r2sub-${name}`);
      await insertService(db, { id: `r2sub-svc-${name}`, salonId: `r2sub-${name}` });
      await insertAddOn(db, { id: `r2sub-s-${name}`, salonId: `r2sub-${name}` });
      await insertAddOn(db, { id: `r2sub-o-${name}`, salonId: `r2sub-${name}` });

      await expect(insertRule(db, {
        id: `r2sub-bad-${name}`,
        salonId: `r2sub-${name}`,
        ruleType: 'requires',
        subjectServiceId: `r2sub-svc-${name}`,
        subjectAddOnId: `r2sub-s-${name}`,
        objectAddOnId: `r2sub-o-${name}`,
      })).rejects.toThrow();
    }
  });

  it('rejects requires_capability without a capability', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `rcno-${name}`);
      await insertService(db, { id: `rcno-svc-${name}`, salonId: `rcno-${name}` });

      await expect(insertRule(db, {
        id: `rcno-bad-${name}`,
        salonId: `rcno-${name}`,
        ruleType: 'requires_capability',
        subjectServiceId: `rcno-svc-${name}`,
      })).rejects.toThrow();
    }
  });

  it('rejects requires_capability that also names an add-on', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `rcboth-${name}`);
      await insertService(db, { id: `rcboth-svc-${name}`, salonId: `rcboth-${name}` });
      await insertCapability(db, { id: `rcboth-cap-${name}`, salonId: `rcboth-${name}` });
      await insertAddOn(db, { id: `rcboth-o-${name}`, salonId: `rcboth-${name}` });

      await expect(insertRule(db, {
        id: `rcboth-bad-${name}`,
        salonId: `rcboth-${name}`,
        ruleType: 'requires_capability',
        subjectServiceId: `rcboth-svc-${name}`,
        capabilityId: `rcboth-cap-${name}`,
        objectAddOnId: `rcboth-o-${name}`,
      })).rejects.toThrow();
    }
  });

  it('rejects a non-capability rule with no object add-on', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `rnoobj-${name}`);
      await insertAddOn(db, { id: `rnoobj-s-${name}`, salonId: `rnoobj-${name}` });

      await expect(insertRule(db, {
        id: `rnoobj-bad-${name}`,
        salonId: `rnoobj-${name}`,
        ruleType: 'exclude',
        subjectAddOnId: `rnoobj-s-${name}`,
      })).rejects.toThrow();
    }
  });

  it('rejects a non-capability rule that names a capability', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `rcapmix-${name}`);
      await insertAddOn(db, { id: `rcapmix-s-${name}`, salonId: `rcapmix-${name}` });
      await insertAddOn(db, { id: `rcapmix-o-${name}`, salonId: `rcapmix-${name}` });
      await insertCapability(db, { id: `rcapmix-c-${name}`, salonId: `rcapmix-${name}` });

      await expect(insertRule(db, {
        id: `rcapmix-bad-${name}`,
        salonId: `rcapmix-${name}`,
        ruleType: 'exclude',
        subjectAddOnId: `rcapmix-s-${name}`,
        objectAddOnId: `rcapmix-o-${name}`,
        capabilityId: `rcapmix-c-${name}`,
      })).rejects.toThrow();
    }
  });

  it('rejects an add-on pointed at itself', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `rself-${name}`);
      await insertAddOn(db, { id: `rself-a-${name}`, salonId: `rself-${name}` });

      await expect(insertRule(db, {
        id: `rself-bad-${name}`,
        salonId: `rself-${name}`,
        ruleType: 'mutually_exclusive',
        subjectAddOnId: `rself-a-${name}`,
        objectAddOnId: `rself-a-${name}`,
      })).rejects.toThrow();
    }
  });

  it('rejects a negative priority and a non-object params', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `rmisc-${name}`);
      await insertAddOn(db, { id: `rmisc-s-${name}`, salonId: `rmisc-${name}` });
      await insertAddOn(db, { id: `rmisc-o-${name}`, salonId: `rmisc-${name}` });

      await expect(insertRule(db, {
        id: `rmisc-prio-${name}`,
        salonId: `rmisc-${name}`,
        ruleType: 'requires',
        subjectAddOnId: `rmisc-s-${name}`,
        objectAddOnId: `rmisc-o-${name}`,
        priority: -1,
      })).rejects.toThrow();

      await expect(insertRule(db, {
        id: `rmisc-params-${name}`,
        salonId: `rmisc-${name}`,
        ruleType: 'requires',
        subjectAddOnId: `rmisc-s-${name}`,
        objectAddOnId: `rmisc-o-${name}`,
        params: '[1,2]',
      })).rejects.toThrow();
    }
  });

  it('accepts a salon-wide rule with a NULL service scope', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `rscope-${name}`);
      await insertAddOn(db, { id: `rscope-s-${name}`, salonId: `rscope-${name}` });
      await insertAddOn(db, { id: `rscope-o-${name}`, salonId: `rscope-${name}` });

      await expect(insertRule(db, {
        id: `rscope-wide-${name}`,
        salonId: `rscope-${name}`,
        ruleType: 'requires',
        subjectAddOnId: `rscope-s-${name}`,
        objectAddOnId: `rscope-o-${name}`,
        serviceId: null,
      })).resolves.not.toThrow();
    }
  });
});

describe('catalog rules — tenant integrity', () => {
  it('rejects a cross-tenant service scope by direct SQL', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `rxs-a-${name}`);
      await seedSalon(db, `rxs-b-${name}`);
      await insertService(db, { id: `rxs-foreign-svc-${name}`, salonId: `rxs-b-${name}` });
      await insertAddOn(db, { id: `rxs-s-${name}`, salonId: `rxs-a-${name}` });
      await insertAddOn(db, { id: `rxs-o-${name}`, salonId: `rxs-a-${name}` });

      await expect(insertRule(db, {
        id: `rxs-bad-${name}`,
        salonId: `rxs-a-${name}`,
        ruleType: 'requires',
        serviceId: `rxs-foreign-svc-${name}`,
        subjectAddOnId: `rxs-s-${name}`,
        objectAddOnId: `rxs-o-${name}`,
      })).rejects.toThrow();
    }
  });

  it('rejects a cross-tenant subject add-on by direct SQL', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `rxsub-a-${name}`);
      await seedSalon(db, `rxsub-b-${name}`);
      await insertAddOn(db, { id: `rxsub-foreign-${name}`, salonId: `rxsub-b-${name}` });
      await insertAddOn(db, { id: `rxsub-o-${name}`, salonId: `rxsub-a-${name}` });

      await expect(insertRule(db, {
        id: `rxsub-bad-${name}`,
        salonId: `rxsub-a-${name}`,
        ruleType: 'requires',
        subjectAddOnId: `rxsub-foreign-${name}`,
        objectAddOnId: `rxsub-o-${name}`,
      })).rejects.toThrow();
    }
  });

  it('rejects a cross-tenant object add-on by direct SQL', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `rxobj-a-${name}`);
      await seedSalon(db, `rxobj-b-${name}`);
      await insertAddOn(db, { id: `rxobj-s-${name}`, salonId: `rxobj-a-${name}` });
      await insertAddOn(db, { id: `rxobj-foreign-${name}`, salonId: `rxobj-b-${name}` });

      await expect(insertRule(db, {
        id: `rxobj-bad-${name}`,
        salonId: `rxobj-a-${name}`,
        ruleType: 'requires',
        subjectAddOnId: `rxobj-s-${name}`,
        objectAddOnId: `rxobj-foreign-${name}`,
      })).rejects.toThrow();
    }
  });

  it('rejects a cross-tenant capability by direct SQL', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `rxcap-a-${name}`);
      await seedSalon(db, `rxcap-b-${name}`);
      await insertService(db, { id: `rxcap-svc-${name}`, salonId: `rxcap-a-${name}` });
      await insertCapability(db, { id: `rxcap-foreign-${name}`, salonId: `rxcap-b-${name}` });

      await expect(insertRule(db, {
        id: `rxcap-bad-${name}`,
        salonId: `rxcap-a-${name}`,
        ruleType: 'requires_capability',
        subjectServiceId: `rxcap-svc-${name}`,
        capabilityId: `rxcap-foreign-${name}`,
      })).rejects.toThrow();
    }
  });

  it('rejects a cross-tenant subject service by direct SQL', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `rxsvc-a-${name}`);
      await seedSalon(db, `rxsvc-b-${name}`);
      await insertService(db, { id: `rxsvc-foreign-${name}`, salonId: `rxsvc-b-${name}` });
      await insertAddOn(db, { id: `rxsvc-o-${name}`, salonId: `rxsvc-a-${name}` });

      await expect(insertRule(db, {
        id: `rxsvc-bad-${name}`,
        salonId: `rxsvc-a-${name}`,
        ruleType: 'requires',
        subjectServiceId: `rxsvc-foreign-${name}`,
        objectAddOnId: `rxsvc-o-${name}`,
      })).rejects.toThrow();
    }
  });

  it('declares NO ACTION, never SET NULL or CASCADE, on every composite key', async () => {
    for (const { name, db } of engines) {
      const rows = rowsOf(await db.execute(sql`
        select conname, confdeltype, confupdtype
        from pg_constraint
        where contype = 'f' and conname in (
          'add_on_group_salon_fk',
          'technician_capability_technician_salon_fk',
          'technician_capability_capability_salon_fk',
          'catalog_rule_service_salon_fk',
          'catalog_rule_subject_service_salon_fk',
          'catalog_rule_subject_add_on_salon_fk',
          'catalog_rule_object_add_on_salon_fk',
          'catalog_rule_capability_salon_fk'
        )
        order by conname
      `));

      expect(rows.length, name).toBe(8);

      for (const row of rows) {
        // 'a' is NO ACTION. 'n' would be SET NULL and would null salon_id too.
        expect(row.confdeltype, `${name}:${row.conname}:delete`).toBe('a');
        expect(row.confupdtype, `${name}:${row.conname}:update`).toBe('a');
      }
    }
  });
});

describe('legacy inertness', () => {
  it('leaves every new table empty apart from this suite\'s fixtures', async () => {
    for (const { name, db } of engines) {
      const rows = rowsOf(await db.execute(sql`
        select
          (select count(*)::int from add_on_group where salon_id not like ${`%-${name}`}) as groups,
          (select count(*)::int from capability where salon_id not like ${`%-${name}`}) as caps,
          (select count(*)::int from technician_capability where salon_id not like ${`%-${name}`}) as assignments,
          (select count(*)::int from catalog_rule where salon_id not like ${`%-${name}`}) as rules
      `));

      expect(rows[0], name).toEqual({ groups: 0, caps: 0, assignments: 0, rules: 0 });
    }
  });

  it('leaves an ungrouped add-on fully usable', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `legacy-${name}`);

      await expect(insertAddOn(db, { id: `legacy-a-${name}`, salonId: `legacy-${name}` }))
        .resolves.not.toThrow();

      const rows = rowsOf(await db.execute(sql`
        select group_id from add_on where id = ${`legacy-a-${name}`}
      `));

      expect(rows[0].group_id, name).toBeNull();
    }
  });

  it('creates a technician with no capabilities', async () => {
    for (const { name, db } of engines) {
      await seedSalon(db, `legacyt-${name}`);
      await insertTechnician(db, { id: `legacyt-t-${name}`, salonId: `legacyt-${name}` });

      const rows = rowsOf(await db.execute(sql`
        select count(*)::int as c from technician_capability
        where technician_id = ${`legacyt-t-${name}`}
      `));

      expect(rows[0].c, name).toBe(0);
    }
  });

  it('still hard-deletes a salon, cascading every new table with it', async () => {
    // NO ACTION rather than RESTRICT is what makes this pass: the check is
    // deferred to the end of the statement, so a parent and the rows that
    // reference it can disappear together. RESTRICT would abort salon purge.
    for (const { name, db } of engines) {
      const salonId = `purge-${name}`;
      await seedSalon(db, salonId);
      await insertGroup(db, { id: `purge-g-${name}`, salonId });
      await insertAddOn(db, { id: `purge-s-${name}`, salonId, groupId: `purge-g-${name}` });
      await insertAddOn(db, { id: `purge-o-${name}`, salonId });
      await insertService(db, { id: `purge-svc-${name}`, salonId });
      await insertTechnician(db, { id: `purge-t-${name}`, salonId });
      await insertCapability(db, { id: `purge-c-${name}`, salonId });
      await assignCapability(db, {
        id: `purge-asg-${name}`,
        salonId,
        technicianId: `purge-t-${name}`,
        capabilityId: `purge-c-${name}`,
      });
      await insertRule(db, {
        id: `purge-r-${name}`,
        salonId,
        ruleType: 'requires',
        serviceId: `purge-svc-${name}`,
        subjectAddOnId: `purge-s-${name}`,
        objectAddOnId: `purge-o-${name}`,
      });

      await expect(db.execute(sql`delete from salon where id = ${salonId}`))
        .resolves.not.toThrow();

      const rows = rowsOf(await db.execute(sql`
        select
          (select count(*)::int from add_on_group where salon_id = ${salonId}) as groups,
          (select count(*)::int from capability where salon_id = ${salonId}) as caps,
          (select count(*)::int from technician_capability where salon_id = ${salonId}) as assignments,
          (select count(*)::int from catalog_rule where salon_id = ${salonId}) as rules,
          (select count(*)::int from add_on where salon_id = ${salonId}) as addons
      `));

      expect(rows[0], name).toEqual({ groups: 0, caps: 0, assignments: 0, rules: 0, addons: 0 });
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
