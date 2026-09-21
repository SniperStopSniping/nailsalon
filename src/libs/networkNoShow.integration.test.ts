import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  eraseNetworkNoShowSubjectInTx,
  readNetworkNoShowRisk,
  recordNetworkNoShowInTx,
  registerNetworkBookingInTx,
  suppressNetworkNoShowSubjectInTx,
} from '@/libs/networkNoShow.server';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;
const now = new Date('2030-06-15T16:00:00.000Z');

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 30_000);

beforeEach(() => {
  process.env.NETWORK_NO_SHOW_ENABLED = 'true';
  process.env.NETWORK_NO_SHOW_HMAC_KEY = 'test-network-no-show-hmac-key-at-least-32-chars';
});

afterAll(async () => client.close());

async function participant(salonId: string) {
  await db.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: salonId });
  await db.insert(schema.networkNoShowParticipationSchema).values({
    salonId,
    enabledAt: new Date('2030-01-01T00:00:00.000Z'),
    prospectiveAfter: new Date('2030-01-01T00:00:00.000Z'),
  });
}

async function booking(input: { salonId: string; phone?: string; email?: string; status?: string; actorRole?: 'guest' | 'client' | 'admin' | 'staff' }) {
  sequence += 1;
  const id = `network-appt-${sequence}`;
  const phone = input.phone ?? `416555${String(1000 + sequence).padStart(4, '0')}`;
  const email = input.email ?? `customer-${sequence}@example.com`;
  const endTime = new Date('2030-06-15T15:00:00.000Z');
  await db.insert(schema.appointmentSchema).values({
    id,
    salonId: input.salonId,
    clientPhone: phone,
    clientEmail: email,
    startTime: new Date('2030-06-15T14:00:00.000Z'),
    endTime,
    status: input.status ?? 'confirmed',
    totalPrice: 5000,
    totalDurationMinutes: 60,
    createdAt: new Date('2030-06-01T00:00:00.000Z'),
  });
  await db.transaction(tx => registerNetworkBookingInTx(tx, {
    salonId: input.salonId,
    appointmentId: id,
    phone,
    email,
    actorRole: input.actorRole ?? 'guest',
    now,
  }));
  return { id, phone, email };
}

describe('network no-show storage', () => {
  it('is dark without the platform gate', async () => {
    process.env.NETWORK_NO_SHOW_ENABLED = 'false';

    await expect(readNetworkNoShowRisk({ salonId: 'missing', phone: '4165551000', email: 'customer@example.com' })).resolves.toEqual({ state: 'inactive' });
  });

  it('records one source event and revokes it immediately on correction', async () => {
    const source = `network-source-${sequence}`;
    const receiver = `network-receiver-${sequence}`;
    await participant(source);
    await participant(receiver);
    const entry = await booking({ salonId: source, status: 'no_show' });
    await db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: source, appointmentId: entry.id, actorId: 'owner-1', actorRole: 'owner', now }));

    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: entry.phone, email: entry.email })).resolves.toEqual({ state: 'available', activeNoShowCount: 1, windowMonths: 12 });

    await db.update(schema.appointmentSchema).set({ status: 'completed' })
      .where(and(eq(schema.appointmentSchema.salonId, source), eq(schema.appointmentSchema.id, entry.id)));

    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: entry.phone, email: entry.email })).resolves.toEqual({ state: 'available', activeNoShowCount: 0, windowMonths: 12 });
    expect((await db.select().from(schema.networkNoShowBookingBindingSchema)
      .where(and(eq(schema.networkNoShowBookingBindingSchema.salonId, source), eq(schema.networkNoShowBookingBindingSchema.appointmentId, entry.id))))[0]?.state).toBe('eligible');

    await db.update(schema.appointmentSchema).set({ status: 'no_show' }).where(eq(schema.appointmentSchema.id, entry.id));

    expect((await db.select().from(schema.networkNoShowEventSchema)
      .where(eq(schema.networkNoShowEventSchema.appointmentId, entry.id)))[0]?.state).toBe('revoked');
  });

  it('does not match a phone-only collision and suppresses an edited binding before no-show', async () => {
    const source = `network-contact-${sequence}`;
    const receiver = `network-contact-receiver-${sequence}`;
    await participant(source);
    await participant(receiver);
    const entry = await booking({ salonId: source });
    await db.update(schema.appointmentSchema).set({ clientEmail: 'changed@example.com' })
      .where(eq(schema.appointmentSchema.id, entry.id));
    await db.update(schema.appointmentSchema).set({ status: 'no_show' }).where(eq(schema.appointmentSchema.id, entry.id));
    await db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: source, appointmentId: entry.id, actorId: 'owner-1', actorRole: 'owner', now }));

    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: entry.phone, email: entry.email })).resolves.toEqual({ state: 'available', activeNoShowCount: 0, windowMonths: 12 });
    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: entry.phone, email: 'other@example.com' })).resolves.toEqual({ state: 'unavailable' });
  });

  it('does not bind owner-created appointments and withdraws a disabled source contribution', async () => {
    const source = `network-owner-${sequence}`;
    const receiver = `network-owner-receiver-${sequence}`;
    await participant(source);
    await participant(receiver);
    const ownerEntry = await booking({ salonId: source, status: 'no_show', actorRole: 'admin' });
    await db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: source, appointmentId: ownerEntry.id, actorId: 'owner-1', actorRole: 'owner', now }));

    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: ownerEntry.phone, email: ownerEntry.email })).resolves.toEqual({ state: 'unavailable' });

    const guestEntry = await booking({ salonId: source, status: 'no_show' });
    await db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: source, appointmentId: guestEntry.id, actorId: 'owner-1', actorRole: 'owner', now }));
    await db.update(schema.networkNoShowParticipationSchema).set({ disabledAt: now }).where(eq(schema.networkNoShowParticipationSchema.salonId, source));

    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: guestEntry.phone, email: guestEntry.email })).resolves.toEqual({ state: 'available', activeNoShowCount: 0, windowMonths: 12 });
  });

  it('suppresses a binding when a projected appointment is rescheduled', async () => {
    const source = `network-schedule-${sequence}`;
    await participant(source);
    const entry = await booking({ salonId: source, status: 'no_show' });
    await db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: source, appointmentId: entry.id, actorId: 'owner-1', actorRole: 'owner', now }));
    await db.update(schema.appointmentSchema).set({ startTime: new Date('2030-06-16T14:00:00.000Z') })
      .where(eq(schema.appointmentSchema.id, entry.id));

    expect((await db.select().from(schema.networkNoShowBookingBindingSchema)
      .where(eq(schema.networkNoShowBookingBindingSchema.appointmentId, entry.id)))[0]?.state).toBe('suppressed');
  });

  it('suppresses and erases a subject without exposing source data', async () => {
    const source = `network-erase-${sequence}`;
    const receiver = `network-erase-receiver-${sequence}`;
    await participant(source);
    await participant(receiver);
    const entry = await booking({ salonId: source, status: 'no_show', email: `erase-${sequence}@example.com` });
    await db.transaction(tx => recordNetworkNoShowInTx(tx, { salonId: source, appointmentId: entry.id, actorId: 'owner-1', actorRole: 'owner', now }));
    const [binding] = await db.select().from(schema.networkNoShowBookingBindingSchema)
      .where(and(eq(schema.networkNoShowBookingBindingSchema.salonId, source), eq(schema.networkNoShowBookingBindingSchema.appointmentId, entry.id)));

    expect(binding?.subjectId).toBeTruthy();

    if (!binding?.subjectId) {
      throw new Error('Expected an eligible subject binding');
    }

    const subjectId = binding.subjectId;
    await db.transaction(tx => suppressNetworkNoShowSubjectInTx(tx, { subjectId, operatorId: 'operator-1', now, reason: 'shared_contact' }));

    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: entry.phone, email: entry.email })).resolves.toEqual({ state: 'unavailable' });

    await db.transaction(tx => eraseNetworkNoShowSubjectInTx(tx, { subjectId, operatorId: 'operator-1', now }));

    expect(await db.select().from(schema.networkNoShowEventSchema).where(eq(schema.networkNoShowEventSchema.subjectId, subjectId))).toHaveLength(0);
  });

  it('counts separate appointments once each, corrects while dark, and expires at the exact anniversary', async () => {
    const sourceA = `network-count-a-${sequence}`;
    const sourceC = `network-count-c-${sequence}`;
    const receiver = `network-count-b-${sequence}`;
    await participant(sourceA);
    await participant(sourceC);
    await participant(receiver);
    const first = await booking({ salonId: sourceA, status: 'no_show' });
    const second = await booking({ salonId: sourceC, status: 'no_show', phone: first.phone, email: first.email });
    const mark = (salonId: string, appointmentId: string) => db.transaction(tx => recordNetworkNoShowInTx(tx, {
      salonId,
      appointmentId,
      actorId: 'owner-count',
      actorRole: 'owner',
      now,
    }));
    await mark(sourceA, first.id);
    await mark(sourceA, first.id);
    await mark(sourceC, second.id);
    const read = (at: Date) => readNetworkNoShowRisk({ salonId: receiver, phone: first.phone, email: first.email, now: at });

    await expect(read(now)).resolves.toEqual({ state: 'available', activeNoShowCount: 2, windowMonths: 12 });

    process.env.NETWORK_NO_SHOW_ENABLED = 'false';
    await db.update(schema.appointmentSchema).set({ status: 'completed' }).where(eq(schema.appointmentSchema.id, first.id));
    process.env.NETWORK_NO_SHOW_ENABLED = 'true';

    await expect(read(now)).resolves.toEqual({ state: 'available', activeNoShowCount: 1, windowMonths: 12 });
    await expect(read(new Date('2031-06-15T14:59:59.999Z'))).resolves.toEqual({ state: 'available', activeNoShowCount: 1, windowMonths: 12 });
    await expect(read(new Date('2031-06-15T15:00:00.000Z'))).resolves.toEqual({ state: 'available', activeNoShowCount: 0, windowMonths: 12 });
    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: '4165559999', email: first.email, now })).resolves.toEqual({ state: 'unavailable' });
    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: first.phone, email: null, now })).resolves.toEqual({ state: 'unavailable' });
  });

  it('does not register pre-participation appointments or report no-shows before the appointment ends', async () => {
    const source = `network-prospective-${sequence}`;
    const receiver = `network-prospective-receiver-${sequence}`;
    await participant(source);
    await participant(receiver);
    const early = await booking({ salonId: source, status: 'no_show' });
    await db.transaction(tx => recordNetworkNoShowInTx(tx, {
      salonId: source,
      appointmentId: early.id,
      actorId: 'owner-early',
      actorRole: 'owner',
      now: new Date('2030-06-15T14:00:00.000Z'),
    }));

    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: early.phone, email: early.email, now })).resolves.toEqual({ state: 'available', activeNoShowCount: 0, windowMonths: 12 });

    await db.update(schema.networkNoShowParticipationSchema).set({ prospectiveAfter: now }).where(eq(schema.networkNoShowParticipationSchema.salonId, source));
    const old = await booking({ salonId: source, status: 'no_show' });
    await db.transaction(tx => recordNetworkNoShowInTx(tx, {
      salonId: source,
      appointmentId: old.id,
      actorId: 'owner-old',
      actorRole: 'owner',
      now,
    }));

    await expect(readNetworkNoShowRisk({ salonId: receiver, phone: old.phone, email: old.email, now })).resolves.toEqual({ state: 'unavailable' });
  });
});
