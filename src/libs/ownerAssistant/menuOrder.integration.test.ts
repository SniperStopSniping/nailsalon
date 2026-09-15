import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { applyMenuOrder, getMenuOperation, prepareMenuOrder, reorderSalonMenu, undoMenuOrder } from './menuOrder.server';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));

const SALON = 'owner_assistant_menu_salon';
const ACTOR = 'owner_assistant_menu_actor';
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  db = drizzle(new PGlite());
  holder.db = db;
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
});

beforeEach(async () => {
  await db.delete(schema.ownerAssistantMenuOperationSchema);
  await db.delete(schema.serviceSchema);
  await db.delete(schema.serviceMenuRevisionSchema);
  await db.delete(schema.adminSalonMembershipSchema);
  await db.delete(schema.adminUserSchema);
  await db.delete(schema.salonSchema);
  await db.insert(schema.salonSchema).values({ id: SALON, name: 'Assistant Test', slug: SALON });
  await db.insert(schema.adminUserSchema).values({ id: ACTOR, phoneE164: '+14165550000' });
  await db.insert(schema.adminSalonMembershipSchema).values({ adminId: ACTOR, salonId: SALON, role: 'owner' });
  await db.insert(schema.serviceSchema).values([
    { id: 'svc_a', salonId: SALON, name: 'A', price: 1000, durationMinutes: 30, category: 'manicure', bookingCategory: 'manicure', sortOrder: 10 },
    { id: 'svc_b', salonId: SALON, name: 'B', price: 2000, durationMinutes: 45, category: 'manicure', bookingCategory: 'manicure', sortOrder: 20 },
  ]);
});

describe('owner assistant menu order', () => {
  it('persists an exact preview, applies it once, and restores the exact prior sort orders', async () => {
    const proposal = await prepareMenuOrder({ salonId: SALON, actorAdminId: ACTOR, idempotencyKey: crypto.randomUUID(), orderedIds: ['svc_b', 'svc_a'] });

    expect(proposal).toMatchObject({ status: 'ready', oldOrder: [{ id: 'svc_a', sortOrder: 10 }, { id: 'svc_b', sortOrder: 20 }] });

    const applied = await applyMenuOrder({ salonId: SALON, actorAdminId: ACTOR, proposalId: proposal.id });

    expect(applied.status).toBe('applied');
    expect((await applyMenuOrder({ salonId: SALON, actorAdminId: ACTOR, proposalId: proposal.id })).status).toBe('already_applied');

    const undone = await undoMenuOrder({ salonId: SALON, actorAdminId: ACTOR, proposalId: proposal.id });

    expect(undone.currentOrder).toEqual(proposal.oldOrder);
  });

  it('rejects apply after an ordinary service mutation advances the database revision', async () => {
    const proposal = await prepareMenuOrder({ salonId: SALON, actorAdminId: ACTOR, idempotencyKey: crypto.randomUUID(), orderedIds: ['svc_b', 'svc_a'] });
    await db.update(schema.serviceSchema).set({ name: 'A changed' }).where(eq(schema.serviceSchema.id, 'svc_a'));

    await expect(applyMenuOrder({ salonId: SALON, actorAdminId: ACTOR, proposalId: proposal.id })).rejects.toMatchObject({ code: 'STALE' });
  });

  it('binds idempotency and receipts to the owning actor, and makes an unchanged order a no-op', async () => {
    const key = crypto.randomUUID();
    const noOp = await prepareMenuOrder({ salonId: SALON, actorAdminId: ACTOR, idempotencyKey: key, orderedIds: ['svc_a', 'svc_b'] });

    expect(noOp.status).toBe('no_op');
    await expect(prepareMenuOrder({ salonId: SALON, actorAdminId: ACTOR, idempotencyKey: key, orderedIds: ['svc_b', 'svc_a'] })).rejects.toMatchObject({ code: 'INVALID_ORDER' });
    await expect(applyMenuOrder({ salonId: SALON, actorAdminId: 'another-owner', proposalId: noOp.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('invalidates a preview when another service is inserted after the exact preview', async () => {
    const proposal = await prepareMenuOrder({ salonId: SALON, actorAdminId: ACTOR, idempotencyKey: crypto.randomUUID(), orderedIds: ['svc_b', 'svc_a'] });
    await db.insert(schema.serviceSchema).values({ id: 'svc_c', salonId: SALON, name: 'C', price: 3000, durationMinutes: 30, category: 'manicure', bookingCategory: 'manicure', sortOrder: 30 });

    await expect(applyMenuOrder({ salonId: SALON, actorAdminId: ACTOR, proposalId: proposal.id })).rejects.toMatchObject({ code: 'STALE' });
  });

  it('does not mutate unrelated service fields and rejects delete/expired previews', async () => {
    const proposal = await prepareMenuOrder({ salonId: SALON, actorAdminId: ACTOR, idempotencyKey: crypto.randomUUID(), orderedIds: ['svc_b', 'svc_a'] });
    await applyMenuOrder({ salonId: SALON, actorAdminId: ACTOR, proposalId: proposal.id });
    const services = await db.select().from(schema.serviceSchema).orderBy(schema.serviceSchema.id);

    expect(services.map(service => ({ id: service.id, price: service.price, duration: service.durationMinutes }))).toEqual([
      { id: 'svc_a', price: 1000, duration: 30 },
      { id: 'svc_b', price: 2000, duration: 45 },
    ]);

    const deleteProposal = await prepareMenuOrder({ salonId: SALON, actorAdminId: ACTOR, idempotencyKey: crypto.randomUUID(), orderedIds: ['svc_a', 'svc_b'] });
    await db.delete(schema.serviceSchema).where(eq(schema.serviceSchema.id, 'svc_b'));

    await expect(applyMenuOrder({ salonId: SALON, actorAdminId: ACTOR, proposalId: deleteProposal.id })).rejects.toMatchObject({ code: 'STALE' });
  });

  it('expires a prepared operation without writing its menu order', async () => {
    const proposal = await prepareMenuOrder({ salonId: SALON, actorAdminId: ACTOR, idempotencyKey: crypto.randomUUID(), orderedIds: ['svc_b', 'svc_a'] });
    await db.update(schema.ownerAssistantMenuOperationSchema).set({ createdAt: new Date(Date.now() - 16 * 60 * 1000) }).where(eq(schema.ownerAssistantMenuOperationSchema.id, proposal.id));

    await expect(applyMenuOrder({ salonId: SALON, actorAdminId: ACTOR, proposalId: proposal.id })).rejects.toMatchObject({ code: 'STALE' });
  });

  it('rejects an ABA edit even when the visible menu returns to its original values', async () => {
    const proposal = await prepareMenuOrder({ salonId: SALON, actorAdminId: ACTOR, idempotencyKey: crypto.randomUUID(), orderedIds: ['svc_b', 'svc_a'] });

    await db.update(schema.serviceSchema).set({ name: 'temporary name' }).where(eq(schema.serviceSchema.id, 'svc_a'));
    await db.update(schema.serviceSchema).set({ name: 'A' }).where(eq(schema.serviceSchema.id, 'svc_a'));

    await expect(applyMenuOrder({ salonId: SALON, actorAdminId: ACTOR, proposalId: proposal.id })).rejects.toMatchObject({ code: 'STALE' });
  });

  it('rolls back menu writes when the durable receipt update fails', async () => {
    const proposal = await prepareMenuOrder({ salonId: SALON, actorAdminId: ACTOR, idempotencyKey: crypto.randomUUID(), orderedIds: ['svc_b', 'svc_a'] });
    const revisionBefore = await db.select().from(schema.serviceMenuRevisionSchema);
    await db.execute(sql.raw(`
      CREATE FUNCTION reject_owner_assistant_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 'applied' THEN RAISE EXCEPTION 'receipt rejected'; END IF;
        RETURN NEW;
      END;
      $$;
    `));
    await db.execute(sql.raw(`
      CREATE TRIGGER reject_owner_assistant_receipt_trigger BEFORE UPDATE ON owner_assistant_menu_operation
      FOR EACH ROW EXECUTE FUNCTION reject_owner_assistant_receipt();
    `));
    try {
      await expect(applyMenuOrder({ salonId: SALON, actorAdminId: ACTOR, proposalId: proposal.id })).rejects.toThrow('receipt rejected');

      const rows = await db.select().from(schema.serviceSchema).orderBy(schema.serviceSchema.id);
      const [operation] = await db.select().from(schema.ownerAssistantMenuOperationSchema).where(eq(schema.ownerAssistantMenuOperationSchema.id, proposal.id));

      expect(rows.map(row => row.sortOrder)).toEqual([10, 20]);
      expect(operation?.status).toBe('ready');
      expect(await db.select().from(schema.serviceMenuRevisionSchema)).toEqual(revisionBefore);
    } finally {
      await db.execute(sql.raw('DROP TRIGGER reject_owner_assistant_receipt_trigger ON owner_assistant_menu_operation;'));
      await db.execute(sql.raw('DROP FUNCTION reject_owner_assistant_receipt();'));
    }
  });

  it('rejects foreign tenant records and a revoked owner without touching services', async () => {
    const proposal = await prepareMenuOrder({ salonId: SALON, actorAdminId: ACTOR, idempotencyKey: crypto.randomUUID(), orderedIds: ['svc_b', 'svc_a'] });
    await db.insert(schema.salonSchema).values({ id: 'foreign_salon', slug: 'foreign_salon', name: 'Foreign' });
    await db.insert(schema.adminSalonMembershipSchema).values({ adminId: ACTOR, salonId: 'foreign_salon', role: 'owner' });
    const foreign = { salonId: 'foreign_salon', actorAdminId: ACTOR, proposalId: proposal.id };

    await expect(getMenuOperation(foreign)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(applyMenuOrder(foreign)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(undoMenuOrder(foreign)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(prepareMenuOrder({ salonId: 'foreign_salon', actorAdminId: ACTOR, idempotencyKey: crypto.randomUUID(), orderedIds: ['svc_b', 'svc_a'] })).rejects.toMatchObject({ code: 'INVALID_ORDER' });

    await db.delete(schema.adminSalonMembershipSchema).where(eq(schema.adminSalonMembershipSchema.salonId, SALON));

    await expect(applyMenuOrder({ salonId: SALON, actorAdminId: ACTOR, proposalId: proposal.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await db.select().from(schema.serviceSchema).orderBy(schema.serviceSchema.id)).map(item => item.sortOrder)).toEqual([10, 20]);
  });

  it('keeps ordinary reordering available before migration 0078 tables exist', async () => {
    await db.execute(sql.raw('DROP TRIGGER service_menu_revision_bump_trigger ON service;'));
    await db.execute(sql.raw('DROP FUNCTION service_menu_revision_bump();'));
    await db.execute(sql.raw('DROP TABLE owner_assistant_menu_operation;'));
    await db.execute(sql.raw('DROP TABLE service_menu_revision;'));
    const order = await reorderSalonMenu(SALON, ['svc_b', 'svc_a']);

    expect(order.map(item => item.id)).toEqual(['svc_b', 'svc_a']);
    expect((await db.select().from(schema.serviceSchema).orderBy(schema.serviceSchema.id)).map(item => item.sortOrder)).toEqual([2, 1]);
  });
});
