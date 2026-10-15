import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

import { runSetupModel } from './ai-trial.server';
import { CLOSED_HOURS } from './contracts';
import { approveSetup, editSetup, openSetup, reviewSetup } from './drafts.server';
import { publishSetup } from './publish.server';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/features/onboarding-v1-integration/canonical-profile-media-lifecycle.server', () => ({
  prepareCanonicalProfileMediaForPublish: vi.fn(async () => null),
  applyPreparedCanonicalProfileMediaPromotion: vi.fn(),
  completeCanonicalProfileMediaPromotion: vi.fn(),
}));
const raw = process.env.CONCURRENCY_TEST_DATABASE_URL;
const target = raw ? requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: raw }) : null;
let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  if (!target) {
    return;
  }
  pool = new Pool({ connectionString: target.connectionString, max: 6 });
  const client = await pool.connect();
  try {
    await attestDisposableDatabaseSession(client, target, resolveDisposableDatabaseServerExpectation(target));
  } finally {
    client.release();
  }
  database = drizzle(pool, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = database;
}, 60000);

afterAll(async () => {
  await pool?.end();
});

async function fixture() {
  const actor = { salonId: randomUUID(), adminId: randomUUID() };
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.salonSchema).values({ id: actor.salonId, slug: actor.salonId, name: 'Before', publicationStatus: 'draft', onlineBookingEnabled: false });
  await database.insert(schema.adminSalonMembershipSchema).values({ ...actor, role: 'owner' });
  await openSetup(actor);
  await editSetup(actor, { expectedRevision: 1, operationId: randomUUID(), operations: [
    { type: 'business', values: { name: 'Concurrent test', workMode: 'solo', city: 'Toronto' } },
    { type: 'hours', values: { ...CLOSED_HOURS, monday: { open: '09:00', close: '17:00' } } },
    { type: 'service', values: { id: 'draft_service', name: 'Gel', description: null, priceCents: 6000, durationMinutes: 60, preparationBufferMinutes: 0, cleanupBufferMinutes: 10, category: 'manicure', bookingCategory: 'manicure' } },
  ] });
  const review = await reviewSetup(actor);
  const approval = await approveSetup(actor, review.revision, review.hash);
  return { actor, input: { approvalId: approval.id, operationId: randomUUID(), revision: review.revision } };
}

describe.skipIf(!target)('setup publication on attested disposable PostgreSQL', () => {
  it('serializes duplicate concurrent publication into one receipt and one service', async () => {
    const { actor, input } = await fixture();
    const results = await Promise.all([publishSetup(actor, input), publishSetup(actor, input)]);

    expect(results[0]!.receipt.id).toBe(results[1]!.receipt.id);
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(1);
  });

  it('waits for a manual salon update and rejects the stale approval', async () => {
    const { actor, input } = await fixture();
    const connection = await pool.connect();
    let pending: ReturnType<typeof publishSetup> | undefined;
    try {
      await connection.query('BEGIN');
      await connection.query('UPDATE salon SET name = $1 WHERE id = $2', ['Manual new name', actor.salonId]);
      // Catch immediately to avoid an unhandled rejection if a regression
      // bypasses the row lock and fails sooner than expected.
      pending = publishSetup(actor, input);
      const settled = pending.then(value => ({ value }), error => ({ error }));
      await vi.waitFor(async () => {
        const waiting = await pool.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = \'Lock\'');

        expect(waiting.rows[0].count).toBeGreaterThan(0);
      });
      await connection.query('COMMIT');

      expect(await settled).toMatchObject({ error: { code: 'STALE' } });
      expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);
    } finally {
      await connection.query('ROLLBACK');
      connection.release();
    }
  });

  it('rolls back service creation when a later canonical write fails', async () => {
    const { actor, input } = await fixture();
    // Fail the final audit write for this synthetic actor only. No application
    // function is mocked: PostgreSQL aborts the production transaction.
    const name = `test_setup_failure_${actor.adminId.replaceAll('-', '')}`;
    await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_id = '${actor.adminId}' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    try {
      await expect(publishSetup(actor, input)).rejects.toThrow();
      expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(0);

      const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, actor.salonId));

      expect(salon?.publicationStatus).toBe('draft');
    } finally {
      await pool.query(`DROP TRIGGER ${name} ON audit_log`);
      await pool.query(`DROP FUNCTION ${name}()`);
    }

    expect((await publishSetup(actor, input)).receipt.serviceIds.draft_service).toBeTruthy();
  });
});

describe.skipIf(!target)('AI trial global reservation on PostgreSQL', () => {
  it('admits only one simultaneous call when different salons compete for the remaining budget', async () => {
    const first = await fixture();
    const second = await fixture();
    const history = await database.select().from(schema.setupAiCallSchema);
    const used = history.reduce((sum, row) => sum + row.chargedMicroCad, 0);
    await database.insert(schema.setupAiBudgetSchema).values({ id: 'initial-custom-website-trial', capMicroCad: used + 1900000 }).onConflictDoUpdate({ target: schema.setupAiBudgetSchema.id, set: { capMicroCad: used + 1900000 } });
    const createResponse = vi.fn().mockResolvedValue({ status: 'completed', usage: null, items: [] });
    const request = { model: 'gpt-6-astra', input: [{ role: 'user' as const, content: 'Synthetic test' }], tools: [], toolChoice: 'none' as const, maxOutputTokens: 14000, timeoutMs: 1000, jsonMode: 'prompt' as const };
    try {
      const results = await Promise.allSettled([first, second].map(({ actor }) => runSetupModel(actor, { operationId: randomUUID(), ordinal: 0, expectedRevision: 2, request }, { createResponse })));

      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
      expect(createResponse).toHaveBeenCalledTimes(1);

      const after = await database.select().from(schema.setupAiCallSchema);

      expect(after.reduce((sum, row) => sum + row.chargedMicroCad, 0)).toBeLessThanOrEqual(used + 1900000);
    } finally {
      await database.update(schema.setupAiBudgetSchema).set({ capMicroCad: 40000000 });
    }
  });
});
