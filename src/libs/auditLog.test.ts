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

/**
 * RT-13 (PR-1/R-8): the sanitizer walks metadata before it is stored, and a
 * Date is an `object`. Without an explicit branch the generic walk turned
 * every Date into `{}` — silently erasing the refund coverage bounds that
 * §6.7 evidence is read back from.
 */
describe('sanitizeAuditMetadata — Date serialization (R-8)', () => {
  it('serializes a top-level Date to its ISO string, never to an empty object', async () => {
    const { sanitizeAuditMetadata } = await import('./auditLog');
    const at = new Date('2026-09-01T10:00:00.000Z');

    expect(sanitizeAuditMetadata({ refundedPeriodStart: at })).toEqual({
      refundedPeriodStart: '2026-09-01T10:00:00.000Z',
    });
  });

  it('serializes nested and array-held Dates at every depth', async () => {
    const { sanitizeAuditMetadata } = await import('./auditLog');

    expect(sanitizeAuditMetadata({
      coverage: { start: new Date('2026-09-01T10:00:00.000Z'), end: new Date('2026-10-01T10:00:00.000Z') },
      observedAt: [new Date('2026-09-02T00:00:00.000Z')],
    })).toEqual({
      coverage: { start: '2026-09-01T10:00:00.000Z', end: '2026-10-01T10:00:00.000Z' },
      observedAt: ['2026-09-02T00:00:00.000Z'],
    });
  });

  it('preserves every v2 refund-evidence field byte-identically while still redacting sensitive keys', async () => {
    const { sanitizeAuditMetadata } = await import('./auditLog');
    const metadata = {
      evidenceVersion: 2,
      seq: 7,
      invoiceId: 'in_1',
      refundIds: ['re_1', 're_2'],
      eventId: 'evt_1',
      refundedPeriodStart: '2026-09-01T10:00:00.000Z',
      refundedPeriodEnd: '2026-10-01T10:00:00.000Z',
      observedAmountRefunded: 1200,
      observedAmount: 2400,
      sessionSecret: 'private',
    };

    expect(sanitizeAuditMetadata(metadata)).toEqual({
      evidenceVersion: 2,
      seq: 7,
      invoiceId: 'in_1',
      refundIds: ['re_1', 're_2'],
      eventId: 'evt_1',
      refundedPeriodStart: '2026-09-01T10:00:00.000Z',
      refundedPeriodEnd: '2026-10-01T10:00:00.000Z',
      observedAmountRefunded: 1200,
      observedAmount: 2400,
      sessionSecret: '[REDACTED]',
    });
  });

  it('stores a Date passed through logAuditEventTx as a readable ISO string', async () => {
    const { logAuditEventTx } = await import('./auditLog');
    await seedSalon('s_audit_date');

    await db.transaction(async (tx) => {
      await logAuditEventTx(tx, {
        salonId: 's_audit_date',
        actorType: 'webhook',
        actorId: 'stripe-billing',
        action: 'billing_subscription_refund_applied',
        entityType: 'billing_subscription',
        entityId: 'bsub_audit_date',
        metadata: { refundedPeriodStart: new Date('2026-09-01T10:00:00.000Z') },
      });
    });

    const [row] = await rowsForEntity('bsub_audit_date');

    expect(row!.metadata).toEqual({ refundedPeriodStart: '2026-09-01T10:00:00.000Z' });
  });
});
