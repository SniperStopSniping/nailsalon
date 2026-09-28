import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));

/* eslint-disable import/first */
import { checkFeatureEntitlement, getSalonFeatures, resolveFeatures } from '@/libs/salonStatus';
/* eslint-enable import/first */

let client: PGlite;
const plans = ['free', 'single_salon', 'multi_salon', 'enterprise'] as const;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  const database = drizzle(client, { schema });
  holder.db = database;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  await database.insert(schema.salonSchema).values(plans.map(plan => ({
    id: `sms-access-${plan}`,
    slug: `sms-access-${plan}`,
    name: 'SMS access fixture',
    plan,
    smsRemindersEnabled: false,
    features: { smsReminders: false, marketing: { smsReminders: false }, analyticsDashboard: true },
    settings: { modules: { smsReminders: false }, communications: { sms: { enabled: false } } },
  })));
});

afterAll(async () => {
  await client.close();
});

describe('legacy salon SMS capability projections', () => {
  it.each(plans)('includes SMS on %s without activating any saved SMS preferences', async (plan) => {
    const salonId = `sms-access-${plan}`;

    expect(await checkFeatureEntitlement(salonId, 'smsReminders')).toEqual({ enabled: true });
    expect(await getSalonFeatures(salonId)).toMatchObject({ smsReminders: true, analyticsDashboard: true });

    const database = drizzle(client, { schema });
    const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, salonId));

    expect(salon?.smsRemindersEnabled).toBe(false);
    expect(salon?.features?.marketing?.smsReminders).toBe(false);
    expect(salon?.settings).toMatchObject({ modules: { smsReminders: false }, communications: { sms: { enabled: false } } });
  });

  it.each([null, undefined, {}, { smsReminders: false }, { marketing: { smsReminders: false } }])('resolves included SMS from legacy feature data %j', (features) => {
    expect(resolveFeatures(features)).toMatchObject({ smsReminders: true, rewards: true, analyticsDashboard: true });
  });

  it('does not project access for a nonexistent salon', async () => {
    expect(await checkFeatureEntitlement('missing-salon', 'smsReminders')).toMatchObject({ enabled: false });
    expect(await getSalonFeatures('missing-salon')).toBeNull();
  });
});

describe('operational core booking controls', () => {
  it('preserves an explicit online-booking off setting while commercial flags are universal', async () => {
    const database = drizzle(client, { schema });
    await database.update(schema.salonSchema)
      .set({
        onlineBookingEnabled: false,
        features: {
          onlineBooking: false,
          booking: { onlineBooking: true, staffDashboard: false },
          clientProfiles: false,
          clients: { clientProfiles: false },
          marketing: { rewards: false },
        },
      })
      .where(eq(schema.salonSchema.id, 'sms-access-free'));

    expect(resolveFeatures({
      onlineBooking: false,
      booking: { onlineBooking: true, staffDashboard: false },
      clients: { clientProfiles: false },
      rewards: false,
    })).toMatchObject({
      onlineBooking: false,
      staffDashboard: false,
      clientProfiles: false,
      rewards: true,
    });
    expect(resolveFeatures({
      onlineBooking: true,
      booking: { onlineBooking: false },
    }).onlineBooking).toBe(false);
    expect(await checkFeatureEntitlement('sms-access-free', 'onlineBooking'))
      .toEqual({ enabled: false });
    expect(await checkFeatureEntitlement('sms-access-free', 'staffDashboard'))
      .toEqual({ enabled: false });
    expect(await getSalonFeatures('sms-access-free')).toMatchObject({
      onlineBooking: false,
      staffDashboard: false,
      clientProfiles: false,
      rewards: true,
    });
  });
});
