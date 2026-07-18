import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATION_SQL = readFileSync(
  new URL('../../migrations/0056_booking_category_luster_featuring.sql', import.meta.url),
  'utf8',
).replaceAll('--> statement-breakpoint', '');

describe('0056 booking category and Luster featuring migration', () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      CREATE TABLE service (
        id text PRIMARY KEY,
        salon_id text NOT NULL,
        name text NOT NULL,
        category text NOT NULL,
        sort_order integer DEFAULT 0,
        is_active boolean DEFAULT true
      );
      INSERT INTO service (id, salon_id, name, category, sort_order, is_active) VALUES
        ('svc_mani', 'salon_1', 'Classic Manicure', 'manicure', 1, true),
        ('svc_bg', 'salon_1', 'BIAB Overlay', 'builder_gel', 2, true),
        ('svc_ext', 'salon_1', 'Gel-X', 'extensions', 3, true),
        ('svc_hands', 'salon_1', 'Hand Treatment', 'hands', 4, true),
        ('svc_pedi', 'salon_1', 'Classic Pedicure', 'pedicure', 5, true),
        ('svc_feet', 'salon_1', 'Foot Soak', 'feet', 6, true),
        ('svc_combo', 'salon_1', 'Mani + Pedi', 'combo', 7, true),
        ('svc_luster_inactive', 'salon_1', 'Luster Manicure', 'manicure', 8, false),
        ('svc_luster_active', 'salon_1', 'Luster Signature Manicure', 'manicure', 9, true),
        ('svc_luster_pedi', 'salon_2', 'Luster Pedicure', 'pedicure', 1, true),
        ('svc_luster_s2', 'salon_2', 'Luster Manicure', 'builder_gel', 2, true);
    `);
    await database.exec(MIGRATION_SQL);
  });

  afterAll(async () => {
    await database.close();
  });

  it('backfills booking_category from the legacy category', async () => {
    const result = await database.query<{ id: string; booking_category: string }>(
      'SELECT id, booking_category FROM service ORDER BY salon_id, sort_order',
    );

    expect(result.rows).toEqual([
      { id: 'svc_mani', booking_category: 'manicure' },
      { id: 'svc_bg', booking_category: 'manicure' },
      { id: 'svc_ext', booking_category: 'manicure' },
      { id: 'svc_hands', booking_category: 'manicure' },
      { id: 'svc_pedi', booking_category: 'pedicure' },
      { id: 'svc_feet', booking_category: 'pedicure' },
      { id: 'svc_combo', booking_category: 'combo' },
      { id: 'svc_luster_inactive', booking_category: 'manicure' },
      { id: 'svc_luster_active', booking_category: 'manicure' },
      { id: 'svc_luster_pedi', booking_category: 'pedicure' },
      { id: 'svc_luster_s2', booking_category: 'manicure' },
    ]);
  });

  it('defaults booking_category to manicure for newly inserted rows', async () => {
    await database.exec(`
      INSERT INTO service (id, salon_id, name, category)
      VALUES ('svc_new', 'salon_3', 'New Service', 'builder_gel');
    `);
    const result = await database.query<{ booking_category: string }>(
      'SELECT booking_category FROM service WHERE id = \'svc_new\'',
    );

    expect(result.rows).toEqual([{ booking_category: 'manicure' }]);

    await database.exec('DELETE FROM service WHERE id = \'svc_new\'');
  });

  it('tags at most one Luster-named hand service per salon, preferring active ones', async () => {
    const result = await database.query<{ id: string }>(
      'SELECT id FROM service WHERE template_key = \'luster_manicure\' ORDER BY id',
    );

    // salon_1: the active Luster wins over the inactive one.
    // salon_2: the pedicure named Luster is skipped; the builder_gel one is tagged.
    expect(result.rows).toEqual([
      { id: 'svc_luster_active' },
      { id: 'svc_luster_s2' },
    ]);
  });

  it('is idempotent and never clobbers owner edits on re-run', async () => {
    await database.exec(`
      UPDATE service SET booking_category = 'combo' WHERE id = 'svc_bg';
    `);

    await database.exec(MIGRATION_SQL);

    const result = await database.query<{ booking_category: string }>(
      'SELECT booking_category FROM service WHERE id = \'svc_bg\'',
    );
    const lusterCount = await database.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM service WHERE template_key = \'luster_manicure\'',
    );

    expect(result.rows).toEqual([{ booking_category: 'combo' }]);
    expect(lusterCount.rows).toEqual([{ count: 2 }]);
  });

  it('enforces one template key per salon while allowing untemplated services', async () => {
    await expect(database.exec(`
      INSERT INTO service (id, salon_id, name, category, template_key)
      VALUES ('svc_dup', 'salon_1', 'Another Luster', 'manicure', 'luster_manicure');
    `)).rejects.toThrow();

    // A different salon can hold the same key, and NULL keys never collide.
    await database.exec(`
      INSERT INTO service (id, salon_id, name, category, template_key)
      VALUES ('svc_other_salon', 'salon_9', 'Luster Manicure', 'manicure', 'luster_manicure');
      INSERT INTO service (id, salon_id, name, category)
      VALUES ('svc_null_a', 'salon_1', 'Plain A', 'manicure'),
             ('svc_null_b', 'salon_1', 'Plain B', 'manicure');
    `);

    const count = await database.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM service WHERE salon_id = \'salon_1\'',
    );

    expect(count.rows[0]?.count).toBeGreaterThan(2);
  });
});
