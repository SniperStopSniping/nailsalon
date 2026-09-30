import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { DEFAULT_REBOOKING_REMINDER_MESSAGE, rebookingReminderDueAt, rebookingReminderUpdateSchema, renderRebookingReminder } from './rebookingReminders';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown, consent: vi.fn() }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/clientSmsEligibility.server', () => ({ getClientSmsPurposeEligibility: holder.consent }));

const COMPLETED_AT = new Date('2026-09-30T15:00:00Z');
const DUE_NOW = new Date('2026-10-21T14:05:00Z');
let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;

async function seed(input: { status?: string; enabled?: boolean; blocked?: boolean; completedAt?: Date; message?: string; timeZone?: string } = {}) {
  sequence += 1;
  const salonId = `rebooking-salon-${sequence}`;
  const clientId = `rebooking-client-${sequence}`;
  const appointmentId = `rebooking-appointment-${sequence}`;
  await db.insert(schema.salonSchema).values({ id: salonId, name: `Salon ${sequence}`, slug: salonId, settings: { booking: { timezone: input.timeZone ?? 'America/Toronto' } } as never });
  await db.insert(schema.salonClientSchema).values({ id: clientId, salonId, phone: `416555${String(1000 + sequence).padStart(4, '0')}`, fullName: 'Alex Client', isBlocked: input.blocked ?? false });
  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId,
    salonClientId: clientId,
    clientPhone: `416555${String(1000 + sequence).padStart(4, '0')}`,
    clientName: 'Alex Client',
    startTime: new Date('2026-09-30T14:00:00Z'),
    endTime: COMPLETED_AT,
    status: input.status ?? 'completed',
    completedAt: input.completedAt ?? COMPLETED_AT,
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });
  await db.insert(schema.rebookingReminderSettingsSchema).values({
    salonId,
    enabled: input.enabled ?? true,
    enabledAt: new Date('2026-09-29T00:00:00Z'),
    defaultIntervalWeeks: 3,
    messageTemplate: input.message ?? DEFAULT_REBOOKING_REMINDER_MESSAGE,
  });
  return { salonId, clientId, appointmentId };
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  holder.db = db;
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  process.env.PUBLIC_APP_URL = 'https://www.lustergel.app';
});

beforeEach(() => {
  holder.consent.mockReset().mockResolvedValue({ state: 'enabled' });
});

afterAll(async () => {
  await client?.close();
});

describe('automatic rebooking reminders', () => {
  it('uses the salon calendar day across daylight saving changes', () => {
    expect(rebookingReminderDueAt(COMPLETED_AT, 3, 'America/Toronto').toISOString()).toBe('2026-10-21T14:00:00.000Z');
    expect(rebookingReminderDueAt(new Date('2026-10-25T15:00:00Z'), 3, 'America/Toronto').toISOString()).toBe('2026-11-15T15:00:00.000Z');
    expect(rebookingReminderDueAt(COMPLETED_AT, 3, 'America/Vancouver').toISOString()).toBe('2026-10-21T17:00:00.000Z');
  });

  it('validates edited copy and renders only the supported variables', () => {
    expect(rebookingReminderUpdateSchema.safeParse({ enabled: true, defaultIntervalWeeks: 3, messageTemplate: 'Hi {{first_name}}, book {{service_name}} at {{salon_name}}: {{booking_link}}' }).success).toBe(true);
    expect(rebookingReminderUpdateSchema.safeParse({ enabled: true, defaultIntervalWeeks: 3, messageTemplate: 'Hi {{secret}}' }).success).toBe(false);
    expect(renderRebookingReminder('Hi {{first_name}} at {{salon_name}}', { first_name: 'Alex', service_name: 'Gel', salon_name: 'Isla', booking_link: 'https://example.test' })).toBe('Hi Alex at Isla');
  });

  it('queues once per completed appointment and uses edited wording', async () => {
    const { salonId, appointmentId } = await seed({ message: 'Hi {{first_name}}, book at {{salon_name}}: {{booking_link}}' });
    const { materializeRebookingReminders } = await import('./rebookingReminders.server');
    const first = await materializeRebookingReminders(DUE_NOW);
    const second = await materializeRebookingReminders(DUE_NOW);
    const intents = await db.select().from(schema.communicationIntentSchema)
      .where(eq(schema.communicationIntentSchema.appointmentId, appointmentId));

    expect(first.queued).toBe(1);
    expect(second.queued).toBe(0);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ salonId, eventType: 'rebooking_reminder', dedupeKey: `rebooking:${salonId}:${appointmentId}` });
    expect(intents[0]!.variables.message).toContain(`Hi Alex, book at Salon`);
    expect(intents[0]!.variables.message).toContain(`/en/${salonId}/book/service`);

    await db.update(schema.rebookingReminderSettingsSchema)
      .set({ messageTemplate: 'Updated {{first_name}}: {{booking_link}}' })
      .where(eq(schema.rebookingReminderSettingsSchema.salonId, salonId));
    const { rebookingReminderSendContext } = await import('./rebookingReminders.server');
    const current = await rebookingReminderSendContext(salonId, appointmentId, DUE_NOW);

    expect(current?.message).toContain('Updated Alex:');
  });

  it('includes a recent completed visit when its reminder date follows enablement', async () => {
    const { salonId, appointmentId } = await seed();
    const { materializeRebookingReminders, rebookingReminderSendContext } = await import('./rebookingReminders.server');
    await db.update(schema.rebookingReminderSettingsSchema)
      .set({ enabledAt: new Date('2026-10-10T15:00:00Z') })
      .where(eq(schema.rebookingReminderSettingsSchema.salonId, salonId));

    expect(await rebookingReminderSendContext(salonId, appointmentId, DUE_NOW)).not.toBeNull();

    await materializeRebookingReminders(DUE_NOW);

    expect(await db.select().from(schema.communicationIntentSchema)
      .where(eq(schema.communicationIntentSchema.appointmentId, appointmentId))).toHaveLength(1);

    await db.update(schema.rebookingReminderSettingsSchema)
      .set({ enabledAt: new Date('2026-10-22T15:00:00Z') })
      .where(eq(schema.rebookingReminderSettingsSchema.salonId, salonId));

    expect(await rebookingReminderSendContext(salonId, appointmentId, DUE_NOW)).toBeNull();
  });

  it('can resolve a service interval override from the booked service snapshot', async () => {
    const { salonId, appointmentId } = await seed({ message: 'Book {{service_name}}: {{booking_link}}' });
    const serviceId = `rebooking-service-${sequence}`;
    await db.insert(schema.serviceSchema).values({
      id: serviceId,
      salonId,
      name: 'Renamed service',
      price: 5000,
      durationMinutes: 60,
      category: 'hands',
    });
    await db.insert(schema.appointmentServicesSchema).values({
      id: `appointment-service-${sequence}`,
      appointmentId,
      serviceId,
      priceAtBooking: 5000,
      durationAtBooking: 60,
      nameSnapshot: 'Gel manicure',
    });
    await db.insert(schema.rebookingReminderServiceIntervalSchema).values({ salonId, serviceId, intervalWeeks: 4 });

    const { rebookingReminderSendContext } = await import('./rebookingReminders.server');

    expect(await rebookingReminderSendContext(salonId, appointmentId, DUE_NOW)).toBeNull();

    const due = await rebookingReminderSendContext(salonId, appointmentId, new Date('2026-10-28T14:05:00Z'));

    expect(due?.message).toContain('Book Gel manicure:');
  });

  it('skips disabled, cancelled, no-show, and blocked clients', async () => {
    const disabled = await seed({ enabled: false });
    const cancelled = await seed({ status: 'cancelled' });
    const noShow = await seed({ status: 'no_show' });
    const blocked = await seed({ blocked: true });
    const { materializeRebookingReminders } = await import('./rebookingReminders.server');
    await materializeRebookingReminders(DUE_NOW);
    const ids = [disabled, cancelled, noShow, blocked].map(value => value.appointmentId);
    const intents = await db.select().from(schema.communicationIntentSchema);

    expect(intents.filter(intent => intent.appointmentId && ids.includes(intent.appointmentId))).toHaveLength(0);
  });

  it('skips a client who already has an upcoming booking or a later completed visit', async () => {
    const upcoming = await seed();
    const later = await seed();
    await db.insert(schema.appointmentSchema).values({
      id: `upcoming-${upcoming.appointmentId}`,
      salonId: upcoming.salonId,
      salonClientId: upcoming.clientId,
      clientPhone: '4165559999',
      startTime: new Date('2026-10-23T14:00:00Z'),
      endTime: new Date('2026-10-23T15:00:00Z'),
      status: 'confirmed',
      totalPrice: 5000,
      totalDurationMinutes: 60,
    });
    await db.insert(schema.appointmentSchema).values({
      id: `later-${later.appointmentId}`,
      salonId: later.salonId,
      salonClientId: later.clientId,
      clientPhone: '4165559998',
      startTime: new Date('2026-10-01T14:00:00Z'),
      endTime: new Date('2026-10-01T15:00:00Z'),
      completedAt: new Date('2026-10-01T15:00:00Z'),
      status: 'completed',
      totalPrice: 5000,
      totalDurationMinutes: 60,
    });
    const { rebookingReminderSendContext } = await import('./rebookingReminders.server');

    expect(await rebookingReminderSendContext(upcoming.salonId, upcoming.appointmentId, DUE_NOW)).toBeNull();
    expect(await rebookingReminderSendContext(later.salonId, later.appointmentId, DUE_NOW)).toBeNull();
  });

  it('rechecks opt-out and prevents cross-salon reads', async () => {
    const own = await seed();
    const other = await seed();
    const { rebookingReminderSendContext } = await import('./rebookingReminders.server');

    expect(await rebookingReminderSendContext(other.salonId, own.appointmentId, DUE_NOW)).toBeNull();

    holder.consent.mockResolvedValue({ state: 'opted_out' });

    expect(await rebookingReminderSendContext(own.salonId, own.appointmentId, DUE_NOW)).toBeNull();
    expect(holder.consent).toHaveBeenCalledWith({ salonId: own.salonId, phone: expect.any(String), purpose: 'salon_promotions' });

    const { materializeRebookingReminders } = await import('./rebookingReminders.server');
    const before = await db.select().from(schema.communicationIntentSchema);
    await materializeRebookingReminders(DUE_NOW);
    const after = await db.select().from(schema.communicationIntentSchema);

    expect(after).toHaveLength(before.length);
  });
});
