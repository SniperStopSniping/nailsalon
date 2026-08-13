import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  failAfterTransactionBody: false,
}));
const guards = vi.hoisted(() => ({
  requireClientApiSession: vi.fn(),
  requireClientSalonFromBody: vi.fn(),
  guardModuleOr403: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({
  usesRuntimePostgres: false,
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
vi.mock('@/libs/clientLifecycleStabilization', () => ({
  lockOperationalSalonClientContactWithHandle: vi.fn(async (
    _tx: unknown,
    input: { clientId: string },
  ) => ({ id: input.clientId })),
  withClientLifecycleTransactionRetry: vi.fn(async (
    operation: (attempt: number) => Promise<unknown>,
  ) => operation(1)),
}));

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_points_calendar';
const CLIENT_ID = 'client_points_calendar';
const APPOINTMENT_ID = 'appt_points_calendar';
const PHONE = '4165550142';

let client: PGlite;
let realDb: ReturnType<typeof drizzle<typeof schema>>;

function exposedDb() {
  return new Proxy(realDb, {
    get(target, property, receiver) {
      if (property === 'transaction') {
        return async (callback: (tx: unknown) => Promise<unknown>) =>
          target.transaction(async (tx) => {
            const result = await callback(tx);
            if (holder.failAfterTransactionBody) {
              throw new Error('FORCED_CALENDAR_TRANSACTION_ROLLBACK');
            }
            return result;
          });
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function request() {
  return new Request('http://localhost/api/rewards/redeem-points', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rewardTitle: 'Service credit',
      rewardPoints: 2500,
      appointmentId: APPOINTMENT_ID,
      salonSlug: 'points-calendar',
    }),
  });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  realDb = drizzle(client, { schema });
  await migrate(realDb, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = exposedDb();
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  holder.failAfterTransactionBody = false;
  holder.db = exposedDb();

  await realDb.delete(schema.integrationOutboxSchema);
  await realDb.delete(schema.appointmentSchema);
  await realDb.delete(schema.salonClientSchema);
  await realDb.delete(schema.salonSchema);

  await realDb.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Points Calendar Salon',
    slug: 'points-calendar',
    ownerEmail: 'owner.points@example.invalid',
    rewardsEnabled: true,
  });
  await realDb.insert(schema.salonClientSchema).values({
    id: CLIENT_ID,
    salonId: SALON_ID,
    phone: PHONE,
    fullName: 'Points Client',
    loyaltyPoints: 5000,
  });
  await realDb.insert(schema.appointmentSchema).values({
    id: APPOINTMENT_ID,
    salonId: SALON_ID,
    salonClientId: CLIENT_ID,
    clientPhone: PHONE,
    clientName: 'Points Client',
    startTime: new Date('2099-06-01T15:00:00.000Z'),
    endTime: new Date('2099-06-01T16:00:00.000Z'),
    status: 'confirmed',
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });

  guards.requireClientApiSession.mockResolvedValue({
    ok: true,
    normalizedPhone: PHONE,
    session: { phone: `+1${PHONE}` },
  });
  guards.requireClientSalonFromBody.mockResolvedValue({
    ok: true,
    salon: { id: SALON_ID, slug: 'points-calendar', rewardsEnabled: true },
  });
  guards.guardModuleOr403.mockResolvedValue(null);
});

afterAll(async () => {
  await client.close();
});

describe('points redemption Calendar mutation', () => {
  it('commits price, points, and one durable same-revision Calendar intent', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);

    const [appointment] = await realDb.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    const [salonClient] = await realDb.select().from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, CLIENT_ID));
    const jobs = await realDb.select().from(schema.integrationOutboxSchema);

    expect(appointment).toMatchObject({
      totalPrice: 4500,
      googleCalendarSyncStatus: 'pending',
    });
    expect(appointment?.notes).toContain('[Points redeemed: Service credit - 2,500 pts for $5.00 off]');
    expect(salonClient?.loyaltyPoints).toBe(2500);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      operation: 'sync_appointment',
      provider: 'google_calendar',
      status: 'pending',
    });
    expect(jobs[0]?.payload).toEqual(expect.objectContaining({
      appointmentId: APPOINTMENT_ID,
      mutationVersion: appointment?.updatedAt.toISOString(),
      salonId: SALON_ID,
    }));
  });

  it('rolls back price, points, and Calendar work when the transaction cannot commit', async () => {
    holder.failAfterTransactionBody = true;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(request());

    expect(response.status).toBe(500);

    const [appointment] = await realDb.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    const [salonClient] = await realDb.select().from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, CLIENT_ID));

    expect(appointment).toMatchObject({
      totalPrice: 5000,
      notes: null,
      googleCalendarSyncStatus: 'not_synced',
    });
    expect(salonClient?.loyaltyPoints).toBe(5000);
    await expect(realDb.select().from(schema.integrationOutboxSchema)).resolves.toEqual([]);

    consoleError.mockRestore();
  });
});
