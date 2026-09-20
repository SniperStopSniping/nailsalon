import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const databaseUrl = process.env.NEXT_VISIT_TEST_DATABASE_URL;
if (databaseUrl && (!['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  || process.env.NEXT_VISIT_DISPOSABLE_DATABASE_CONFIRMED !== 'true')) {
  throw new Error('Next Visit concurrency tests require an explicitly confirmed disposable loopback database.');
}
const suite = databaseUrl ? describe : describe.skip;
let pool: pg.Pool;

suite('Next Visit actual PostgreSQL lifecycle and concurrency', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl });
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
    await migrate(drizzle(pool), { migrationsFolder: './migrations' });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE salon CASCADE');
    await pool.query(`INSERT INTO salon(id,name,slug) VALUES ('s','Synthetic','next-visit-pg');
      INSERT INTO salon_client(id,salon_id,full_name,phone) VALUES ('c','s','Synthetic','4165550101');
      INSERT INTO appointment(id,salon_id,salon_client_id,client_name,client_phone,start_time,end_time,status,completed_at,total_price,total_duration_minutes)
        VALUES ('source','s','c','Synthetic','4165550101','2031-03-01 17:00Z','2031-03-01 18:00Z','completed','2031-03-01 18:00Z',5000,60),
        ('a','s','c','Synthetic','4165550101','2031-03-20 17:00Z','2031-03-20 18:00Z','confirmed',NULL,4750,60),
        ('b','s','c','Synthetic','4165550101','2031-03-21 17:00Z','2031-03-21 18:00Z','confirmed',NULL,4750,60);
      INSERT INTO next_visit_offer(id,salon_id,salon_client_id,source_appointment_id,qualified_at,time_zone,deadline_date,expires_at,currency,settings_snapshot)
        VALUES ('offer','s','c','source','2031-03-01 18:00Z','America/Toronto','2031-03-31','2031-04-01 04:00Z','CAD','{"enabled":true,"windowDays":30,"discountType":"percent","value":5,"eligibleServiceIds":[],"messageTemplate":""}');`);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('allows exactly one concurrent reservation and release makes the original entitlement reusable', async () => {
    const reserve = (id: string) => pool.query('UPDATE next_visit_offer SET state=\'reserved\',reserved_appointment_id=$1 WHERE id=\'offer\' AND state=\'available\' AND reserved_appointment_id IS NULL RETURNING id', [id]);
    const results = await Promise.all([reserve('a'), reserve('b')]);

    expect(results.reduce((sum, result) => sum + result.rowCount!, 0)).toBe(1);

    const winner = (await pool.query('SELECT reserved_appointment_id FROM next_visit_offer WHERE id=\'offer\'')).rows[0].reserved_appointment_id;
    await pool.query('UPDATE appointment SET status=\'cancelled\' WHERE id=$1', [winner]);

    expect((await pool.query('SELECT state,reserved_appointment_id FROM next_visit_offer WHERE id=\'offer\'')).rows[0]).toEqual({ state: 'available', reserved_appointment_id: null });
    expect((await reserve(winner === 'a' ? 'b' : 'a')).rowCount).toBe(1);
  });

  it('fails fast instead of deadlocking when a source writer meets an offer-first transaction', async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query('BEGIN');
      await first.query('SELECT id FROM next_visit_offer WHERE id=\'offer\' FOR UPDATE');
      await second.query('BEGIN');
      await second.query('SET LOCAL statement_timeout=\'1500ms\'');

      await expect(second.query('UPDATE appointment SET status=\'cancelled\' WHERE id=\'source\'')).rejects.toMatchObject({ code: '55P03' });

      await second.query('ROLLBACK');

      expect((await first.query('SELECT id FROM appointment WHERE id=\'source\' FOR SHARE NOWAIT')).rowCount).toBe(1);
    } finally {
      await second.query('ROLLBACK');
      await first.query('ROLLBACK');
      first.release();
      second.release();
    }
  });

  it('uses nonwaiting client FK prelock to break appointment/client lifecycle inversion', async () => {
    const completion = await pool.connect();
    const lifecycle = await pool.connect();
    try {
      await completion.query('BEGIN');
      await completion.query('SELECT id FROM appointment WHERE id=\'a\' FOR UPDATE');
      await lifecycle.query('BEGIN');
      await lifecycle.query('SELECT id FROM salon_client WHERE id=\'c\' FOR UPDATE');
      await completion.query('SET LOCAL statement_timeout=\'1500ms\'');

      await expect(completion.query('SELECT id FROM salon_client WHERE salon_id=\'s\' AND id=\'c\' FOR KEY SHARE NOWAIT')).rejects.toMatchObject({ code: '55P03' });

      await completion.query('ROLLBACK');

      expect((await lifecycle.query('SELECT id FROM appointment WHERE id=\'a\' FOR UPDATE NOWAIT')).rowCount).toBe(1);
    } finally {
      await completion.query('ROLLBACK');
      await lifecycle.query('ROLLBACK');
      completion.release();
      lifecycle.release();
    }
  });

  it('rolls back source invalidation after reservation and consumes only once on completion replay', async () => {
    await pool.query('UPDATE next_visit_offer SET state=\'reserved\',reserved_appointment_id=\'a\' WHERE id=\'offer\'');

    await expect(pool.query('UPDATE appointment SET status=\'cancelled\' WHERE id=\'source\'')).rejects.toMatchObject({ code: '23514' });
    expect((await pool.query('SELECT status FROM appointment WHERE id=\'source\'')).rows[0].status).toBe('completed');

    await pool.query('UPDATE appointment SET status=\'completed\',completed_at=\'2031-03-20 18:00Z\' WHERE id=\'a\'');
    await pool.query('UPDATE appointment SET status=\'completed\',completed_at=\'2031-03-20 18:00Z\' WHERE id=\'a\'');

    expect((await pool.query('SELECT state FROM next_visit_offer WHERE id=\'offer\'')).rows[0].state).toBe('consumed');
    expect((await pool.query('SELECT count(*)::int AS count FROM next_visit_offer_event WHERE offer_id=\'offer\' AND kind=\'consumed\'')).rows[0].count).toBe(1);
  });
});
