import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
let db: ReturnType<typeof drizzle<typeof schema>>;
const now = new Date('2026-10-08T12:00:00Z');
const overview = () => import('./smsCreditOverview');
async function seed(id: string, amounts: number[] = []) {
  await db.insert(schema.salonSchema).values({ id, name: id, slug: id });
  const { appendLotGrant, lockCreditAccount } = await import('./creditLedger');
  await db.transaction(async (tx) => {
    await lockCreditAccount(tx, id);
    for (const [i, amount] of amounts.entries()) {
      await appendLotGrant(tx, { salonId: id, bucket: i === 0 ? 'starter' : 'purchased', amount, expiresAt: null, idempotencyKey: `${id}-${i}`, reason: i === 0 ? 'starter_grant' : 'topup_fulfillment' });
    }
  });
}
async function read(id: string) {
  const { readSmsCreditOverview } = await overview();
  return db.transaction(tx => readSmsCreditOverview(tx, id, 'America/Toronto', now));
}

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

describe('owner SMS credit overview', () => {
  it('reports an empty salon without fabricated credits or allocation', async () => {
    await seed('sms_empty');

    expect(await read('sms_empty')).toMatchObject({ availableCredits: 0, allocationCredits: null, status: 'empty', totalPurchased: 0, usedThisMonth: 0, lastPurchaseOfferKey: null, monthStart: '2026-10-01T04:00:00.000Z' });
  });

  it('uses a proven single allocation and keeps tenant balances isolated', async () => {
    await seed('sms_single', [100]);
    await seed('sms_other', [500]);

    expect(await read('sms_single')).toMatchObject({ availableCredits: 100, allocationCredits: 100, totalPurchased: 0 });
    expect(await read('sms_other')).toMatchObject({ availableCredits: 500, allocationCredits: 500 });
  });

  it('does not invent a denominator for mixed grants and purchases', async () => {
    await seed('sms_mixed', [100, 200, 500]);

    expect(await read('sms_mixed')).toMatchObject({ availableCredits: 800, allocationCredits: null, totalPurchased: 700 });
  });

  it('separates pending credits from settled monthly usage and combines a multi-lot send', async () => {
    await seed('sms_sent', [1, 100]);
    const { reserveSmsCredits, settleReservationOnAccept } = await import('./creditReservation');
    const held = await reserveSmsCredits({ salonId: 'sms_sent', dedupeKey: 'sms_send', segments: 3, now });

    expect(await read('sms_sent')).toMatchObject({ availableCredits: 98, pendingCredits: 3, usedThisMonth: 0 });

    if (!held.ok) {
      throw new Error('reserve failed');
    }
    await settleReservationOnAccept({ reservationId: held.reservationId, providerSid: 'SM_fixture', now });

    expect(await read('sms_sent')).toMatchObject({ availableCredits: 98, pendingCredits: 0, usedThisMonth: 3 });

    const { readSmsCreditActivity } = await overview();
    const activity = await db.transaction(tx => readSmsCreditActivity(tx, 'sms_sent', null));

    expect(activity.items.filter(item => item.type === 'debit')).toHaveLength(1);
    expect(activity.items.find(item => item.type === 'debit')?.credits).toBe(-3);
    expect(JSON.stringify(activity)).not.toMatch(/SM_fixture|recipient|messageBody/);
    expect((await db.transaction(tx => readSmsCreditActivity(tx, 'sms_empty', null))).items).toEqual([]);
  });

  it('excludes expired credits and refunds failed texts from monthly usage', async () => {
    await seed('sms_refunded', [100]);
    const { reserveSmsCredits, settleReservationOnAccept, refundTerminalFailure } = await import('./creditReservation');
    const held = await reserveSmsCredits({ salonId: 'sms_refunded', dedupeKey: 'refunded_send', segments: 3, now });
    if (!held.ok) {
      throw new Error('reserve failed');
    }
    await settleReservationOnAccept({ reservationId: held.reservationId, providerSid: 'SM_refunded', now });
    await refundTerminalFailure({ reservationId: held.reservationId, now });

    expect(await read('sms_refunded')).toMatchObject({ availableCredits: 100, usedThisMonth: 0, allocationCredits: null });

    await seed('sms_expired');
    const { appendLotGrant, lockCreditAccount } = await import('./creditLedger');
    await db.transaction(async (tx) => {
      await lockCreditAccount(tx, 'sms_expired');
      await appendLotGrant(tx, { salonId: 'sms_expired', amount: 100, bucket: 'starter', expiresAt: new Date('2026-10-01'), idempotencyKey: 'overview_expired', reason: 'test' });
    });

    expect(await read('sms_expired')).toMatchObject({ availableCredits: 0, allocationCredits: null });
  });

  it('uses the salon month boundary rather than UTC and preserves prior package credit size', async () => {
    await seed('sms_month', [100]);
    const { reserveSmsCredits, settleReservationOnAccept } = await import('./creditReservation');
    const beforeMonth = new Date('2026-10-01T03:59:00Z');
    const held = await reserveSmsCredits({ salonId: 'sms_month', dedupeKey: 'previous_month', segments: 3, now: beforeMonth });
    if (!held.ok) {
      throw new Error('reserve failed');
    }
    await settleReservationOnAccept({ reservationId: held.reservationId, providerSid: 'SM_lastmonth', now: beforeMonth });

    expect(await read('sms_month')).toMatchObject({ availableCredits: 97, usedThisMonth: 0 });

    const [lot] = await db.select().from(schema.smsCreditLedgerSchema).where((await import('drizzle-orm')).eq(schema.smsCreditLedgerSchema.idempotencyKey, 'sms_month-0'));
    await db.insert(schema.smsTopupPurchaseSchema).values({ id: 'last_package', salonId: 'sms_month', topupOfferKey: 'topup_100_paid_2026_08', credits: 100, amountCents: 599, status: 'fulfilled', grantLedgerId: lot!.id });

    expect(await read('sms_month')).toMatchObject({ lastPurchaseOfferKey: 'topup_100_paid_2026_08', lastPurchaseCredits: 100 });
  });

  it('paginates without repeating entries with identical timestamps', async () => {
    await seed('sms_pages', Array.from({ length: 28 }, () => 1));
    const { readSmsCreditActivity, decodeCreditActivityCursor } = await overview();
    const first = await db.transaction(tx => readSmsCreditActivity(tx, 'sms_pages', null));

    expect(first.items).toHaveLength(25);

    const second = await db.transaction(tx => readSmsCreditActivity(tx, 'sms_pages', decodeCreditActivityCursor(first.nextCursor)));

    expect(second.items).toHaveLength(3);
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(28);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects malformed activity cursors', async () => {
    const { decodeCreditActivityCursor } = await overview();
    for (const value of ['', 'bad_cursor', '0_', '9e99_id', '_id']) {
      expect(() => decodeCreditActivityCursor(value)).toThrow('INVALID_CURSOR');
    }
  });
});
