/**
 * D4.5 — the two symbols the booking route does NOT exercise.
 *
 * `runBookingCommitSideEffects` is covered end-to-end by the route tests (D4's
 * `route.deposits.effects.integration.test.ts` for what fires, and
 * `route.commitEffects.integration.test.ts` for when). The other two exports
 * exist for a caller that holds only ids and runs after the booking request has
 * ended, so they need their own coverage or they ship untested:
 *
 *   - `mintAppointmentManageCapability` — the row shape and the 30-day rule,
 *     and that a SECOND mint is additive rather than destructive (lookups are
 *     by hash, so an earlier link must keep working).
 *   - `loadBookingCommitEffectsContext` — rebuilding the effects context from
 *     the database alone.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

/* eslint-disable import/first */
import {
  formatLocationAddress,
  loadBookingCommitEffectsContext,
  markAppliedRewardForBooking,
  markExactAttributedRewardForPaidDepositInTx,
  mintAppointmentManageCapability,
  RewardConsumptionConflictError,
} from './bookingCommitEffects';
/* eslint-enable import/first */

const SALON_ID = 'salon_bce';
const TECH_ID = 'tech_bce';
const SERVICE_ID = 'srv_bce';
const LOCATION_ID = 'loc_bce';
const CLIENT_ID = 'sc_bce';
const APPOINTMENT_ID = 'appt_bce';

const START = new Date('2099-03-01T15:00:00.000Z');
const END = new Date('2099-03-01T16:00:00.000Z');

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 60_000);

beforeEach(async () => {
  await db.delete(schema.appointmentAccessTokenSchema);
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.appointmentServicesSchema);
  await db.delete(schema.rewardSchema);
  await db.delete(schema.referralSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonClientSchema);
  await db.delete(schema.technicianServicesSchema);
  await db.delete(schema.serviceSchema);
  await db.delete(schema.technicianSchema);
  await db.delete(schema.salonLocationSchema);
  await db.delete(schema.salonSchema);

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Context Salon',
    slug: 'context-salon',
    ownerEmail: 'owner@example.com',
    ownerName: 'Owner Name',
    ownerPhone: '4165550001',
    settings: { booking: { timezone: 'America/Toronto' } },
  });
  await db.insert(schema.salonLocationSchema).values({
    id: LOCATION_ID,
    salonId: SALON_ID,
    name: 'Yonge Street',
    address: '123 Yonge St',
    city: 'Toronto',
    state: 'ON',
    zipCode: 'M5B 1M4',
  });
  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Daniela',
    phone: '4165550002',
    email: 'daniela@example.com',
  });
  await db.insert(schema.serviceSchema).values({
    id: SERVICE_ID,
    salonId: SALON_ID,
    name: 'Gel Manicure',
    category: 'manicure',
    price: 4500,
    durationMinutes: 60,
  });
  await db.insert(schema.salonClientSchema).values({
    id: CLIENT_ID,
    salonId: SALON_ID,
    phone: '4165551234',
    fullName: 'Context Client',
  });
  await db.insert(schema.appointmentSchema).values({
    id: APPOINTMENT_ID,
    salonId: SALON_ID,
    salonClientId: CLIENT_ID,
    technicianId: TECH_ID,
    locationId: LOCATION_ID,
    clientPhone: '4165551234',
    startTime: START,
    endTime: END,
    status: 'confirmed',
    totalPrice: 4500,
    totalDurationMinutes: 60,
    notes: 'Please use the ramp entrance',
  });
  await db.insert(schema.appointmentServicesSchema).values({
    id: 'as_bce',
    appointmentId: APPOINTMENT_ID,
    serviceId: SERVICE_ID,
    priceAtBooking: 4500,
    durationAtBooking: 60,
  });
});

afterAll(async () => {
  await client.close();
});

describe('mintAppointmentManageCapability', () => {
  it('persists only the hash, and expires 30 days after the appointment ends', async () => {
    const minted = await mintAppointmentManageCapability(db, {
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      appointmentEndTime: END,
    });

    const rows = await db.select().from(schema.appointmentAccessTokenSchema);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.salonId).toBe(SALON_ID);
    expect(rows[0]!.appointmentId).toBe(APPOINTMENT_ID);
    expect(rows[0]!.revokedAt).toBeNull();

    // The plaintext is returned to the caller and NEVER stored.
    expect(minted.token).toBeTruthy();
    expect(rows[0]!.tokenHash).toBe(minted.tokenHash);
    expect(rows[0]!.tokenHash).not.toBe(minted.token);

    expect(rows[0]!.expiresAt!.getTime())
      .toBe(END.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(minted.expiresAt.getTime()).toBe(rows[0]!.expiresAt!.getTime());
  });

  it('reuses a caller-supplied capability rather than minting a new one', async () => {
    const supplied = { token: 'plain-token-value', tokenHash: 'hash-of-plain-token' };

    const minted = await mintAppointmentManageCapability(db, {
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      appointmentEndTime: END,
      capability: supplied,
    });

    expect(minted.token).toBe(supplied.token);

    const rows = await db.select().from(schema.appointmentAccessTokenSchema);

    expect(rows[0]!.tokenHash).toBe(supplied.tokenHash);
  });

  /**
   * The property a confirmation-time caller depends on: minting a second link
   * must not invalidate the first. Lookups are by hash, so both rows resolve.
   */
  it('a second mint is additive — the earlier capability survives', async () => {
    const first = await mintAppointmentManageCapability(db, {
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      appointmentEndTime: END,
    });
    const second = await mintAppointmentManageCapability(db, {
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      appointmentEndTime: END,
    });

    expect(second.tokenHash).not.toBe(first.tokenHash);

    const rows = await db.select().from(schema.appointmentAccessTokenSchema)
      .where(eq(schema.appointmentAccessTokenSchema.appointmentId, APPOINTMENT_ID));

    expect(rows).toHaveLength(2);
    // Neither was revoked by the other.
    expect(rows.every(row => row.revokedAt === null)).toBe(true);
    expect(rows.map(row => row.tokenHash).sort())
      .toEqual([first.tokenHash, second.tokenHash].sort());
  });
});

describe('loadBookingCommitEffectsContext', () => {
  it('rebuilds the effects context from the database alone', async () => {
    const context = await loadBookingCommitEffectsContext({
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      manageUrl: 'https://salon.example/manage/abc',
      smsConsentGranted: true,
    });

    expect(context).not.toBeNull();
    expect(context!.salon).toMatchObject({
      id: SALON_ID,
      name: 'Context Salon',
      ownerName: 'Owner Name',
      ownerPhone: '4165550001',
      ownerEmail: 'owner@example.com',
    });
    expect(context!.salonClientId).toBe(CLIENT_ID);
    expect(context!.clientPhone).toBe('4165551234');
    expect(context!.clientName).toBe('Context Client');
    expect(context!.appointment).toEqual({
      id: APPOINTMENT_ID,
      notes: 'Please use the ramp entrance',
      googleCalendarEventId: null,
      status: 'confirmed',
    });
    expect(context!.serviceNames).toEqual(['Gel Manicure']);
    expect(context!.technician).toEqual({
      id: TECH_ID,
      name: 'Daniela',
      phone: '4165550002',
      email: 'daniela@example.com',
    });
    expect(context!.startTime.getTime()).toBe(START.getTime());
    expect(context!.endTime.getTime()).toBe(END.getTime());
    expect(context!.totalPrice).toBe(4500);
    expect(context!.totalDurationMinutes).toBe(60);
    expect(context!.timeZone).toBe('America/Toronto');
    expect(context!.manageUrl).toBe('https://salon.example/manage/abc');
    expect(context!.smsConsentGranted).toBe(true);
    expect(context!.locationName).toBe('Yonge Street');
    expect(context!.locationAddress).toBe('123 Yonge St, Toronto, ON, M5B 1M4');

    // A confirmation is never a reschedule and marks no reward by default.
    expect(context!.originalAppointment).toBeNull();
    expect(context!.appliedRewardId).toBeNull();
    expect(context!.actorRole).toBe('guest');
    expect(context!.googleCalendarSyncEligible).toBe(true);
  });

  it('returns null for an appointment that does not belong to the salon', async () => {
    await expect(loadBookingCommitEffectsContext({
      salonId: 'salon_other',
      appointmentId: APPOINTMENT_ID,
      manageUrl: 'https://salon.example/manage/abc',
      smsConsentGranted: false,
    })).resolves.toBeNull();

    await expect(loadBookingCommitEffectsContext({
      salonId: SALON_ID,
      appointmentId: 'appt_missing',
      manageUrl: 'https://salon.example/manage/abc',
      smsConsentGranted: false,
    })).resolves.toBeNull();
  });

  it('carries a technician-less, location-less appointment without inventing values', async () => {
    await db.update(schema.appointmentSchema)
      .set({ technicianId: null, locationId: null })
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));

    const context = await loadBookingCommitEffectsContext({
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      manageUrl: 'https://salon.example/manage/abc',
      smsConsentGranted: false,
    });

    expect(context!.technician).toBeNull();
    expect(context!.locationName).toBeNull();
    expect(context!.locationAddress).toBeNull();
  });
});

describe('D5-RWD-1 reward consumption CAS', () => {
  async function contextFor(rewardId: string, depositId: string | null) {
    const context = await loadBookingCommitEffectsContext({
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      manageUrl: 'https://salon.example/manage/reward-cas',
      smsConsentGranted: false,
      appliedRewardId: rewardId,
      rewardAttributionDepositId: depositId,
    });

    expect(context).not.toBeNull();

    return context!;
  }

  async function seedReward(
    id: string,
    clientPhone = '4165551234',
    salonId = SALON_ID,
  ) {
    await db.insert(schema.rewardSchema).values({
      id,
      salonId,
      clientPhone,
      type: 'referral_referee',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  }

  async function seedAttributedDeposit(
    id: string,
    rewardId: string,
    status = 'paid',
    appointmentId = APPOINTMENT_ID,
    salonId = SALON_ID,
    attributedClientId = CLIENT_ID,
    attributedClientPhone = '4165551234',
  ) {
    await db.insert(schema.appointmentDepositSchema).values({
      id,
      salonId,
      appointmentId,
      amountCents: 2500,
      status,
      stripeAccountId: 'acct_reward_cas',
      appliedRewardId: rewardId,
      appliedRewardClientId: attributedClientId,
      appliedRewardClientPhone: attributedClientPhone,
    });
  }

  it('marks the paid deposit\'s exact reward once, then replays without a write', async () => {
    await seedReward('reward_cas_exact');
    await seedReward('reward_cas_decoy');
    await seedAttributedDeposit('dep_reward_cas', 'reward_cas_exact');
    const context = await contextFor('reward_cas_exact', 'dep_reward_cas');

    await expect(db.transaction(tx => markExactAttributedRewardForPaidDepositInTx(tx, {
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      depositId: 'dep_reward_cas',
      rewardId: 'reward_cas_exact',
    }))).resolves.toBe('marked');

    const [afterFirst] = await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_cas_exact'));

    await expect(markAppliedRewardForBooking(context)).resolves.toBe('already_marked');

    const [afterReplay] = await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_cas_exact'));
    const [decoy] = await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_cas_decoy'));

    expect(afterFirst?.usedInAppointmentId).toBe(APPOINTMENT_ID);
    expect(afterReplay?.updatedAt.getTime()).toBe(afterFirst?.updatedAt.getTime());
    expect(decoy?.usedInAppointmentId).toBeNull();
  });

  it('rejects foreign client ownership even when a paid deposit names that id', async () => {
    await seedReward('reward_cas_foreign_client', '4165559999');
    await seedAttributedDeposit(
      'dep_reward_foreign',
      'reward_cas_foreign_client',
      'paid',
      APPOINTMENT_ID,
      SALON_ID,
      'client_foreign_reward_owner',
      '4165559999',
    );

    await expect(markAppliedRewardForBooking(
      await contextFor('reward_cas_foreign_client', 'dep_reward_foreign'),
    )).rejects.toBeInstanceOf(RewardConsumptionConflictError);

    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_cas_foreign_client')))[0]?.usedInAppointmentId)
      .toBeNull();
  });

  it('rejects foreign salon ownership even when a paid local deposit names that id', async () => {
    await db.insert(schema.salonSchema).values({
      id: 'salon_bce_foreign',
      name: 'Foreign Context Salon',
      slug: 'foreign-context-salon',
      ownerEmail: 'foreign-owner@example.com',
    });
    await seedReward('reward_cas_foreign_salon', '4165551234', 'salon_bce_foreign');
    await seedAttributedDeposit('dep_reward_foreign_salon', 'reward_cas_foreign_salon');

    await expect(markAppliedRewardForBooking(
      await contextFor('reward_cas_foreign_salon', 'dep_reward_foreign_salon'),
    )).rejects.toBeInstanceOf(RewardConsumptionConflictError);

    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_cas_foreign_salon')))[0]?.usedInAppointmentId)
      .toBeNull();
  });

  it('rejects a paid attribution that belongs to a different appointment', async () => {
    const otherAppointmentId = 'appt_bce_other_reward';
    await db.insert(schema.appointmentSchema).values({
      id: otherAppointmentId,
      salonId: SALON_ID,
      salonClientId: CLIENT_ID,
      clientPhone: '4165551234',
      startTime: new Date('2099-03-02T15:00:00.000Z'),
      endTime: new Date('2099-03-02T16:00:00.000Z'),
      status: 'confirmed',
      totalPrice: 4500,
      totalDurationMinutes: 60,
    });
    await seedReward('reward_cas_wrong_appointment');
    await seedAttributedDeposit(
      'dep_reward_wrong_appointment',
      'reward_cas_wrong_appointment',
      'paid',
      otherAppointmentId,
    );

    await expect(markAppliedRewardForBooking(
      await contextFor('reward_cas_wrong_appointment', 'dep_reward_wrong_appointment'),
    )).rejects.toBeInstanceOf(RewardConsumptionConflictError);

    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_cas_wrong_appointment')))[0]?.usedInAppointmentId)
      .toBeNull();
  });

  it('ignores a foreign salon deposit carrying the same opaque reward id', async () => {
    const otherSalonId = 'salon_bce_reservation_foreign';
    const otherAppointmentId = 'appt_bce_reservation_foreign';
    await db.insert(schema.salonSchema).values({
      id: otherSalonId,
      name: 'Foreign Reservation Salon',
      slug: 'foreign-reservation-salon',
      ownerEmail: 'reservation-owner@example.com',
    });
    await db.insert(schema.appointmentSchema).values({
      id: otherAppointmentId,
      salonId: otherSalonId,
      clientPhone: '4165559998',
      startTime: new Date('2099-03-03T15:00:00.000Z'),
      endTime: new Date('2099-03-03T16:00:00.000Z'),
      status: 'awaiting_payment',
      totalPrice: 4500,
      totalDurationMinutes: 60,
    });
    await seedReward('reward_cas_tenant_local');
    await seedAttributedDeposit(
      'dep_reward_reservation_foreign',
      'reward_cas_tenant_local',
      'checkout_created',
      otherAppointmentId,
      otherSalonId,
    );

    await expect(markAppliedRewardForBooking(
      await contextFor('reward_cas_tenant_local', null),
    )).resolves.toBe('marked');

    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_cas_tenant_local')))[0]?.usedInAppointmentId)
      .toBe(APPOINTMENT_ID);
  });

  it('blocks an ordinary booking from consuming a reward reserved by an unpaid hold', async () => {
    await seedReward('reward_cas_reserved');
    await seedAttributedDeposit('dep_reward_reserved', 'reward_cas_reserved', 'checkout_created');

    await expect(markAppliedRewardForBooking(
      await contextFor('reward_cas_reserved', null),
    )).rejects.toBeInstanceOf(RewardConsumptionConflictError);

    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_cas_reserved')))[0]?.usedInAppointmentId)
      .toBeNull();
  });

  it('preserves ordinary reward marking through a proven historical phone alias', async () => {
    await seedReward('reward_cas_historical_alias', '4165551212');
    const context = await contextFor('reward_cas_historical_alias', null);

    await expect(markAppliedRewardForBooking({
      ...context,
      // Notifications use the current terminal contact, while rewardOwnerPhone
      // is the booking-request alias already proven to belong to that client.
      clientPhone: '6475553434',
      rewardOwnerPhone: '4165551212',
    })).resolves.toBe('marked');

    expect((await db.select().from(schema.rewardSchema)
      .where(eq(schema.rewardSchema.id, 'reward_cas_historical_alias')))[0]?.usedInAppointmentId)
      .toBe(APPOINTMENT_ID);
  });

  it('elects exactly one referrer bonus for a completed attributed booking', async () => {
    const referralId = 'referral_completed_attribution';
    const rewardId = 'reward_completed_attribution';
    await db.update(schema.appointmentSchema)
      .set({ status: 'completed' })
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await db.insert(schema.referralSchema).values({
      id: referralId,
      salonId: SALON_ID,
      referrerPhone: '4165557777',
      refereePhone: '4165551234',
      status: 'claimed',
      expiresAt: new Date('2099-12-01T00:00:00.000Z'),
    });
    await db.insert(schema.rewardSchema).values({
      id: rewardId,
      salonId: SALON_ID,
      clientPhone: '4165551234',
      referralId,
      type: 'referral_referee',
    });
    await seedAttributedDeposit('dep_completed_attribution', rewardId);

    const run = () => db.transaction(tx => markExactAttributedRewardForPaidDepositInTx(tx, {
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      depositId: 'dep_completed_attribution',
      rewardId,
    }));

    await expect(run()).resolves.toBe('marked');
    await expect(run()).resolves.toBe('already_marked');

    const rewards = await db.select().from(schema.rewardSchema);
    const [referral] = await db.select().from(schema.referralSchema)
      .where(eq(schema.referralSchema.id, referralId));

    expect(referral?.status).toBe('reward_earned');
    expect(rewards.filter(row => (
      row.referralId === referralId && row.type === 'referral_referrer'
    ))).toHaveLength(1);
  });

  it('never advances a foreign-tenant referral named by a local attribution', async () => {
    const foreignSalonId = 'salon_bce_foreign_referral';
    const referralId = 'referral_foreign_attribution';
    const rewardId = 'reward_foreign_referral_attribution';
    await db.insert(schema.salonSchema).values({
      id: foreignSalonId,
      name: 'Foreign Referral Salon',
      slug: 'foreign-referral-salon',
      ownerEmail: 'foreign-referral@example.invalid',
    });
    await db.insert(schema.referralSchema).values({
      id: referralId,
      salonId: foreignSalonId,
      referrerPhone: '6475557777',
      refereePhone: '4165551234',
      status: 'claimed',
      expiresAt: new Date('2099-12-01T00:00:00.000Z'),
    });
    await db.update(schema.appointmentSchema)
      .set({ status: 'completed' })
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await db.insert(schema.rewardSchema).values({
      id: rewardId,
      salonId: SALON_ID,
      clientPhone: '4165551234',
      referralId,
      type: 'referral_referee',
    });
    await seedAttributedDeposit('dep_foreign_referral_attribution', rewardId);

    await expect(db.transaction(tx => markExactAttributedRewardForPaidDepositInTx(tx, {
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      depositId: 'dep_foreign_referral_attribution',
      rewardId,
    }))).resolves.toBe('marked');

    const [foreignReferral] = await db.select().from(schema.referralSchema)
      .where(eq(schema.referralSchema.id, referralId));
    const foreignBonuses = (await db.select().from(schema.rewardSchema)).filter(row => (
      row.salonId === foreignSalonId
      && row.referralId === referralId
      && row.type === 'referral_referrer'
    ));

    expect(foreignReferral?.status).toBe('claimed');
    expect(foreignBonuses).toHaveLength(0);
  });
});

describe('formatLocationAddress', () => {
  it('joins the present parts and returns null when none are', () => {
    expect(formatLocationAddress(null)).toBeNull();
    expect(formatLocationAddress({ address: null, city: null, state: null, zipCode: null }))
      .toBeNull();
    expect(formatLocationAddress({ address: ' 123 Yonge St ', city: 'Toronto' }))
      .toBe('123 Yonge St, Toronto');
  });
});
