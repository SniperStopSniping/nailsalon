import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashPublicBookingRecoveryKey } from '@/libs/publicBookingRecovery.server';
import { publicBookingAttemptSchema as attempts, salonSchema } from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));

const {
  finalizePublicBookingAttemptFailure,
  lockPublicBookingAttempt,
  readPublicBookingAttemptStatus,
  registerPublicBookingAttempt,
} = await import('./publicBookingAttempt.server');

const SALON = 'public-attempt-test-salon';
const ATTEMPT = '123e4567-e89b-42d3-a456-426614174000';
const PROOF = 'a'.repeat(64);
const OTHER_PROOF = 'b'.repeat(64);
const HASH_A = 'c'.repeat(64);
const HASH_B = 'd'.repeat(64);

beforeAll(async () => {
  const client = new PGlite();
  holder.db = drizzlePglite(client);
  await migratePglite(holder.db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 120_000);

beforeEach(async () => {
  await holder.db.delete(attempts);
  await holder.db.insert(salonSchema).values({ id: SALON, name: 'Attempt Test', slug: `attempt-${Date.now()}`, themeKey: 'test' }).onConflictDoNothing();
});

describe('publicBookingAttempt durable authority (PGlite)', () => {
  it('binds one canonical payload under the lock and rejects a mismatched retry without Redis', async () => {
    await registerPublicBookingAttempt({ salonId: SALON, attemptId: ATTEMPT, recoveryKeyHash: PROOF });
    await holder.db.transaction((tx: any) => lockPublicBookingAttempt(tx, { salonId: SALON, attemptId: ATTEMPT, recoveryKeyHash: PROOF, requestHash: HASH_A }));

    await expect(holder.db.transaction((tx: any) => lockPublicBookingAttempt(tx, { salonId: SALON, attemptId: ATTEMPT, recoveryKeyHash: PROOF, requestHash: HASH_B }))).rejects.toThrow('PUBLIC_BOOKING_ATTEMPT_PROOF_MISMATCH');
  });

  it('concurrent same-key lock claim leaves exactly one durable attempt row', async () => {
    await Promise.all([
      holder.db.transaction((tx: any) => lockPublicBookingAttempt(tx, { salonId: SALON, attemptId: ATTEMPT, recoveryKeyHash: PROOF, requestHash: HASH_A })),
      holder.db.transaction((tx: any) => lockPublicBookingAttempt(tx, { salonId: SALON, attemptId: ATTEMPT, recoveryKeyHash: PROOF, requestHash: HASH_A })),
    ]);
    const rows = await holder.db.select().from(attempts).where(and(eq(attempts.salonId, SALON), eq(attempts.attemptId, ATTEMPT)));

    expect(rows).toHaveLength(1);
    expect(rows[0].requestHash).toBe(HASH_A);
  });

  it('fences a stale unlinked durable row and a late arriving create cannot claim it', async () => {
    const recoveryKey = '11111111-1111-4111-8111-111111111111';
    const recoveryHash = hashPublicBookingRecoveryKey(recoveryKey);
    await holder.db.insert(attempts).values({ salonId: SALON, attemptId: ATTEMPT, recoveryKeyHash: recoveryHash, state: 'in_flight', createdAt: new Date(Date.now() - 11 * 60_000) });

    await expect(readPublicBookingAttemptStatus({ salonId: SALON, attemptId: ATTEMPT, recoveryKey, version: 2, startedAt: new Date(Date.now() - 11 * 60_000).toISOString() })).resolves.toEqual({ kind: 'resolved_failure' });
    await expect(holder.db.transaction((tx: any) => lockPublicBookingAttempt(tx, { salonId: SALON, attemptId: ATTEMPT, recoveryKeyHash: recoveryHash, requestHash: HASH_A }))).rejects.toThrow('PUBLIC_BOOKING_ATTEMPT_FAILED');
  });

  it('inserts a proof-bound absent-v2 tombstone after its safe fence and rejects a late create', async () => {
    const recoveryKey = '11111111-1111-4111-8111-111111111111';

    await expect(readPublicBookingAttemptStatus({ salonId: SALON, attemptId: ATTEMPT, recoveryKey, version: 2, startedAt: new Date(Date.now() - 11 * 60_000).toISOString() })).resolves.toEqual({ kind: 'resolved_failure' });
    await expect(holder.db.transaction((tx: any) => lockPublicBookingAttempt(tx, { salonId: SALON, attemptId: ATTEMPT, recoveryKeyHash: hashPublicBookingRecoveryKey(recoveryKey), requestHash: HASH_A }))).rejects.toThrow('PUBLIC_BOOKING_ATTEMPT_FAILED');
  });

  it('does not let a wrong proof or another tenant fail the attempt', async () => {
    await registerPublicBookingAttempt({ salonId: SALON, attemptId: ATTEMPT, recoveryKeyHash: PROOF });

    await expect(finalizePublicBookingAttemptFailure({ salonId: SALON, attemptId: ATTEMPT, recoveryKeyHash: OTHER_PROOF, code: 'VALIDATION_ERROR' })).resolves.toBe(false);
    await expect(finalizePublicBookingAttemptFailure({ salonId: 'other-salon', attemptId: ATTEMPT, recoveryKeyHash: PROOF, code: 'VALIDATION_ERROR' })).resolves.toBe(false);

    const [row] = await holder.db.select().from(attempts).where(and(eq(attempts.salonId, SALON), eq(attempts.attemptId, ATTEMPT)));

    expect(row.state).toBe('in_flight');
  });
});
