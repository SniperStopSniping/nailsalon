import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const MIGRATIONS_FOLDER = path.join(process.cwd(), 'migrations');
let db: any;

function rows(r: unknown): any[] {
  const w = r as { rows?: any[] };
  return Array.isArray(w?.rows) ? w.rows : (Array.isArray(r) ? r as any[] : []);
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzlePglite(client);
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
}, 120_000);

describe('discover portfolio schema (migration 0071)', () => {
  it('creates both portfolio tables', async () => {
    const r = await db.execute(sql`select table_name from information_schema.tables where table_name in ('salon_portfolio_photo','salon_discover_settings') order by table_name`);

    expect(rows(r).map(x => x.table_name)).toEqual(['salon_discover_settings', 'salon_portfolio_photo']);
  });

  it('adds the per-salon override column', async () => {
    const r = await db.execute(sql`select column_name from information_schema.columns where table_name='salon' and column_name='max_portfolio_photos'`);

    expect(rows(r).length).toBe(1);
  });

  it('enforces crop completeness', async () => {
    const r = await db.execute(sql`select conname from pg_constraint where conname='salon_portfolio_photo_crop_complete'`);

    expect(rows(r).length).toBe(1);
  });

  it('leaves appointment_photo untouched', async () => {
    const r = await db.execute(sql`select column_name from information_schema.columns where table_name='appointment_photo'`);
    const cols = rows(r).map(x => x.column_name);

    expect(cols).toContain('normalized_client_phone');
    expect(cols).not.toContain('service_family');
  });
});
