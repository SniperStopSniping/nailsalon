import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

import { openAiBuilder } from './entry.server';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/features/onboarding-v1-integration/config.server', () => ({ isOnboardingV1IntegrationEnabled: () => true }));
const raw = process.env.CONCURRENCY_TEST_DATABASE_URL;
const target = raw ? requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: raw }) : null;
if (!target && process.env.AI_ENTRY_CONCURRENCY_REQUIRED === 'true') {
  throw new Error('AI entry concurrency verification requires an attested disposable database.');
}
let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  if (!target) {
    return;
  }
  pool = new Pool({ connectionString: target.connectionString, max: 6 });
  const connection = await pool.connect();
  try {
    await attestDisposableDatabaseSession(connection, target, resolveDisposableDatabaseServerExpectation(target));
  } finally {
    connection.release();
  }
  database = drizzle(pool, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = database;
}, 60000);

beforeEach(() => {
  for (const name of ['BUSINESS_SETUP_AI_ENABLED', 'BUSINESS_SETUP_SELF_SERVE_ENABLED', 'AI_CREDITS_ENABLED', 'AI_CREDIT_METERING_ENABLED']) {
    vi.stubEnv(name, 'true');
  }
});

afterEach(() => vi.unstubAllEnvs());

afterAll(async () => {
  await pool?.end();
});

const identity = () => ({ clerkUserId: `user_${randomUUID()}`, email: `${randomUUID()}@example.invalid`, verifiedEmail: 'verified@example.invalid', name: 'Synthetic owner', phoneE164: null });

describe.skipIf(!target)('AI builder entry on attested PostgreSQL', () => {
  it('creates one private business for simultaneous requests from the same verified account', async () => {
    const owner = identity();
    const results = await Promise.all([openAiBuilder(owner), openAiBuilder(owner), openAiBuilder(owner)]);

    expect(results.every(result => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);

    const [admin] = await database.select().from(schema.adminUserSchema).where(eq(schema.adminUserSchema.clerkUserId, owner.clerkUserId));
    const members = await database.select().from(schema.adminSalonMembershipSchema).where(eq(schema.adminSalonMembershipSchema.adminId, admin!.id));

    expect(members).toHaveLength(1);

    const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, members[0]!.salonId));

    expect(salon).toMatchObject({ publicationStatus: 'draft', onlineBookingEnabled: false, plan: 'free', ownerClerkUserId: owner.clerkUserId });
  });

  it('keeps concurrent owners separate and rejects a later forged salon selection', async () => {
    const owners = [identity(), identity()];
    const results = await Promise.all(owners.map(owner => openAiBuilder(owner)));

    expect(results[0]).not.toEqual(results[1]);

    const other = results[1]!;
    if (other.kind !== 'ready') {
      throw new Error('Expected ready');
    }

    await expect(openAiBuilder(owners[0]!, other.slug)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
