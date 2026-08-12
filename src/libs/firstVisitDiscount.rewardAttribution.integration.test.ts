import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock('@/libs/bookingConfig', () => ({
  getBookingConfigForSalon: vi.fn(async () => ({
    bufferMinutes: 10,
    slotIntervalMinutes: 15,
    currency: 'CAD',
    timezone: 'America/Toronto',
    introPriceDefaultLabel: null,
    firstVisitDiscountEnabled: false,
  })),
}));
vi.mock('@/libs/queries', () => ({ getSalonClientByPhone: vi.fn(async () => null) }));

/* eslint-disable import/first */
import { resolveAutomaticBookingDiscount } from './firstVisitDiscount';
/* eslint-enable import/first */

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: 'salon_discount_rwd',
    name: 'Discount RWD Salon',
    slug: 'discount-rwd',
    ownerEmail: 'discount.rwd@example.invalid',
  });
  await db.insert(schema.appointmentSchema).values({
    id: 'appt_discount_rwd_hold',
    salonId: 'salon_discount_rwd',
    clientPhone: '4165550188',
    startTime: new Date('2099-02-01T15:00:00.000Z'),
    endTime: new Date('2099-02-01T16:00:00.000Z'),
    status: 'awaiting_payment',
    totalPrice: 4000,
    totalDurationMinutes: 60,
  });
  await db.insert(schema.rewardSchema).values([
    {
      id: 'reward_discount_reserved',
      salonId: 'salon_discount_rwd',
      clientPhone: '4165550188',
      type: 'referral_referee',
      discountType: 'fixed_amount',
      discountAmountCents: 500,
    },
    {
      id: 'reward_discount_available',
      salonId: 'salon_discount_rwd',
      clientPhone: '4165550188',
      type: 'referral_referee',
      discountType: 'fixed_amount',
      discountAmountCents: 700,
    },
  ]);
  await db.insert(schema.appointmentDepositSchema).values({
    id: 'dep_discount_rwd_hold',
    salonId: 'salon_discount_rwd',
    appointmentId: 'appt_discount_rwd_hold',
    amountCents: 2500,
    status: 'checkout_created',
    stripeAccountId: 'acct_discount_rwd',
    appliedRewardId: 'reward_discount_reserved',
    appliedRewardClientId: 'client_discount_rwd',
    appliedRewardClientPhone: '4165550188',
  });
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('automatic reward selection versus deposit attribution', () => {
  it('skips an unpaid hold attribution and selects the next exact available reward', async () => {
    const result = await resolveAutomaticBookingDiscount({
      salonId: 'salon_discount_rwd',
      clientPhone: '4165550188',
      salonClientId: 'client_discount_rwd',
      services: [{ id: 'svc_discount_rwd', name: 'Manicure', price: 4000 }],
      subtotalBeforeDiscountCents: 4000,
    });

    expect(result.kind).toBe('reward');
    expect(result.reward?.id).toBe('reward_discount_available');
  });

  it('ignores a foreign salon hold carrying the same opaque reward id', async () => {
    await db.insert(schema.salonSchema).values({
      id: 'salon_discount_rwd_foreign',
      name: 'Foreign Discount Salon',
      slug: 'discount-rwd-foreign',
      ownerEmail: 'discount.foreign@example.invalid',
    });
    await db.insert(schema.appointmentSchema).values({
      id: 'appt_discount_rwd_foreign',
      salonId: 'salon_discount_rwd_foreign',
      clientPhone: '6475550188',
      startTime: new Date('2099-02-02T15:00:00.000Z'),
      endTime: new Date('2099-02-02T16:00:00.000Z'),
      status: 'awaiting_payment',
      totalPrice: 4000,
      totalDurationMinutes: 60,
    });
    await db.insert(schema.appointmentDepositSchema).values({
      id: 'dep_discount_rwd_foreign',
      salonId: 'salon_discount_rwd_foreign',
      appointmentId: 'appt_discount_rwd_foreign',
      amountCents: 2500,
      status: 'checkout_created',
      stripeAccountId: 'acct_discount_rwd_foreign',
      // Deliberately malformed cross-tenant opaque id: it must not influence
      // the local salon's selector.
      appliedRewardId: 'reward_discount_available',
      appliedRewardClientId: 'client_discount_rwd_foreign',
      appliedRewardClientPhone: '6475550188',
    });

    const result = await resolveAutomaticBookingDiscount({
      salonId: 'salon_discount_rwd',
      clientPhone: '4165550188',
      salonClientId: 'client_discount_rwd',
      services: [{ id: 'svc_discount_rwd', name: 'Manicure', price: 4000 }],
      subtotalBeforeDiscountCents: 4000,
    });

    expect(result.kind).toBe('reward');
    expect(result.reward?.id).toBe('reward_discount_available');
  });
});
