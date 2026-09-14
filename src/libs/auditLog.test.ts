/**
 * P3c — logAuditEventTx proofs (§8.5, §17 "audit rows present").
 *
 * The property under test is narrow but load-bearing: a transaction-scoped
 * audit row must commit or roll back ATOMICALLY with the caller's own
 * writes, and — unlike the fire-and-forget `logAuditEvent` — a write
 * failure must surface as a thrown error, never be swallowed.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

// logAuditEventTx never touches the module-global `db` (it inserts through
// the caller's `tx`), but importing this file still evaluates
// `@/libs/DB`'s module body (which imports 'server-only' itself), so it is
// mocked the same way every other billing PGlite suite mocks it.
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

async function seedSalon(id: string) {
  await db.insert(schema.salonSchema).values({ id, name: `Salon ${id}`, slug: `salon-${id}` });
}

const rowsForEntity = (entityId: string) =>
  db.select().from(schema.auditLogSchema).where(eq(schema.auditLogSchema.entityId, entityId));

describe('logAuditEventTx (P3c tx-aware audit helper)', () => {
  it('commits exactly one row through the caller\'s transaction', async () => {
    const { logAuditEventTx } = await import('./auditLog');
    await seedSalon('s_audit_commit');

    await db.transaction(async (tx) => {
      await logAuditEventTx(tx, {
        salonId: 's_audit_commit',
        actorType: 'webhook',
        actorId: 'stripe-billing',
        action: 'checkout_session_created',
        entityType: 'billing_checkout_attempt',
        entityId: 'bca_commit_1',
        metadata: { purpose: 'plan_subscription', billingOfferKey: 'pro_2026_08_monthly' },
      });
    });

    const rows = await rowsForEntity('bca_commit_1');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      salonId: 's_audit_commit',
      actorType: 'webhook',
      actorId: 'stripe-billing',
      action: 'checkout_session_created',
      entityType: 'billing_checkout_attempt',
      entityId: 'bca_commit_1',
    });
  });

  it('a forced rollback after the audit call leaves NO row', async () => {
    const { logAuditEventTx } = await import('./auditLog');
    await seedSalon('s_audit_rollback');

    await expect(db.transaction(async (tx) => {
      await logAuditEventTx(tx, {
        salonId: 's_audit_rollback',
        actorType: 'webhook',
        actorId: 'stripe-billing',
        action: 'checkout_session_created',
        entityType: 'billing_checkout_attempt',
        entityId: 'bca_rollback_1',
        metadata: { purpose: 'plan_subscription' },
      });
      throw new Error('forced rollback');
    })).rejects.toThrow('forced rollback');

    expect(await rowsForEntity('bca_rollback_1')).toHaveLength(0);
  });

  it('throws (never swallows) when the insert itself fails', async () => {
    const { logAuditEventTx } = await import('./auditLog');

    // No salon 's_audit_missing' exists — the audit_log.salon_id foreign key
    // (migrations/0031_add_audit_log.sql) rejects the insert. Unlike
    // logAuditEvent, this must propagate rather than log-and-continue.
    await expect(db.transaction(async (tx) => {
      await logAuditEventTx(tx, {
        salonId: 's_audit_missing_fk',
        actorType: 'webhook',
        actorId: 'stripe-billing',
        action: 'checkout_session_created',
        entityType: 'billing_checkout_attempt',
        entityId: 'bca_fk_fail',
      });
    })).rejects.toThrow();

    expect(await rowsForEntity('bca_fk_fail')).toHaveLength(0);
  });

  it('sanitizes sensitive metadata keys the same way as logAuditEvent', async () => {
    const { logAuditEventTx } = await import('./auditLog');
    await seedSalon('s_audit_sanitize');

    await db.transaction(async (tx) => {
      await logAuditEventTx(tx, {
        salonId: 's_audit_sanitize',
        actorType: 'webhook',
        actorId: 'stripe-billing',
        action: 'checkout_session_created',
        entityType: 'billing_checkout_attempt',
        entityId: 'bca_sanitize_1',
        metadata: { token: 'should-be-redacted', billingOfferKey: 'pro_2026_08_monthly' },
      });
    });

    const [row] = await rowsForEntity('bca_sanitize_1');

    expect(row!.metadata).toEqual({ token: '[REDACTED]', billingOfferKey: 'pro_2026_08_monthly' });
  });
});
