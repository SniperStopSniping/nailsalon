/**
 * PR-1/R-2 — the refund-evidence reader is the single seam every §6.7
 * exclusion is derived from, so its effective-state table is pinned here
 * directly rather than only through the projection that consumes it.
 *
 * The invariants under test:
 *   - evidence is APPEND-ONLY: a correction supersedes, never deletes;
 *   - the effective row for an invoice is the highest `seq`, and ordering
 *     NEVER depends on clocks (a replayed correction can carry an older
 *     `created_at` than the row it supersedes);
 *   - anything unreadable — no invoice identity, unknown version, unknown
 *     resolution verb, unusable bounds — fails CLOSED (`incomplete`), which
 *     the consumers read as "everything is refunded".
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

let db: ReturnType<typeof drizzle<typeof schema>>;

const T0 = new Date('2026-09-01T10:00:00.000Z');
const T1 = new Date('2026-10-01T10:00:00.000Z');
const T2 = new Date('2026-11-01T10:00:00.000Z');

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

let auditRowCounter = 0;

async function seedSalon(id: string) {
  await db.insert(schema.salonSchema).values({ id, name: id, slug: id });
}

/** Writes raw evidence, exactly as a historical or foreign writer would have. */
async function seedEvidence(input: {
  salonId: string;
  entityId: string;
  action: 'billing_subscription_refund_applied' | 'billing_subscription_refund_evidence_resolved';
  metadata: Record<string, unknown>;
  createdAt?: Date;
  id?: string;
  /** Which writer produced the row — load-bearing for `voidedInvoiceIds`. */
  actorType?: 'system' | 'webhook' | 'super_admin';
}) {
  auditRowCounter += 1;
  await db.insert(schema.auditLogSchema).values({
    id: input.id ?? `audit_seed_${auditRowCounter}`,
    salonId: input.salonId,
    actorType: input.actorType ?? 'system',
    action: input.action,
    entityType: 'billing_subscription',
    entityId: input.entityId,
    metadata: input.metadata,
    createdAt: input.createdAt ?? new Date('2026-09-01T00:00:00.000Z'),
  });
}

const read = async (salonId: string, entityId: string) => {
  const { readSubscriptionRefunds } = await import('./subscriptionRefunds');
  return db.transaction(tx => readSubscriptionRefunds(tx, { id: entityId, salonId }));
};

describe('readSubscriptionRefunds — effective-state table', () => {
  it('no evidence at all is clean, complete, and starts the sequence at 1', async () => {
    await seedSalon('s_ev_empty');

    const evidence = await read('s_ev_empty', 'bsub_ev_empty');

    expect(evidence).toEqual({
      refunds: [],
      incomplete: false,
      appliedInvoiceIds: new Set(),
      voidedInvoiceIds: new Map(),
      nextSeq: 1,
      rows: 0,
    });
  });

  it('a v1 legacy applied row with valid bounds is well-formed refunded coverage', async () => {
    await seedSalon('s_ev_v1');
    await seedEvidence({
      salonId: 's_ev_v1',
      entityId: 'bsub_ev_v1',
      action: 'billing_subscription_refund_applied',
      // No evidenceVersion and no seq: exactly what pre-PR-1 wrote.
      metadata: {
        refundId: 're_1',
        eventId: 'evt_1',
        invoiceId: 'in_1',
        refundedPeriodStart: T0.toISOString(),
        refundedPeriodEnd: T1.toISOString(),
      },
    });

    const evidence = await read('s_ev_v1', 'bsub_ev_v1');

    expect(evidence.incomplete).toBe(false);
    expect(evidence.refunds).toEqual([{ invoiceId: 'in_1', start: T0, end: T1 }]);
    expect([...evidence.appliedInvoiceIds]).toEqual(['in_1']);
    // A row without a numeric seq counts as 0, so the next writer takes 1.
    expect(evidence.nextSeq).toBe(1);
    expect(evidence.rows).toBe(1);
  });

  it('a v1 null-bound row is REFUNDED but incomplete — refunded, extent unknown', async () => {
    await seedSalon('s_ev_null');
    await seedEvidence({
      salonId: 's_ev_null',
      entityId: 'bsub_ev_null',
      action: 'billing_subscription_refund_applied',
      metadata: { invoiceId: 'in_bad', refundedPeriodStart: null, refundedPeriodEnd: null },
    });

    const evidence = await read('s_ev_null', 'bsub_ev_null');

    expect(evidence.incomplete).toBe(true);
    expect(evidence.refunds).toEqual([]);
    expect([...evidence.appliedInvoiceIds]).toEqual(['in_bad']);
  });

  it('a row with NO invoice identity cannot be grouped and fails closed', async () => {
    await seedSalon('s_ev_noinv');
    await seedEvidence({
      salonId: 's_ev_noinv',
      entityId: 'bsub_ev_noinv',
      action: 'billing_subscription_refund_applied',
      metadata: { refundedPeriodStart: T0.toISOString(), refundedPeriodEnd: T1.toISOString() },
    });

    const evidence = await read('s_ev_noinv', 'bsub_ev_noinv');

    expect(evidence.incomplete).toBe(true);
    expect(evidence.appliedInvoiceIds.size).toBe(0);
    expect(evidence.rows).toBe(1);
  });

  it('a v2 applied row reads its coverage and raises the sequence high-water mark', async () => {
    await seedSalon('s_ev_v2');
    await seedEvidence({
      salonId: 's_ev_v2',
      entityId: 'bsub_ev_v2',
      action: 'billing_subscription_refund_applied',
      metadata: {
        evidenceVersion: 2,
        seq: 4,
        invoiceId: 'in_1',
        refundIds: ['re_1'],
        eventId: 'evt_1',
        refundedPeriodStart: T0.toISOString(),
        refundedPeriodEnd: T1.toISOString(),
      },
    });

    const evidence = await read('s_ev_v2', 'bsub_ev_v2');

    expect(evidence.incomplete).toBe(false);
    expect(evidence.refunds).toEqual([{ invoiceId: 'in_1', start: T0, end: T1 }]);
    expect(evidence.nextSeq).toBe(5);
  });

  it('a `void` resolution supersedes the applied row: the invoice is NOT refunded', async () => {
    await seedSalon('s_ev_void');
    await seedEvidence({
      salonId: 's_ev_void',
      entityId: 'bsub_ev_void',
      action: 'billing_subscription_refund_applied',
      metadata: {
        evidenceVersion: 2,
        seq: 1,
        invoiceId: 'in_1',
        refundedPeriodStart: T0.toISOString(),
        refundedPeriodEnd: T1.toISOString(),
      },
    });
    await seedEvidence({
      salonId: 's_ev_void',
      entityId: 'bsub_ev_void',
      action: 'billing_subscription_refund_evidence_resolved',
      metadata: { evidenceVersion: 2, seq: 2, invoiceId: 'in_1', resolution: 'void', reason: 'refund_reversed:succeeded' },
    });

    const evidence = await read('s_ev_void', 'bsub_ev_void');

    expect(evidence.incomplete).toBe(false);
    expect(evidence.refunds).toEqual([]);
    expect(evidence.appliedInvoiceIds.size).toBe(0);
    expect(evidence.nextSeq).toBe(3);
    // Nothing was deleted: both rows are still on record.
    expect(evidence.rows).toBe(2);
  });

  it('a `set` resolution repairs a malformed legacy row into readable coverage', async () => {
    await seedSalon('s_ev_set');
    await seedEvidence({
      salonId: 's_ev_set',
      entityId: 'bsub_ev_set',
      action: 'billing_subscription_refund_applied',
      metadata: { invoiceId: 'in_1' },
    });
    await seedEvidence({
      salonId: 's_ev_set',
      entityId: 'bsub_ev_set',
      action: 'billing_subscription_refund_evidence_resolved',
      metadata: {
        evidenceVersion: 2,
        seq: 1,
        invoiceId: 'in_1',
        resolution: 'set',
        periodStart: T0.toISOString(),
        periodEnd: T1.toISOString(),
        reason: 'operator repaired legacy evidence',
      },
    });

    const evidence = await read('s_ev_set', 'bsub_ev_set');

    expect(evidence.incomplete).toBe(false);
    expect(evidence.refunds).toEqual([{ invoiceId: 'in_1', start: T0, end: T1 }]);
    expect([...evidence.appliedInvoiceIds]).toEqual(['in_1']);
  });

  it('a `set` resolution with unusable bounds is still REFUNDED and fails closed', async () => {
    await seedSalon('s_ev_setbad');
    await seedEvidence({
      salonId: 's_ev_setbad',
      entityId: 'bsub_ev_setbad',
      action: 'billing_subscription_refund_evidence_resolved',
      metadata: {
        evidenceVersion: 2,
        seq: 1,
        invoiceId: 'in_1',
        resolution: 'set',
        periodStart: T1.toISOString(),
        periodEnd: T0.toISOString(),
        reason: 'inverted',
      },
    });

    const evidence = await read('s_ev_setbad', 'bsub_ev_setbad');

    expect(evidence.incomplete).toBe(true);
    expect(evidence.refunds).toEqual([]);
    expect([...evidence.appliedInvoiceIds]).toEqual(['in_1']);
  });

  it('an evidence version this build cannot interpret fails closed, never silently ignored', async () => {
    await seedSalon('s_ev_future');
    await seedEvidence({
      salonId: 's_ev_future',
      entityId: 'bsub_ev_future',
      action: 'billing_subscription_refund_applied',
      metadata: {
        evidenceVersion: 3,
        seq: 1,
        invoiceId: 'in_1',
        refundedPeriodStart: T0.toISOString(),
        refundedPeriodEnd: T1.toISOString(),
      },
    });

    const evidence = await read('s_ev_future', 'bsub_ev_future');

    expect(evidence.incomplete).toBe(true);
    expect(evidence.refunds).toEqual([]);
  });

  it('an unknown resolution verb fails closed', async () => {
    await seedSalon('s_ev_verb');
    await seedEvidence({
      salonId: 's_ev_verb',
      entityId: 'bsub_ev_verb',
      action: 'billing_subscription_refund_evidence_resolved',
      metadata: { evidenceVersion: 2, seq: 1, invoiceId: 'in_1', resolution: 'annul', reason: 'unknown verb' },
    });

    const evidence = await read('s_ev_verb', 'bsub_ev_verb');

    expect(evidence.incomplete).toBe(true);
    expect(evidence.appliedInvoiceIds.size).toBe(0);
  });

  it('RT-18: the highest seq wins even when its row is OLDER by created_at', async () => {
    await seedSalon('s_ev_seq');
    // The void carries seq 9 but landed a day EARLIER than the applied row it
    // supersedes — a replayed correction. Clock order must not decide.
    await seedEvidence({
      salonId: 's_ev_seq',
      entityId: 'bsub_ev_seq',
      action: 'billing_subscription_refund_evidence_resolved',
      metadata: { evidenceVersion: 2, seq: 9, invoiceId: 'in_1', resolution: 'void', reason: 'reversed' },
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    await seedEvidence({
      salonId: 's_ev_seq',
      entityId: 'bsub_ev_seq',
      action: 'billing_subscription_refund_applied',
      metadata: {
        evidenceVersion: 2,
        seq: 8,
        invoiceId: 'in_1',
        refundedPeriodStart: T0.toISOString(),
        refundedPeriodEnd: T1.toISOString(),
      },
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
    });

    const evidence = await read('s_ev_seq', 'bsub_ev_seq');

    expect(evidence.refunds).toEqual([]);
    expect(evidence.appliedInvoiceIds.size).toBe(0);
    expect(evidence.nextSeq).toBe(10);
  });

  it('equal seq is broken deterministically by created_at, then by row id', async () => {
    await seedSalon('s_ev_tie');
    await seedEvidence({
      salonId: 's_ev_tie',
      entityId: 'bsub_ev_tie',
      action: 'billing_subscription_refund_applied',
      metadata: {
        evidenceVersion: 2,
        seq: 1,
        invoiceId: 'in_1',
        refundedPeriodStart: T0.toISOString(),
        refundedPeriodEnd: T1.toISOString(),
      },
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      id: 'audit_tie_a',
    });
    await seedEvidence({
      salonId: 's_ev_tie',
      entityId: 'bsub_ev_tie',
      action: 'billing_subscription_refund_applied',
      metadata: {
        evidenceVersion: 2,
        seq: 1,
        invoiceId: 'in_1',
        refundedPeriodStart: T1.toISOString(),
        refundedPeriodEnd: T2.toISOString(),
      },
      createdAt: new Date('2026-09-03T00:00:00.000Z'),
      id: 'audit_tie_b',
    });

    const evidence = await read('s_ev_tie', 'bsub_ev_tie');

    expect(evidence.refunds).toEqual([{ invoiceId: 'in_1', start: T1, end: T2 }]);

    // Same seq AND same created_at ⇒ the greater row id wins, so the read is
    // still a pure function of the stored rows.
    await seedEvidence({
      salonId: 's_ev_tie',
      entityId: 'bsub_ev_tie',
      action: 'billing_subscription_refund_applied',
      metadata: {
        evidenceVersion: 2,
        seq: 1,
        invoiceId: 'in_1',
        refundedPeriodStart: T0.toISOString(),
        refundedPeriodEnd: T2.toISOString(),
      },
      createdAt: new Date('2026-09-03T00:00:00.000Z'),
      id: 'audit_tie_c',
    });

    const afterTie = await read('s_ev_tie', 'bsub_ev_tie');

    expect(afterTie.refunds).toEqual([{ invoiceId: 'in_1', start: T0, end: T2 }]);
  });

  it('groups per invoice: one voided invoice never suppresses another invoice\'s coverage', async () => {
    await seedSalon('s_ev_multi');
    await seedEvidence({
      salonId: 's_ev_multi',
      entityId: 'bsub_ev_multi',
      action: 'billing_subscription_refund_applied',
      metadata: { evidenceVersion: 2, seq: 1, invoiceId: 'in_1', refundedPeriodStart: T0.toISOString(), refundedPeriodEnd: T1.toISOString() },
    });
    await seedEvidence({
      salonId: 's_ev_multi',
      entityId: 'bsub_ev_multi',
      action: 'billing_subscription_refund_applied',
      metadata: { evidenceVersion: 2, seq: 2, invoiceId: 'in_2', refundedPeriodStart: T1.toISOString(), refundedPeriodEnd: T2.toISOString() },
    });
    await seedEvidence({
      salonId: 's_ev_multi',
      entityId: 'bsub_ev_multi',
      action: 'billing_subscription_refund_evidence_resolved',
      metadata: { evidenceVersion: 2, seq: 3, invoiceId: 'in_1', resolution: 'void', reason: 'reversed' },
    });

    const evidence = await read('s_ev_multi', 'bsub_ev_multi');

    expect(evidence.refunds).toEqual([{ invoiceId: 'in_2', start: T1, end: T2 }]);
    expect([...evidence.appliedInvoiceIds]).toEqual(['in_2']);
    expect(evidence.nextSeq).toBe(4);
  });

  it('reads only THIS subscription\'s evidence, in THIS salon', async () => {
    await seedSalon('s_ev_scope_a');
    await seedSalon('s_ev_scope_b');
    const coverage = { refundedPeriodStart: T0.toISOString(), refundedPeriodEnd: T1.toISOString() };
    await seedEvidence({
      salonId: 's_ev_scope_a',
      entityId: 'bsub_other',
      action: 'billing_subscription_refund_applied',
      metadata: { evidenceVersion: 2, seq: 5, invoiceId: 'in_other', ...coverage },
    });
    await seedEvidence({
      salonId: 's_ev_scope_b',
      entityId: 'bsub_ev_scope',
      action: 'billing_subscription_refund_applied',
      metadata: { evidenceVersion: 2, seq: 7, invoiceId: 'in_foreign', ...coverage },
    });

    const evidence = await read('s_ev_scope_a', 'bsub_ev_scope');

    expect(evidence).toEqual({
      refunds: [],
      incomplete: false,
      appliedInvoiceIds: new Set(),
      voidedInvoiceIds: new Map(),
      nextSeq: 1,
      rows: 0,
    });
  });

  // F-1: evidence can be wrong in BOTH directions, so the reader reports the
  // voided side too — with the actor, because the hourly safety net may
  // re-check a machine's void against Stripe but must never overrule a
  // human's.
  describe('voidedInvoiceIds', () => {
    it('reports an EFFECTIVE void with the actor type that wrote it', async () => {
      await seedSalon('s_ev_voided');
      await seedEvidence({
        salonId: 's_ev_voided',
        entityId: 'bsub_ev_voided',
        action: 'billing_subscription_refund_applied',
        metadata: { evidenceVersion: 2, seq: 1, invoiceId: 'in_v', refundedPeriodStart: T0.toISOString(), refundedPeriodEnd: T1.toISOString() },
        actorType: 'webhook',
      });
      await seedEvidence({
        salonId: 's_ev_voided',
        entityId: 'bsub_ev_voided',
        action: 'billing_subscription_refund_evidence_resolved',
        metadata: { evidenceVersion: 2, seq: 2, invoiceId: 'in_v', resolution: 'void', reason: 'refund_reversed:failed' },
        actorType: 'webhook',
      });
      await seedEvidence({
        salonId: 's_ev_voided',
        entityId: 'bsub_ev_voided',
        action: 'billing_subscription_refund_evidence_resolved',
        metadata: { evidenceVersion: 2, seq: 1, invoiceId: 'in_operator', resolution: 'void', reason: 'operator judgement' },
        actorType: 'super_admin',
      });

      const evidence = await read('s_ev_voided', 'bsub_ev_voided');

      expect([...evidence.voidedInvoiceIds]).toEqual([
        ['in_v', 'webhook'],
        ['in_operator', 'super_admin'],
      ]);
      expect([...evidence.appliedInvoiceIds]).toEqual([]);
      expect(evidence.refunds).toEqual([]);
      expect(evidence.incomplete).toBe(false);
    });

    it('does NOT report a void that a higher-seq applied row has superseded', async () => {
      await seedSalon('s_ev_void_superseded');
      await seedEvidence({
        salonId: 's_ev_void_superseded',
        entityId: 'bsub_ev_void_superseded',
        action: 'billing_subscription_refund_evidence_resolved',
        metadata: { evidenceVersion: 2, seq: 4, invoiceId: 'in_s', resolution: 'void', reason: 'reversed' },
        actorType: 'webhook',
        // A LATER created_at than the row that supersedes it: ordering is by
        // `seq`, never by the clock.
        createdAt: new Date('2026-12-01T00:00:00.000Z'),
      });
      await seedEvidence({
        salonId: 's_ev_void_superseded',
        entityId: 'bsub_ev_void_superseded',
        action: 'billing_subscription_refund_applied',
        metadata: { evidenceVersion: 2, seq: 5, invoiceId: 'in_s', refundedPeriodStart: T0.toISOString(), refundedPeriodEnd: T1.toISOString() },
        actorType: 'system',
        createdAt: new Date('2026-09-15T00:00:00.000Z'),
      });

      const evidence = await read('s_ev_void_superseded', 'bsub_ev_void_superseded');

      expect([...evidence.voidedInvoiceIds]).toEqual([]);
      expect([...evidence.appliedInvoiceIds]).toEqual(['in_s']);
      expect(evidence.refunds).toEqual([{ invoiceId: 'in_s', start: T0, end: T1 }]);
    });
  });
});

describe('overlapsRefund', () => {
  it('incomplete evidence excludes EVERY period, whatever the refunds list says', async () => {
    const { overlapsRefund } = await import('./subscriptionRefunds');

    expect(overlapsRefund({ refunds: [], incomplete: true }, { start: T0, end: T1 })).toBe(true);
  });

  it('is half-open: touching boundaries do not overlap, a shared interior does', async () => {
    const { overlapsRefund } = await import('./subscriptionRefunds');
    const evidence = { refunds: [{ invoiceId: 'in_1', start: T1, end: T2 }], incomplete: false };

    // [T0, T1) ends exactly where the refund starts.
    expect(overlapsRefund(evidence, { start: T0, end: T1 })).toBe(false);
    // [T2, ...) starts exactly where the refund ends.
    expect(overlapsRefund(evidence, { start: T2, end: new Date('2026-12-01T10:00:00.000Z') })).toBe(false);
    expect(overlapsRefund(evidence, { start: T0, end: new Date('2026-10-02T10:00:00.000Z') })).toBe(true);
  });
});

describe('recordSubscriptionRefundResolution', () => {
  const rowsFor = async (entityId: string) => {
    const { auditLogSchema } = schema;
    const { eq } = await import('drizzle-orm');
    return db.select().from(auditLogSchema).where(eq(auditLogSchema.entityId, entityId));
  };

  it('writes exactly one `void` row carrying the v2 metadata and no bounds', async () => {
    const { recordSubscriptionRefundResolution } = await import('./subscriptionRefunds');
    await seedSalon('s_rec_void');

    await db.transaction(tx => recordSubscriptionRefundResolution(tx, {
      subscription: { id: 'bsub_rec_void', salonId: 's_rec_void' },
      invoiceId: 'in_1',
      resolution: 'void',
      reason: 'refund_reversed:succeeded',
      actor: { actorType: 'webhook', actorId: 'stripe-billing' },
      eventId: 'evt_1',
      observedAmountRefunded: 0,
      observedAmount: 2400,
      seq: 3,
    }));

    const rows = await rowsFor('bsub_rec_void');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      salonId: 's_rec_void',
      actorType: 'webhook',
      actorId: 'stripe-billing',
      action: 'billing_subscription_refund_evidence_resolved',
      entityType: 'billing_subscription',
    });
    expect(rows[0]!.metadata).toEqual({
      evidenceVersion: 2,
      seq: 3,
      invoiceId: 'in_1',
      resolution: 'void',
      reason: 'refund_reversed:succeeded',
      eventId: 'evt_1',
      observedAmountRefunded: 0,
      observedAmount: 2400,
    });
  });

  it('writes a `set` row with ISO bounds and the operator actor', async () => {
    const { recordSubscriptionRefundResolution } = await import('./subscriptionRefunds');
    await seedSalon('s_rec_set');

    await db.transaction(tx => recordSubscriptionRefundResolution(tx, {
      subscription: { id: 'bsub_rec_set', salonId: 's_rec_set' },
      invoiceId: 'in_1',
      resolution: 'set',
      periodStart: T0,
      periodEnd: T1,
      reason: 'repaired legacy evidence',
      actor: { actorType: 'super_admin', actorId: 'sa_1' },
      seq: 1,
    }));

    const rows = await rowsFor('bsub_rec_set');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: 'super_admin', actorId: 'sa_1' });
    expect(rows[0]!.metadata).toEqual({
      evidenceVersion: 2,
      seq: 1,
      invoiceId: 'in_1',
      resolution: 'set',
      periodStart: T0.toISOString(),
      periodEnd: T1.toISOString(),
      reason: 'repaired legacy evidence',
    });
  });

  it('refuses every unreadable correction rather than writing ambiguous evidence', async () => {
    const { recordSubscriptionRefundResolution } = await import('./subscriptionRefunds');
    await seedSalon('s_rec_invalid');
    const base = {
      subscription: { id: 'bsub_rec_invalid', salonId: 's_rec_invalid' },
      invoiceId: 'in_1',
      reason: 'because',
      actor: { actorType: 'super_admin' as const, actorId: 'sa_1' },
      seq: 1,
    };
    const write = (over: Record<string, unknown>) =>
      db.transaction(tx => recordSubscriptionRefundResolution(tx, {
        ...base,
        resolution: 'set',
        periodStart: T0,
        periodEnd: T1,
        ...over,
      } as Parameters<typeof recordSubscriptionRefundResolution>[1]));

    await expect(write({ invoiceId: '' })).rejects.toThrow('INVALID_REFUND_RESOLUTION_INVOICE');
    await expect(write({ resolution: 'annul' })).rejects.toThrow('INVALID_REFUND_RESOLUTION_VERB');
    await expect(write({ reason: '' })).rejects.toThrow('INVALID_REFUND_RESOLUTION_REASON');
    await expect(write({ seq: 0 })).rejects.toThrow('INVALID_REFUND_RESOLUTION_SEQ');
    await expect(write({ periodStart: undefined })).rejects.toThrow('INVALID_REFUND_RESOLUTION_BOUNDS');
    await expect(write({ periodStart: T1, periodEnd: T0 })).rejects.toThrow('INVALID_REFUND_RESOLUTION_BOUNDS');
    await expect(write({ periodStart: new Date(Number.NaN) })).rejects.toThrow('INVALID_REFUND_RESOLUTION_BOUNDS');

    expect(await rowsFor('bsub_rec_invalid')).toHaveLength(0);
  });

  it('round-trips through the reader: a recorded `void` makes the invoice unrefunded', async () => {
    const { readSubscriptionRefunds, recordSubscriptionRefundResolution } = await import('./subscriptionRefunds');
    await seedSalon('s_rec_round');
    await seedEvidence({
      salonId: 's_rec_round',
      entityId: 'bsub_rec_round',
      action: 'billing_subscription_refund_applied',
      metadata: {
        evidenceVersion: 2,
        seq: 1,
        invoiceId: 'in_1',
        refundedPeriodStart: T0.toISOString(),
        refundedPeriodEnd: T1.toISOString(),
      },
    });

    const before = await read('s_rec_round', 'bsub_rec_round');

    expect(before.appliedInvoiceIds.has('in_1')).toBe(true);

    await db.transaction(async (tx) => {
      const evidence = await readSubscriptionRefunds(tx, { id: 'bsub_rec_round', salonId: 's_rec_round' });
      await recordSubscriptionRefundResolution(tx, {
        subscription: { id: 'bsub_rec_round', salonId: 's_rec_round' },
        invoiceId: 'in_1',
        resolution: 'void',
        reason: 'refund_reversed:reconcile',
        actor: { actorType: 'system', actorId: 'billing-reconcile' },
        seq: evidence.nextSeq,
      });
    });

    const after = await read('s_rec_round', 'bsub_rec_round');

    expect(after.appliedInvoiceIds.size).toBe(0);
    expect(after.refunds).toEqual([]);
    expect(after.incomplete).toBe(false);
    expect(after.nextSeq).toBe(3);
  });
});
