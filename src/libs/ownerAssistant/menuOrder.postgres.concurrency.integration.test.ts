import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { applyMenuOrder, prepareMenuOrder, reorderSalonMenu, undoMenuOrder } from './menuOrder.server';

const rawUrl = process.env.OWNER_ASSISTANT_TEST_DATABASE_URL ?? '';
const enabled = process.env.OWNER_ASSISTANT_DISPOSABLE_DATABASE_CONFIRMED === 'true';
const url = rawUrl ? new URL(rawUrl) : null;
const runnable = enabled && url?.hostname === '127.0.0.1' && url.port === '55439' && url.pathname === '/owner_assistant_disposable';
if (enabled && !runnable) {
  throw new Error('Owner-assistant concurrency target is not the attested disposable local database.');
}

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));

const SALON = 'owner_assistant_pg_salon';
const ACTOR = 'owner_assistant_pg_actor';
let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  if (!runnable) {
    return;
  }
  pool = new pg.Pool({ connectionString: rawUrl, max: 6, application_name: 'owner-assistant-apply-test' });
  db = drizzle(pool, { schema });
  holder.db = db;
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
});

beforeEach(async () => {
  if (!runnable) {
    return;
  }
  await db.delete(schema.salonSchema).where(eq(schema.salonSchema.id, SALON));
  await db.delete(schema.adminUserSchema).where(eq(schema.adminUserSchema.id, ACTOR));
  await db.insert(schema.salonSchema).values({ id: SALON, name: 'PG assistant', slug: SALON });
  await db.insert(schema.adminUserSchema).values({ id: ACTOR, phoneE164: '+14165550001' });
  await db.insert(schema.adminSalonMembershipSchema).values({ adminId: ACTOR, salonId: SALON, role: 'owner' });
  await db.insert(schema.serviceSchema).values([
    { id: 'pg_svc_a', salonId: SALON, name: 'A', price: 1, durationMinutes: 5, category: 'manicure', bookingCategory: 'manicure', sortOrder: 1 },
    { id: 'pg_svc_b', salonId: SALON, name: 'B', price: 1, durationMinutes: 5, category: 'manicure', bookingCategory: 'manicure', sortOrder: 2 },
  ]);
});

afterAll(async () => {
  if (runnable) {
    await pool.end();
  }
});

describe.skipIf(!runnable)('owner assistant menu order PostgreSQL concurrency', () => {
  it('serializes concurrent Apply requests into one write and one durable replay', async () => {
    const proposal = await prepareMenuOrder({ salonId: SALON, actorAdminId: ACTOR, idempotencyKey: crypto.randomUUID(), orderedIds: ['pg_svc_b', 'pg_svc_a'] });
    const results = await Promise.all([applyMenuOrder({ salonId: SALON, actorAdminId: ACTOR, proposalId: proposal.id }), applyMenuOrder({ salonId: SALON, actorAdminId: ACTOR, proposalId: proposal.id })]);

    expect(results.map(result => result.status).sort()).toEqual(['already_applied', 'applied']);
  });

  it('refuses undo after an ordinary menu reorder wins the revision race', async () => {
    const proposal = await prepareMenuOrder({ salonId: SALON, actorAdminId: ACTOR, idempotencyKey: crypto.randomUUID(), orderedIds: ['pg_svc_b', 'pg_svc_a'] });
    await applyMenuOrder({ salonId: SALON, actorAdminId: ACTOR, proposalId: proposal.id });
    await reorderSalonMenu(SALON, ['pg_svc_a', 'pg_svc_b']);

    await expect(undoMenuOrder({ salonId: SALON, actorAdminId: ACTOR, proposalId: proposal.id })).rejects.toMatchObject({ code: 'UNDO_UNAVAILABLE' });
  });

  it('waits behind an ordinary writer, then fails stale without committing a receipt', async () => {
    const proposal = await prepareMenuOrder({ salonId: SALON, actorAdminId: ACTOR, idempotencyKey: crypto.randomUUID(), orderedIds: ['pg_svc_b', 'pg_svc_a'] });
    const writer = new pg.Client({ connectionString: rawUrl, application_name: 'owner-assistant-writer-test' });
    const observer = new pg.Client({ connectionString: rawUrl, application_name: 'owner-assistant-observer-test' });
    await writer.connect();
    await observer.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(`UPDATE service SET name = 'writer change' WHERE id = 'pg_svc_a'`);
      const pending = applyMenuOrder({ salonId: SALON, actorAdminId: ACTOR, proposalId: proposal.id });
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await observer.query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = 'owner-assistant-apply-test' AND wait_event_type = 'Lock'`);
        if (result.rows[0]?.count !== '0') {
          blocked = true;
          break;
        }
        await new Promise<void>(resolve => setTimeout(resolve, 10));
      }

      expect(blocked).toBe(true);

      await writer.query('COMMIT');

      await expect(pending).rejects.toMatchObject({ code: 'STALE' });

      const [operation] = await db.select().from(schema.ownerAssistantMenuOperationSchema).where(eq(schema.ownerAssistantMenuOperationSchema.id, proposal.id));

      expect(operation?.status).toBe('ready');
    } finally {
      await writer.query('ROLLBACK').catch(() => undefined);
      await writer.end();
      await observer.end();
    }
  });
});
