import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const enqueue = vi.hoisted(() => vi.fn(async () => ({ intentId: 'ci-existing-winner', created: false })));

vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
}, usesRuntimePostgres: false }));
vi.mock('@/libs/communicationIntent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/communicationIntent')>();
  return { ...actual, enqueueCommunicationIntent: enqueue };
});

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;
const now = new Date('2030-09-10T17:00:00.000Z');

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 30_000);

afterAll(async () => client.close());

async function seed() {
  sequence += 1;
  const salonId = `late-salon-${sequence}`;
  const clientId = `late-client-${sequence}`;
  const phone = `416555${String(7000 + sequence).padStart(4, '0')}`;
  await db.insert(schema.salonSchema).values({
    id: salonId,
    slug: salonId,
    name: 'Late collision salon',
    settings: { communications: { sms: { enabled: true } }, booking: { timezone: 'America/Toronto' } } as never,
  });
  await db.insert(schema.salonClientSchema).values({ id: clientId, salonId, fullName: 'Ava', phone });
  await db.insert(schema.communicationConsentSchema).values({
    id: `late-consent-${sequence}`,
    salonId,
    recipient: phone,
    channel: 'sms',
    purpose: 'appointment_transactional',
    status: 'granted',
    source: 'test',
    wordingVersion: 'test-v1',
  });
  await db.insert(schema.salonRetentionSettingsSchema).values({
    salonId,
    googleReviewUrl: 'https://g.page/r/test/review',
    automaticReviewRequests: true,
    reviewRequestDelayMinutes: 60,
    reviewRequestsEnabledAt: new Date('2030-09-01T00:00:00.000Z'),
  });
  return { salonId, clientId };
}

describe('late manual enqueue collision rollback (PGlite)', () => {
  it('rolls back an appointmentless review row when enqueue reports an existing winner after the early read', async () => {
    const fixture = await seed();
    const { queueClientReviewRequest } = await import('./reviewRequests.server');

    await expect(queueClientReviewRequest({
      ...fixture,
      message: 'Please leave a review',
      requestId: crypto.randomUUID(),
      now,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(await db.select().from(schema.reviewRequestSchema)
      .where(eq(schema.reviewRequestSchema.salonId, fixture.salonId))).toEqual([]);
    expect(await db.select().from(schema.communicationIntentSchema)
      .where(eq(schema.communicationIntentSchema.salonId, fixture.salonId))).toEqual([]);
  });

  it('rejects an ordinary manual SMS at the same late boundary without creating a foreign intent', async () => {
    const fixture = await seed();
    const { queueClientSms } = await import('./clientMessaging');

    await expect(queueClientSms({
      ...fixture,
      message: 'Appointment update',
      requestId: crypto.randomUUID(),
      now,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(await db.select().from(schema.communicationIntentSchema)
      .where(eq(schema.communicationIntentSchema.salonId, fixture.salonId))).toEqual([]);
  });
});
