import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { customerPaymentFixtureMovementSchema as movements, customerPaymentFixtureReconciliationSchema as reconciliations } from '@/models/customerPaymentFixtureMovementSchema';
import * as schema from '@/models/Schema';

import { createProviderFixtureMovementApplication } from './applyProviderFixtureMovements';
import { addFixtureDispute, addFixtureRefund, createFixtureMovementGraph } from './fixtureMovementTestSupport';

vi.mock('server-only', () => ({}));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60000);

beforeEach(() => {
  for (const key of ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'CUSTOMER_PAYMENTS_FIXTURE_MOVEMENTS_ENABLED']) {
    vi.stubEnv(key, 'true');
  }
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
});

afterEach(() => vi.unstubAllEnvs());

afterAll(async () => client?.close());

describe('complete offline fixture cash movement reconciliation', () => {
  it('records zero-movement complete snapshot and replays it', async () => {
    const f = await createFixtureMovementGraph(database);
    const writer = createProviderFixtureMovementApplication(database);
    const first = await writer.reconcileMovements({ captureApplicationId: f.captureApplicationId });

    expect(first).toMatchObject({ state: 'applied', movementIds: [] });
    expect(await writer.reconcileMovements({ captureApplicationId: f.captureApplicationId })).toMatchObject({ state: 'replayed', reconciliationId: first.reconciliationId });
  });

  it.each(['customer_refund', 'application_fee_refund'] as const)('posts independent %s cash without allocation and replays', async (kind) => {
    const f = await createFixtureMovementGraph(database);
    const [before] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId));
    await addFixtureRefund(f, { kind });
    const writer = createProviderFixtureMovementApplication(database);
    const first = await writer.reconcileMovements({ captureApplicationId: f.captureApplicationId });

    expect(first).toMatchObject({ state: 'applied', reasons: [] });
    expect(first.movementIds).toHaveLength(1);

    const [row] = await database.select().from(movements).where(eq(movements.applicationId, f.captureApplicationId));

    expect(row).toMatchObject({ kind, source: 'offline_fixture_test', feeCents: null, netCents: null });

    const [after] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId));

    expect(after).toEqual(before);
    expect(await writer.reconcileMovements({ captureApplicationId: f.captureApplicationId })).toMatchObject({ state: 'replayed', movementIds: first.movementIds });
  });

  it('posts combined refund, independent fee and expanded dispute facts atomically', async () => {
    const f = await createFixtureMovementGraph(database);
    await addFixtureRefund(f);
    await addFixtureRefund(f, { kind: 'application_fee_refund' });
    await addFixtureDispute(f);
    const result = await createProviderFixtureMovementApplication(database).reconcileMovements({ captureApplicationId: f.captureApplicationId });

    expect(result).toMatchObject({ state: 'applied', reasons: [] });
    expect(result.movementIds).toHaveLength(3);

    const rows = await database.select().from(movements).where(eq(movements.applicationId, f.captureApplicationId));

    expect(rows.find(r => r.kind === 'dispute_withdrawal')).toMatchObject({ amountCents: -2000, feeCents: 1500, netCents: -3500 });
  });

  it('does not claim completeness or post any sibling when a successful refund has no operation', async () => {
    const f = await createFixtureMovementGraph(database);
    await addFixtureRefund(f);
    await addFixtureRefund(f, { withOperation: false });
    const result = await createProviderFixtureMovementApplication(database).reconcileMovements({ captureApplicationId: f.captureApplicationId });

    expect(result.state).toBe('held');
    expect(await database.select().from(movements).where(eq(movements.applicationId, f.captureApplicationId))).toHaveLength(0);
    expect(await database.select().from(reconciliations).where(eq(reconciliations.applicationId, f.captureApplicationId))).toHaveLength(0);
  });

  it('does not manufacture dispute cash from won status', async () => {
    const f = await createFixtureMovementGraph(database);
    await addFixtureDispute(f, { status: 'won', transactions: [] });
    const result = await createProviderFixtureMovementApplication(database).reconcileMovements({ captureApplicationId: f.captureApplicationId });

    expect(result.movementIds).toEqual([]);
    expect(await database.select().from(movements).where(eq(movements.applicationId, f.captureApplicationId))).toHaveLength(0);
  });
});
