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
    features: { smsReminders: false, marketing: { smsReminders: false }, analyticsDashboard: false },
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
    expect(await getSalonFeatures(salonId)).toMatchObject({ smsReminders: true, analyticsDashboard: false });

    const database = drizzle(client, { schema });
    const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, salonId));

    expect(salon?.smsRemindersEnabled).toBe(false);
    expect(salon?.features?.marketing?.smsReminders).toBe(false);
    expect(salon?.settings).toMatchObject({ modules: { smsReminders: false }, communications: { sms: { enabled: false } } });
  });

  it.each([null, undefined, {}, { smsReminders: false }, { marketing: { smsReminders: false } }])('resolves included SMS from legacy feature data %j', (features) => {
    expect(resolveFeatures(features)).toMatchObject({ smsReminders: true, rewards: false, analyticsDashboard: false });
  });

  it('does not project access for a nonexistent salon', async () => {
    expect(await checkFeatureEntitlement('missing-salon', 'smsReminders')).toMatchObject({ enabled: false });
    expect(await getSalonFeatures('missing-salon')).toBeNull();
  });
});
