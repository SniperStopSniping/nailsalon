import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let seq = 0;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

afterAll(async () => {
  await client.close();
});

async function seed(input: { client?: { id: string; phone: string; email?: string | null; archivedAt?: Date | null }; appointment: { phone: string; email?: string | null; salonClientId?: string | null } }) {
  seq += 1;
  const salonId = `phone-resolver-${seq}`;
  const appointmentId = `phone-appointment-${seq}`;
  await db.insert(schema.salonSchema).values({ id: salonId, name: salonId, slug: salonId });
  if (input.client) {
    await db.insert(schema.salonClientSchema).values({ ...input.client, salonId, fullName: 'Phone resolver', archivedAt: input.client.archivedAt ?? null });
  }
  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId,
    clientName: 'Guest',
    clientPhone: input.appointment.phone,
    clientEmail: input.appointment.email ?? null,
    salonClientId: input.appointment.salonClientId ?? null,
    status: 'confirmed',
    startTime: new Date('2027-01-01T10:00:00Z'),
    endTime: new Date('2027-01-01T11:00:00Z'),
    totalPrice: 50,
    totalDurationMinutes: 60,
  });
  return { salonId, appointmentId };
}

describe('operational booking-recovery phone resolver', () => {
  it('uses the linked terminal current phone without an email', async () => {
    const fixture = await seed({ client: { id: 'linked-a', phone: '4165550101' }, appointment: { phone: '4165550999', salonClientId: 'linked-a' } });
    const { resolveAppointmentOperationalPhoneRecipient } = await import('./clientLifecycleStabilization');

    await expect(resolveAppointmentOperationalPhoneRecipient(fixture)).resolves.toMatchObject({ status: 'terminal_current', terminalClientId: 'linked-a', phone: '4165550101' });
  });

  it('accepts a zero-candidate orphan phone without requiring email', async () => {
    const fixture = await seed({ appointment: { phone: '6475550102' } });
    const { resolveAppointmentOperationalPhoneRecipient } = await import('./clientLifecycleStabilization');

    await expect(resolveAppointmentOperationalPhoneRecipient(fixture)).resolves.toMatchObject({ status: 'appointment_snapshot', phone: '6475550102', terminalClientId: null });
  });

  it('resolves an unlinked legacy row when both phone and email match one canonical client', async () => {
    const fixture = await seed({ client: { id: 'both-a', phone: '6475550106', email: 'both@example.com' }, appointment: { phone: '6475550106', email: 'both@example.com' } });
    const { resolveAppointmentOperationalPhoneRecipient } = await import('./clientLifecycleStabilization');

    await expect(resolveAppointmentOperationalPhoneRecipient(fixture)).resolves.toMatchObject({ status: 'terminal_current', terminalClientId: 'both-a', phone: '6475550106' });
  });

  it('rejects an unlinked phone/email conflict', async () => {
    const fixture = await seed({ client: { id: 'email-owner', phone: '6475550103', email: 'a@example.com' }, appointment: { phone: '4165550103', email: 'a@example.com' } });
    const { resolveAppointmentOperationalPhoneRecipient } = await import('./clientLifecycleStabilization');

    await expect(resolveAppointmentOperationalPhoneRecipient(fixture)).resolves.toEqual({ status: 'unavailable' });
  });

  it('uses an archived linked terminal phone and does not fall back when it is missing', async () => {
    const archived = await seed({ client: { id: 'archived-a', phone: '4165550104', archivedAt: new Date('2026-01-01T00:00:00Z') }, appointment: { phone: '4165550999', salonClientId: 'archived-a' } });
    const missing = await seed({ client: { id: 'missing-a', phone: '' }, appointment: { phone: '4165550105', salonClientId: 'missing-a' } });
    const { resolveAppointmentOperationalPhoneRecipient } = await import('./clientLifecycleStabilization');

    await expect(resolveAppointmentOperationalPhoneRecipient(archived)).resolves.toMatchObject({ status: 'terminal_current', phone: '4165550104' });
    await expect(resolveAppointmentOperationalPhoneRecipient(missing)).resolves.toEqual({ status: 'unavailable' });
  });

  it('does not resolve an appointment through another tenant', async () => {
    const fixture = await seed({ appointment: { phone: '4165550107' } });
    const { resolveAppointmentOperationalPhoneRecipient } = await import('./clientLifecycleStabilization');

    await expect(resolveAppointmentOperationalPhoneRecipient({ salonId: 'other-salon', appointmentId: fixture.appointmentId })).resolves.toEqual({ status: 'unavailable' });
  });

  it('follows a merged source to the terminal current phone', async () => {
    const fixture = await seed({ client: { id: 'merged-terminal', phone: '4165550108' }, appointment: { phone: '4165550998' } });
    await db.execute(sql`ALTER TABLE salon_client DISABLE TRIGGER "salon_client_prevent_merged_source_update"`);
    await db.execute(sql`ALTER TABLE salon_client DISABLE TRIGGER "salon_client_enforce_merge_transition"`);
    await db.insert(schema.salonClientSchema).values({ id: 'merged-source', salonId: fixture.salonId, phone: '4165550998', fullName: 'Merged source', mergedIntoClientId: 'merged-terminal', mergedAt: new Date('2026-01-01T00:00:00Z') });
    await db.execute(sql`ALTER TABLE salon_client ENABLE TRIGGER "salon_client_prevent_merged_source_update"`);
    await db.execute(sql`ALTER TABLE salon_client ENABLE TRIGGER "salon_client_enforce_merge_transition"`);
    await db.update(schema.appointmentSchema).set({ salonClientId: 'merged-source' }).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { resolveAppointmentOperationalPhoneRecipient } = await import('./clientLifecycleStabilization');

    await expect(resolveAppointmentOperationalPhoneRecipient(fixture)).resolves.toMatchObject({ status: 'terminal_current', terminalClientId: 'merged-terminal', phone: '4165550108' });
  });
});
