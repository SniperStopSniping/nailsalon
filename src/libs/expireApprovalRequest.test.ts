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
import { expireApprovalRequest } from './expireApprovalRequest';
/* eslint-enable import/first */

const SALON_ID = 'salon_expire_approval';
const TECH_ID = 'tech_expire_approval';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function seedAppointment(args: {
  id: string;
  status: string;
  requestExpiresAt: Date | null;
  cancelReason?: string | null;
  startTime?: Date;
  endTime?: Date;
}): Promise<void> {
  await db.insert(schema.appointmentSchema).values({
    id: args.id,
    salonId: SALON_ID,
    technicianId: TECH_ID,
    clientPhone: '4165551234',
    clientEmail: 'client@example.test',
    startTime: args.startTime ?? new Date('2099-06-01T14:00:00.000Z'),
    endTime: args.endTime ?? new Date('2099-06-01T15:00:00.000Z'),
    status: args.status,
    cancelReason: args.cancelReason ?? null,
    requestExpiresAt: args.requestExpiresAt,
    confirmationModeSnapshot: args.requestExpiresAt !== null ? 'request_approval' : null,
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });
}

async function readAppointment(id: string) {
  const [row] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, id));
  return row;
}

async function readAuditRows(appointmentId: string) {
  return db.select().from(schema.appointmentAuditLogSchema).where(
    eq(schema.appointmentAuditLogSchema.appointmentId, appointmentId),
  );
}

async function readIntents(appointmentId: string) {
  return db.select().from(schema.communicationIntentSchema).where(
    eq(schema.communicationIntentSchema.appointmentId, appointmentId),
  );
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Expire Approval Salon',
    slug: 'expire-approval-salon',
  });
  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Approval Tech',
  });
}, 60_000);

beforeEach(async () => {
  await db.delete(schema.communicationIntentSchema);
  await db.delete(schema.appointmentAuditLogSchema);
  await db.delete(schema.appointmentSchema);
});

afterAll(async () => {
  await client.close();
});

describe('expireApprovalRequest', () => {
  it('transitions an expired explicit pending request to cancelled/request_expired, with an audit row and exactly one notification intent', async () => {
    const requestExpiresAt = new Date('2099-06-01T10:00:00.000Z');
    await seedAppointment({ id: 'appt_expired', status: 'pending', requestExpiresAt });
    const transactionNow = new Date('2099-06-01T10:00:01.000Z');

    const outcome = await db.transaction(tx => expireApprovalRequest(tx, {
      appointmentId: 'appt_expired',
      transactionNow,
    }));

    expect(outcome.outcome).toBe('transitioned');
    expect(outcome).toHaveProperty('notificationIntentId');

    const row = await readAppointment('appt_expired');

    expect(row?.status).toBe('cancelled');
    expect(row?.cancelReason).toBe('request_expired');
    expect(row?.canvasState).toBe('cancelled');

    const audits = await readAuditRows('appt_expired');

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'status_changed',
      performedByRole: 'system',
      reason: 'request_expired',
    });

    const intents = await readIntents('appt_expired');

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      salonId: SALON_ID,
      appointmentId: 'appt_expired',
      eventType: 'booking_request_expired',
      audience: 'client',
      status: 'pending',
      dedupeKey: `appointment-approval-expired:appt_expired:${requestExpiresAt.toISOString()}`,
    });
  });

  it('an expired request AT exactly the deadline instant transitions (at-or-after, not strictly-after)', async () => {
    const requestExpiresAt = new Date('2099-06-01T10:00:00.000Z');
    await seedAppointment({ id: 'appt_at_deadline', status: 'pending', requestExpiresAt });

    const outcome = await db.transaction(tx => expireApprovalRequest(tx, {
      appointmentId: 'appt_at_deadline',
      transactionNow: requestExpiresAt,
    }));

    expect(outcome.outcome).toBe('transitioned');
  });

  it('one instant before the deadline is not_expirable — the request is still live', async () => {
    const requestExpiresAt = new Date('2099-06-01T10:00:00.000Z');
    await seedAppointment({ id: 'appt_not_yet', status: 'pending', requestExpiresAt });

    const outcome = await db.transaction(tx => expireApprovalRequest(tx, {
      appointmentId: 'appt_not_yet',
      transactionNow: new Date(requestExpiresAt.getTime() - 1),
    }));

    expect(outcome).toEqual({ outcome: 'not_expirable' });

    const row = await readAppointment('appt_not_yet');

    expect(row?.status).toBe('pending');
  });

  it('a legacy pending row (NULL requestExpiresAt) is never expirable, at any `now`', async () => {
    await seedAppointment({ id: 'appt_legacy', status: 'pending', requestExpiresAt: null });

    const outcome = await db.transaction(tx => expireApprovalRequest(tx, {
      appointmentId: 'appt_legacy',
      transactionNow: new Date('2199-01-01T00:00:00.000Z'),
    }));

    expect(outcome).toEqual({ outcome: 'not_expirable' });

    const row = await readAppointment('appt_legacy');

    expect(row?.status).toBe('pending');

    const intents = await readIntents('appt_legacy');

    expect(intents).toHaveLength(0);
  });

  it('a confirmed appointment (even with a stale requestExpiresAt) is not_expirable', async () => {
    const requestExpiresAt = new Date('2099-06-01T10:00:00.000Z');
    await seedAppointment({ id: 'appt_confirmed', status: 'confirmed', requestExpiresAt });

    const outcome = await db.transaction(tx => expireApprovalRequest(tx, {
      appointmentId: 'appt_confirmed',
      transactionNow: new Date('2099-06-01T11:00:00.000Z'),
    }));

    expect(outcome).toEqual({ outcome: 'not_expirable' });

    const row = await readAppointment('appt_confirmed');

    expect(row?.status).toBe('confirmed');
  });

  it('a declined request (cancelled/declined_by_salon) is not_expirable, not already_expired — a decline is a different, legitimate terminal outcome', async () => {
    const requestExpiresAt = new Date('2099-06-01T10:00:00.000Z');
    await seedAppointment({
      id: 'appt_declined',
      status: 'cancelled',
      requestExpiresAt,
      cancelReason: 'declined_by_salon',
    });

    const outcome = await db.transaction(tx => expireApprovalRequest(tx, {
      appointmentId: 'appt_declined',
      transactionNow: new Date('2099-06-01T11:00:00.000Z'),
    }));

    expect(outcome).toEqual({ outcome: 'not_expirable' });
  });

  it('a nonexistent appointment id is not_expirable', async () => {
    const outcome = await db.transaction(tx => expireApprovalRequest(tx, {
      appointmentId: 'appt_missing',
      transactionNow: new Date('2099-06-01T11:00:00.000Z'),
    }));

    expect(outcome).toEqual({ outcome: 'not_expirable' });
  });

  it('retry-after-completion (sequential replay) is a no-op: already_expired, no second audit row, no second intent', async () => {
    const requestExpiresAt = new Date('2099-06-01T10:00:00.000Z');
    await seedAppointment({ id: 'appt_replay', status: 'pending', requestExpiresAt });
    const transactionNow = new Date('2099-06-01T10:05:00.000Z');

    const first = await db.transaction(tx => expireApprovalRequest(tx, {
      appointmentId: 'appt_replay',
      transactionNow,
    }));

    expect(first.outcome).toBe('transitioned');

    // A caller that does not know its own earlier transaction committed
    // (crash-after-commit) retries with a LATER `now`.
    const second = await db.transaction(tx => expireApprovalRequest(tx, {
      appointmentId: 'appt_replay',
      transactionNow: new Date(transactionNow.getTime() + 60_000),
    }));

    expect(second).toEqual({ outcome: 'already_expired' });

    const audits = await readAuditRows('appt_replay');

    expect(audits).toHaveLength(1);

    const intents = await readIntents('appt_replay');

    expect(intents).toHaveLength(1);
  });

  it('two sequential calls for the SAME expiry never produce two intents, even bypassing the row-lock guarantee (dedupe-key belt-and-suspenders)', async () => {
    // Regression guard for the enqueue step specifically: even if some future
    // change let two calls both pass the CAS (which the row lock should make
    // impossible), the dedupe key's unique index is the second backstop.
    const requestExpiresAt = new Date('2099-06-01T10:00:00.000Z');
    await seedAppointment({ id: 'appt_dedupe', status: 'pending', requestExpiresAt });
    const transactionNow = new Date('2099-06-01T10:05:00.000Z');

    const outcome = await db.transaction(tx => expireApprovalRequest(tx, {
      appointmentId: 'appt_dedupe',
      transactionNow,
    }));

    expect(outcome.outcome).toBe('transitioned');

    const dedupeKey = `appointment-approval-expired:appt_dedupe:${requestExpiresAt.toISOString()}`;
    const replayInsert = await db.insert(schema.communicationIntentSchema).values({
      id: 'ci_dedupe_replay_probe',
      salonId: SALON_ID,
      appointmentId: 'appt_dedupe',
      channel: 'sms',
      eventType: 'booking_request_expired',
      audience: 'client',
      dedupeKey,
      recipient: '4165551234',
      templateKey: 'client_booking_request_expired_shortlink',
      templateVersion: 'v1',
      variables: {},
      schedulingRevision: 'probe',
      scheduledFor: transactionNow,
      notAfter: new Date(transactionNow.getTime() + 60_000),
    }).onConflictDoNothing({ target: schema.communicationIntentSchema.dedupeKey }).returning();

    expect(replayInsert).toHaveLength(0);

    const intents = await readIntents('appt_dedupe');

    expect(intents).toHaveLength(1);
  });

  it('does not disturb an unrelated appointment row in the same salon', async () => {
    const requestExpiresAt = new Date('2099-06-01T10:00:00.000Z');
    await seedAppointment({ id: 'appt_target', status: 'pending', requestExpiresAt });
    await seedAppointment({
      id: 'appt_other',
      status: 'pending',
      requestExpiresAt,
      startTime: new Date('2099-06-02T14:00:00.000Z'),
      endTime: new Date('2099-06-02T15:00:00.000Z'),
    });

    await db.transaction(tx => expireApprovalRequest(tx, {
      appointmentId: 'appt_target',
      transactionNow: new Date('2099-06-01T11:00:00.000Z'),
    }));

    const other = await readAppointment('appt_other');

    expect(other?.status).toBe('pending');
    expect(other?.cancelReason).toBeNull();
  });
});
