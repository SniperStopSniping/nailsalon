import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('server-only', () => ({}));
const { finalizePublicBookingAttemptFailure, linkPublicBookingAttempt, lockPublicBookingAttempt, readPublicBookingAttemptStatus, registerPublicBookingAttempt } = await import('./publicBookingAttempt.server');
const { hashPublicBookingRecoveryKey } = await import('./publicBookingRecovery.server');

const databaseUrl = process.env.PUBLIC_BOOKING_ATTEMPT_TEST_DATABASE_URL;
if (databaseUrl) {
  const target = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname)
    || target.pathname !== '/booking_recovery_disposable'
    || process.env.PUBLIC_BOOKING_ATTEMPT_DISPOSABLE_CONFIRMED !== 'true') {
    throw new Error('Attempt concurrency requires the confirmed booking_recovery_disposable loopback database.');
  }
}
const suite = databaseUrl ? describe : describe.skip;
let pool: pg.Pool;
const recoveryKey = '11111111-1111-4111-8111-111111111111';
const identity = { salonId: 'attempt-pg', attemptId: '22222222-2222-4222-8222-222222222222', recoveryKeyHash: hashPublicBookingRecoveryKey(recoveryKey), requestHash: 'a'.repeat(64) };
const statusInput = { salonId: identity.salonId, attemptId: identity.attemptId, recoveryKey, version: 2, startedAt: '2020-01-01T00:00:00.000Z' };
const appointment = (id: string) => ({ id, salonId: identity.salonId, clientPhone: '4165550101', startTime: new Date('2030-01-01T15:00:00Z'), endTime: new Date('2030-01-01T16:00:00Z'), totalPrice: 6500, totalDurationMinutes: 60 });

suite.sequential('public attempt PostgreSQL concurrency', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
    holder.db = drizzle(pool, { schema });
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
    await migrate(holder.db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  }, 120_000);

  beforeEach(async () => {
    await pool.query('TRUNCATE salon CASCADE');
    await holder.db.insert(schema.salonSchema).values({ id: identity.salonId, name: 'Synthetic attempt', slug: 'attempt-pg', themeKey: 'espresso' });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('allows exactly one appointment under eight simultaneous same-key creates without Redis', async () => {
    await registerPublicBookingAttempt(identity);
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => holder.db.transaction(async (tx: any) => {
      await lockPublicBookingAttempt(tx, identity);
      const id = `competing-${index}`;
      await tx.insert(schema.appointmentSchema).values(appointment(id));
      await linkPublicBookingAttempt(tx, { ...identity, appointmentId: id });
    })));

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await pool.query('SELECT id FROM appointment')).rows).toHaveLength(1);
    expect(await readPublicBookingAttemptStatus(statusInput)).toMatchObject({ kind: 'resolved_success' });
    expect(await finalizePublicBookingAttemptFailure({ ...identity, code: 'VALIDATION_ERROR' })).toBe(false);
  });

  it('a commit holding the attempt lock wins against stale-status fencing on another connection', async () => {
    await registerPublicBookingAttempt(identity);
    await pool.query('UPDATE public_booking_attempt SET created_at = now() - interval \'11 minutes\'');
    const connection = await pool.connect();
    let status: ReturnType<typeof readPublicBookingAttemptStatus> | undefined;
    try {
      await connection.query('BEGIN');
      const tx = drizzle(connection, { schema });
      await lockPublicBookingAttempt(tx as any, identity);
      await tx.insert(schema.appointmentSchema).values(appointment('commit-wins'));
      await linkPublicBookingAttempt(tx as any, { ...identity, appointmentId: 'commit-wins' });
      status = readPublicBookingAttemptStatus(statusInput);
      await connection.query('COMMIT');

      expect(await status).toMatchObject({ kind: 'resolved_success', response: { data: { appointmentId: 'commit-wins' } } });
      expect((await pool.query('SELECT state FROM public_booking_attempt')).rows[0].state).toBe('succeeded');
    } finally {
      await connection.query('ROLLBACK');
      connection.release();
      await status;
    }
  });

  it('a stale-status fence wins before a late creator and leaves zero appointments', async () => {
    await registerPublicBookingAttempt(identity);
    await pool.query('UPDATE public_booking_attempt SET created_at = now() - interval \'11 minutes\'');

    expect(await readPublicBookingAttemptStatus(statusInput)).toEqual({ kind: 'resolved_failure' });
    await expect(holder.db.transaction(async (tx: any) => {
      await lockPublicBookingAttempt(tx, identity);
      await tx.insert(schema.appointmentSchema).values(appointment('must-not-exist'));
      await linkPublicBookingAttempt(tx, { ...identity, appointmentId: 'must-not-exist' });
    })).rejects.toThrow('PUBLIC_BOOKING_ATTEMPT_FAILED');
    expect((await pool.query('SELECT id FROM appointment')).rows).toHaveLength(0);
  });

  it('rollback is recoverable failure and never leaves a successful link', async () => {
    await registerPublicBookingAttempt(identity);

    await expect(holder.db.transaction(async (tx: any) => {
      await lockPublicBookingAttempt(tx, identity);
      await tx.insert(schema.appointmentSchema).values(appointment('rolled-back'));
      await linkPublicBookingAttempt(tx, { ...identity, appointmentId: 'rolled-back' });
      throw new Error('synthetic transaction rejection');
    })).rejects.toThrow('synthetic transaction rejection');
    expect(await finalizePublicBookingAttemptFailure({ ...identity, code: 'SYNTHETIC_FAILURE' })).toBe(true);
    expect((await pool.query('SELECT id FROM appointment')).rows).toHaveLength(0);
    expect(await readPublicBookingAttemptStatus(statusInput)).toEqual({ kind: 'resolved_failure' });
  });
});
