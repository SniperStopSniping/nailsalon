import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const guards = vi.hoisted(() => ({
  requireClientApiSession: vi.fn(),
  requireClientSalonFromBody: vi.fn(),
  guardModuleOr403: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession: guards.requireClientApiSession,
  requireClientSalonFromBody: guards.requireClientSalonFromBody,
}));
vi.mock('@/libs/featureGating', () => ({
  guardModuleOr403: guards.guardModuleOr403,
}));

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_redeem_rwd';
const REDEEM_APPOINTMENT_ID = 'appt_redeem_rwd';
const HOLD_APPOINTMENT_ID = 'appt_hold_rwd';
const CLIENT_PHONE = '4165550177';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

function request(rewardId: string) {
  return new Request('http://localhost/api/rewards/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appointmentId: REDEEM_APPOINTMENT_ID,
      rewardId,
      salonSlug: 'redeem-rwd',
    }),
  });
}

async function seedAppointment(id: string, status: string, phone = CLIENT_PHONE) {
  const start = new Date(id === REDEEM_APPOINTMENT_ID
    ? '2099-01-01T15:00:00.000Z'
    : '2099-01-02T15:00:00.000Z');
  await db.insert(schema.appointmentSchema).values({
    id,
    salonId: SALON_ID,
    clientPhone: phone,
    startTime: start,
    endTime: new Date(start.getTime() + 60 * 60_000),
    status,
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });
}

async function seedReward(id: string) {
  await db.insert(schema.rewardSchema).values({
    id,
    salonId: SALON_ID,
    clientPhone: CLIENT_PHONE,
    type: 'referral_referee',
    discountType: 'fixed_amount',
    discountAmountCents: 500,
  });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.rewardSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonSchema);

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Redeem RWD Salon',
    slug: 'redeem-rwd',
    ownerEmail: 'owner.redeem@example.invalid',
    rewardsEnabled: true,
  });
  await seedAppointment(REDEEM_APPOINTMENT_ID, 'pending');

  guards.requireClientApiSession.mockResolvedValue({
    ok: true,
    normalizedPhone: CLIENT_PHONE,
    session: { phone: `+1${CLIENT_PHONE}` },
  });
  guards.requireClientSalonFromBody.mockResolvedValue({
    ok: true,
    salon: { id: SALON_ID, slug: 'redeem-rwd', rewardsEnabled: true },
  });
  guards.guardModuleOr403.mockResolvedValue(null);
});

afterAll(async () => {
  await client.close();
});

describe('manual reward redemption versus deposit attribution', () => {
  it('rejects the exact reward while an unpaid hold reserves it', async () => {
    await seedReward('reward_reserved_for_hold');
    await seedAppointment(HOLD_APPOINTMENT_ID, 'awaiting_payment');
    await db.insert(schema.appointmentDepositSchema).values({
      id: 'dep_reserved_for_hold',
      salonId: SALON_ID,
      appointmentId: HOLD_APPOINTMENT_ID,
      amountCents: 2500,
      status: 'checkout_created',
      stripeAccountId: 'acct_redeem_rwd',
      appliedRewardId: 'reward_reserved_for_hold',
      appliedRewardClientId: 'client_redeem_rwd',
      appliedRewardClientPhone: CLIENT_PHONE,
    });

    const response = await POST(request('reward_reserved_for_hold'));

    expect(response.status).toBe(409);
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_reserved_for_hold')))[0]?.usedInAppointmentId)
      .toBeNull();
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, REDEEM_APPOINTMENT_ID)))[0]?.totalPrice)
      .toBe(5000);
  });

  it('ignores a foreign salon hold carrying the same opaque reward id', async () => {
    const foreignSalonId = 'salon_redeem_rwd_foreign';
    const foreignAppointmentId = 'appt_redeem_rwd_foreign';
    await seedReward('reward_reserved_only_foreign');
    await db.insert(schema.salonSchema).values({
      id: foreignSalonId,
      name: 'Foreign Redeem Salon',
      slug: 'redeem-rwd-foreign',
      ownerEmail: 'foreign.redeem@example.invalid',
    });
    await db.insert(schema.appointmentSchema).values({
      id: foreignAppointmentId,
      salonId: foreignSalonId,
      clientPhone: '6475550177',
      startTime: new Date('2099-01-03T15:00:00.000Z'),
      endTime: new Date('2099-01-03T16:00:00.000Z'),
      status: 'awaiting_payment',
      totalPrice: 5000,
      totalDurationMinutes: 60,
    });
    await db.insert(schema.appointmentDepositSchema).values({
      id: 'dep_redeem_rwd_foreign',
      salonId: foreignSalonId,
      appointmentId: foreignAppointmentId,
      amountCents: 2500,
      status: 'checkout_created',
      stripeAccountId: 'acct_redeem_rwd_foreign',
      appliedRewardId: 'reward_reserved_only_foreign',
      appliedRewardClientId: 'client_redeem_rwd_foreign',
      appliedRewardClientPhone: '6475550177',
    });

    const response = await POST(request('reward_reserved_only_foreign'));

    expect(response.status).toBe(200);
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_reserved_only_foreign')))[0]?.usedInAppointmentId)
      .toBe(REDEEM_APPOINTMENT_ID);
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, REDEEM_APPOINTMENT_ID)))[0]?.totalPrice)
      // Preserve the pre-RWD behavior for appointments with no service rows:
      // the reward links, but no amount is inferred without service evidence.
      .toBe(5000);
  });

  it('rejects a different reward when the appointment carries a paid attribution', async () => {
    await seedReward('reward_paid_attribution');
    await seedReward('reward_manual_second');
    await db.insert(schema.appointmentDepositSchema).values({
      id: 'dep_paid_attribution',
      salonId: SALON_ID,
      appointmentId: REDEEM_APPOINTMENT_ID,
      amountCents: 2500,
      status: 'paid',
      stripeAccountId: 'acct_redeem_rwd',
      appliedRewardId: 'reward_paid_attribution',
      appliedRewardClientId: 'client_redeem_rwd',
      appliedRewardClientPhone: CLIENT_PHONE,
    });

    const response = await POST(request('reward_manual_second'));

    expect(response.status).toBe(409);
    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_manual_second')))[0]?.usedInAppointmentId)
      .toBeNull();
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, REDEEM_APPOINTMENT_ID)))[0]?.totalPrice)
      .toBe(5000);
  });

  it.each(['expired', 'canceled', 'refunded', 'waived'])(
    'rejects manual reward application to an appointment with a %s attribution',
    async (depositStatus) => {
      await seedReward(`reward_attributed_${depositStatus}`);
      await seedReward(`reward_manual_${depositStatus}`);
      await db.insert(schema.appointmentDepositSchema).values({
        id: `dep_attributed_${depositStatus}`,
        salonId: SALON_ID,
        appointmentId: REDEEM_APPOINTMENT_ID,
        amountCents: 2500,
        status: depositStatus,
        stripeAccountId: 'acct_redeem_rwd',
        appliedRewardId: `reward_attributed_${depositStatus}`,
        appliedRewardClientId: 'client_redeem_rwd',
        appliedRewardClientPhone: CLIENT_PHONE,
      });

      const response = await POST(request(`reward_manual_${depositStatus}`));

      expect(response.status).toBe(409);
      expect((await db.select().from(schema.rewardSchema)
        .where(eq(schema.rewardSchema.id, `reward_manual_${depositStatus}`)))[0]?.usedInAppointmentId)
        .toBeNull();
      expect((await db.select().from(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.id, REDEEM_APPOINTMENT_ID)))[0]?.totalPrice)
        .toBe(5000);
    },
  );
});
