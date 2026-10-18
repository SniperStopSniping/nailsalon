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
import { runSetupConversation } from './conversation.server';
import { approveSetup, editSetup, openSetup, resetSetupDraft, restartSetup, reviewSetup } from './drafts.server';
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
if (process.env.AI_SETUP_PUBLICATION_CONCURRENCY_REQUIRED === 'true' && !raw) {
  throw new Error('An attested disposable database is required for setup publication concurrency tests.');
}
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

async function teamFixture() {
  const { actor } = await fixture();
  await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [
    { type: 'business', values: { workMode: 'team' } },
    ...['Alex', 'Sam'].map(name => ({ type: 'staff', values: { id: `draft_${name}`, name, isActive: true, hours: { ...CLOSED_HOURS, monday: { open: '09:00', close: '17:00' } }, serviceIds: ['draft_service'], assignmentMode: 'explicit' } })),
  ] });
  const review = await reviewSetup(actor);
  const approval = await approveSetup(actor, review.revision, review.hash);
  return { actor, input: { approvalId: approval.id, operationId: randomUUID(), revision: review.revision } };
}

describe.skipIf(!target)('setup publication on attested disposable PostgreSQL', () => {
  it('accepts a fresh owner conversation when PostgreSQL uses a non-UTC timezone', async () => {
    const connection = await pool.connect();
    const normal = holder.db;
    try {
      await connection.query('SET TIME ZONE \'America/Toronto\'');
      holder.db = drizzle(connection, { schema });
      const { actor } = await fixture();
      const operationId = randomUUID();
      const createResponse = vi.fn().mockResolvedValue({ status: 'completed', usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50 }, items: [{ type: 'message', text: JSON.stringify({ reply: 'Your draft is ready to continue.', operationsJson: '[]', designRequest: null }) }] });
      await runSetupConversation(actor, { expectedRevision: 2, operationId, scope: 'business_and_website', message: 'Continue my saved setup.' }, { createResponse });
      const [turn] = await drizzle(connection, { schema }).select().from(schema.businessSetupTurnSchema).where(eq(schema.businessSetupTurnSchema.id, operationId));

      expect(createResponse).toHaveBeenCalledTimes(1);
      expect(turn?.status).toBe('completed');
      expect(Math.abs(Date.now() - turn!.createdAt.getTime())).toBeLessThan(10000);
      expect(turn!.leaseExpiresAt.getTime() - turn!.createdAt.getTime()).toBeGreaterThan(50000);
    } finally {
      holder.db = normal;
      await connection.query('RESET TIME ZONE');
      connection.release();
    }
  });

  it('serializes duplicate concurrent publication into one receipt and one service', async () => {
    const { actor, input } = await fixture();
    const results = await Promise.all([publishSetup(actor, input), publishSetup(actor, input)]);

    expect(results[0]!.receipt.id).toBe(results[1]!.receipt.id);
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(1);
  });

  it('commits concurrent add-on publication once, including its canonical service relationship', async () => {
    const { actor } = await fixture();
    await editSetup(actor, { expectedRevision: 2, operationId: randomUUID(), operations: [{ type: 'add_on', values: { id: 'draft_art', name: 'Simple art', category: 'nail_art', descriptionItems: null, priceCents: 1000, durationMinutes: 15, pricingType: 'fixed', unitLabel: null, maxQuantity: null, isActive: true, serviceIds: ['draft_service'] } }] });
    const review = await reviewSetup(actor);
    const approval = await approveSetup(actor, review.revision, review.hash);
    const input = { revision: review.revision, approvalId: approval.id, operationId: randomUUID() };
    const results = await Promise.all([publishSetup(actor, input), publishSetup(actor, input)]);

    expect(results[0]!.receipt).toEqual(results[1]!.receipt);
    expect(results[0]!.receipt.addOnIds.draft_art).toBeTruthy();
    expect(await database.select().from(schema.addOnSchema).where(eq(schema.addOnSchema.salonId, actor.salonId))).toHaveLength(1);
    expect(await database.select().from(schema.serviceAddOnSchema).where(eq(schema.serviceAddOnSchema.salonId, actor.salonId))).toHaveLength(1);

    const current = await restartSetup(actor, input.revision);
    const addOn = current.revision.document.addOns![0]!;
    const { origin: _origin, confirmed: _confirmed, groupId: _group, advancedRules: _rules, ...values } = addOn;
    await editSetup(actor, { expectedRevision: current.revision.revision, operationId: randomUUID(), operations: [{ type: 'add_on', values: { ...values, priceCents: 1200 } }] });
    const next = await reviewSetup(actor);
    const nextApproval = await approveSetup(actor, next.revision, next.hash);
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('UPDATE add_on SET price_cents = $1 WHERE id = $2', [1400, addOn.id]);
      const pending = publishSetup(actor, { revision: next.revision, approvalId: nextApproval.id, operationId: randomUUID() }).then(value => ({ value }), error => ({ error }));
      await vi.waitFor(async () => {
        const waiting = await pool.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = \'Lock\'');

        expect(waiting.rows[0].count).toBeGreaterThan(0);
      });
      await connection.query('COMMIT');

      expect(await pending).toMatchObject({ error: { code: 'STALE' } });
      expect((await database.select().from(schema.addOnSchema).where(eq(schema.addOnSchema.id, addOn.id)))[0]?.priceCents).toBe(1400);
    } finally {
      await connection.query('ROLLBACK');
      connection.release();
    }
  });

  it('serializes duplicate team publication into one mapping without duplicate staff', async () => {
    const { actor, input } = await teamFixture();
    const results = await Promise.all([publishSetup(actor, input), publishSetup(actor, input)]);

    expect(results[0]!.receipt).toEqual(results[1]!.receipt);
    expect(Object.keys(results[0]!.receipt.staffIds).sort()).toEqual(['draft_Alex', 'draft_Sam']);
    expect(await database.select().from(schema.technicianSchema).where(eq(schema.technicianSchema.salonId, actor.salonId))).toHaveLength(2);
    expect(await database.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, actor.salonId))).toHaveLength(1);
  });

  it('waits for an older manual staff route and rejects its newer data instead of overwriting it', async () => {
    const { actor, input } = await teamFixture();
    const first = await publishSetup(actor, input);
    const reopened = await restartSetup(actor, input.revision);
    const person = reopened.revision.document.staff!.find(person => person.id === first.receipt.staffIds.draft_Alex)!;
    await editSetup(actor, { expectedRevision: reopened.revision.revision, operationId: randomUUID(), operations: [{ type: 'staff', values: { ...person, name: 'Proposed name' } }] });
    const review = await reviewSetup(actor);
    const approval = await approveSetup(actor, review.revision, review.hash);
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      // Deliberately no salon lock: this matches older manual staff writers.
      await connection.query('UPDATE technician SET name = $1 WHERE id = $2', ['Newer manual name', person.id]);
      const pending = publishSetup(actor, { revision: review.revision, approvalId: approval.id, operationId: randomUUID() }).then(value => ({ value }), error => ({ error }));
      await vi.waitFor(async () => {
        const waiting = await pool.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = \'Lock\'');

        expect(waiting.rows[0].count).toBeGreaterThan(0);
      });
      await connection.query('COMMIT');

      expect(await pending).toMatchObject({ error: { code: 'STALE' } });
      expect((await database.select().from(schema.technicianSchema).where(eq(schema.technicianSchema.id, person.id)))[0]?.name).toBe('Newer manual name');
      expect(await database.select().from(schema.businessSetupPublicationSchema).where(eq(schema.businessSetupPublicationSchema.salonId, actor.salonId))).toHaveLength(1);
    } finally {
      await connection.query('ROLLBACK');
      connection.release();
    }
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

      expect(await database.select().from(schema.technicianSchema).where(eq(schema.technicianSchema.salonId, actor.salonId))).toHaveLength(0);
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
    await database.insert(schema.setupAiBudgetSchema).values({ id: 'initial-custom-website-trial', capMicroCad: used + 400000 }).onConflictDoUpdate({ target: schema.setupAiBudgetSchema.id, set: { capMicroCad: used + 400000 } });
    const createResponse = vi.fn().mockResolvedValue({ status: 'completed', usage: null, items: [] });
    const request = { model: 'gpt-6.1-sol', input: [{ role: 'user' as const, content: 'Synthetic test' }], tools: [], toolChoice: 'none' as const, maxOutputTokens: 14000, timeoutMs: 1000, jsonMode: 'prompt' as const };
    try {
      const results = await Promise.allSettled([first, second].map(({ actor }) => runSetupModel(actor, { operationId: randomUUID(), ordinal: 0, expectedRevision: 2, request }, { createResponse })));

      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
      expect(createResponse).toHaveBeenCalledTimes(1);

      const after = await database.select().from(schema.setupAiCallSchema);

      expect(after.reduce((sum, row) => sum + row.chargedMicroCad, 0)).toBeLessThanOrEqual(used + 400000);
    } finally {
      await database.update(schema.setupAiBudgetSchema).set({ capMicroCad: 40000000 });
    }
  });
});

describe.skipIf(!target)('full reset on attested disposable PostgreSQL', () => {
  it('serializes duplicate reset requests into one archived boundary', async () => {
    const { actor } = await fixture();
    const input = { expectedRevision: 2, operationId: randomUUID() };
    const results = await Promise.all([resetSetupDraft(actor, input), resetSetupDraft(actor, input)]);

    expect(results[0].revision.revision).toBe(3);
    expect(results[1].revision.revision).toBe(3);
    expect(await database.select().from(schema.businessSetupRevisionSchema).where(eq(schema.businessSetupRevisionSchema.salonId, actor.salonId))).toHaveLength(3);
  });

  it('allows only one competing tab to reset the same draft', async () => {
    const { actor } = await fixture();
    const results = await Promise.allSettled([resetSetupDraft(actor, { expectedRevision: 2, operationId: randomUUID() }), resetSetupDraft(actor, { expectedRevision: 2, operationId: randomUUID() })]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'STALE' } });
    expect((await openSetup(actor)).revision.document.sessionStartRevision).toBe(3);
  });
});
