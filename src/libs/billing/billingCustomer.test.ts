/**
 * `billing_customer` resolution — the environment fence and the tenant fence.
 *
 * Run against real PostgreSQL semantics (PGlite + the committed migration
 * folder) rather than a mocked drizzle, because the two unique indexes from
 * migration 0078 ARE the design: a mocked insert could not demonstrate that a
 * `dev` row fails to satisfy a `prod` lookup, nor that a Stripe Customer
 * already mapped to another salon is refused by the database.
 *
 * Stripe is the only seam that is mocked; every assertion about "did we call
 * Stripe" is an assertion on that seam.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const envHolder = vi.hoisted(() => ({ BILLING_PLAN_ENV: 'test' as 'dev' | 'test' | 'prod' }));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

const stripeMock = vi.hoisted(() => ({
  customers: { retrieve: vi.fn(), create: vi.fn() },
}));
vi.mock('@/libs/stripe', () => ({ stripe: stripeMock }));

const sentryHolder = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => sentryHolder);

let db: ReturnType<typeof drizzle<typeof schema>>;

const billingCustomer = () => import('./billingCustomer');

async function seedSalon(id: string) {
  await db.insert(schema.salonSchema).values({ id, name: `Salon ${id}`, slug: `salon-${id}` });
}

async function seedSubscription(input: {
  id: string;
  salonId: string;
  stripeCustomerId: string;
  status: 'active' | 'canceled' | 'incomplete_expired' | 'past_due';
  updatedAt?: Date;
}) {
  await db.insert(schema.billingSubscriptionSchema).values({
    id: input.id,
    salonId: input.salonId,
    stripeSubscriptionId: `sub_${input.id}`,
    stripeCustomerId: input.stripeCustomerId,
    planDefinitionKey: 'starter',
    billingOfferKey: 'starter_2026_08_monthly',
    billingCadence: 'monthly',
    status: input.status,
    paidThrough: new Date('2030-02-01T00:00:00.000Z'),
    creditCycleAnchor: new Date('2030-01-01T00:00:00.000Z'),
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
  });
}

async function mappingRows(salonId: string) {
  return db
    .select()
    .from(schema.billingCustomerSchema)
    .where(eq(schema.billingCustomerSchema.salonId, salonId));
}

async function allMappings() {
  return db.select().from(schema.billingCustomerSchema);
}

async function auditRows(salonId: string) {
  return db
    .select()
    .from(schema.auditLogSchema)
    .where(eq(schema.auditLogSchema.salonId, salonId));
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  stripeMock.customers.retrieve.mockReset();
  stripeMock.customers.create.mockReset();
  sentryHolder.captureMessage.mockClear();
  sentryHolder.captureException.mockClear();
  envHolder.BILLING_PLAN_ENV = 'test';
  // computeExpectedLivemode reads the real process.env. Under Vitest the
  // runtime environment resolves to `test` (not live), so a test-mode secret
  // key makes both of its legs agree on livemode === false.
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_billing_customer_unit');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('APP_ENV', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('step 1 — an existing mapping short-circuits everything', () => {
  it('returns the row for this plan env and never touches Stripe', async () => {
    const { findBillingCustomer, resolveOrCreateBillingCustomer } = await billingCustomer();
    await seedSalon('s_hit');
    await db.insert(schema.billingCustomerSchema).values({
      id: 'bcus_hit',
      salonId: 's_hit',
      planEnv: 'test',
      stripeCustomerId: 'cus_hit',
      source: 'created',
    });

    await expect(findBillingCustomer(db, { salonId: 's_hit' })).resolves.toEqual({
      id: 'bcus_hit',
      salonId: 's_hit',
      planEnv: 'test',
      stripeCustomerId: 'cus_hit',
      source: 'created',
    });
    await expect(resolveOrCreateBillingCustomer({ salonId: 's_hit', email: null, name: null }))
      .resolves.toMatchObject({ stripeCustomerId: 'cus_hit' });

    expect(stripeMock.customers.retrieve).not.toHaveBeenCalled();
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
  });

  it('THE ENVIRONMENT FENCE: a dev row does not satisfy a prod lookup for the same salon', async () => {
    const { findBillingCustomer } = await billingCustomer();
    await seedSalon('s_fence');
    await db.insert(schema.billingCustomerSchema).values({
      id: 'bcus_fence_dev',
      salonId: 's_fence',
      planEnv: 'dev',
      stripeCustomerId: 'cus_fence_dev',
      source: 'created',
    });

    envHolder.BILLING_PLAN_ENV = 'dev';

    await expect(findBillingCustomer(db, { salonId: 's_fence' }))
      .resolves.toMatchObject({ stripeCustomerId: 'cus_fence_dev', planEnv: 'dev' });

    // The same salon, the same database, a live-mode deployment: the test-mode
    // customer is unreachable.
    envHolder.BILLING_PLAN_ENV = 'prod';

    await expect(findBillingCustomer(db, { salonId: 's_fence' })).resolves.toBeNull();
    expect(stripeMock.customers.retrieve).not.toHaveBeenCalled();
  });
});

describe('step 2 — adoption only from verified, environment-matching evidence', () => {
  it('adopts a livemode-matching subscription customer with one retrieve and no create', async () => {
    const { findBillingCustomer } = await billingCustomer();
    await seedSalon('s_adopt');
    await seedSubscription({
      id: 'bsub_adopt',
      salonId: 's_adopt',
      stripeCustomerId: 'cus_adopt',
      status: 'active',
    });
    stripeMock.customers.retrieve.mockResolvedValue({ id: 'cus_adopt', object: 'customer', livemode: false });

    const record = await findBillingCustomer(db, { salonId: 's_adopt' });

    expect(record).toMatchObject({ stripeCustomerId: 'cus_adopt', source: 'adopted_subscription', planEnv: 'test' });
    expect(stripeMock.customers.retrieve).toHaveBeenCalledTimes(1);
    expect(stripeMock.customers.retrieve).toHaveBeenCalledWith('cus_adopt');
    expect(stripeMock.customers.create).not.toHaveBeenCalled();

    const rows = await mappingRows('s_adopt');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stripeCustomerId: 'cus_adopt', source: 'adopted_subscription' });

    // Persisted: a second call is a step-1 hit and calls Stripe again zero times.
    stripeMock.customers.retrieve.mockClear();

    await expect(findBillingCustomer(db, { salonId: 's_adopt' }))
      .resolves.toMatchObject({ stripeCustomerId: 'cus_adopt' });
    expect(stripeMock.customers.retrieve).not.toHaveBeenCalled();
  });

  it('prefers a live subscription row over a canceled one', async () => {
    const { findBillingCustomer } = await billingCustomer();
    await seedSalon('s_pref');
    // The canceled row is the MOST RECENTLY updated, so a naive `updated_at`
    // ordering would pick it.
    await seedSubscription({
      id: 'bsub_pref_live',
      salonId: 's_pref',
      stripeCustomerId: 'cus_pref_live',
      status: 'active',
      updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    await seedSubscription({
      id: 'bsub_pref_dead',
      salonId: 's_pref',
      stripeCustomerId: 'cus_pref_dead',
      status: 'canceled',
      updatedAt: new Date('2030-06-01T00:00:00.000Z'),
    });
    stripeMock.customers.retrieve.mockResolvedValue({ id: 'cus_pref_live', object: 'customer', livemode: false });

    await expect(findBillingCustomer(db, { salonId: 's_pref' }))
      .resolves.toMatchObject({ stripeCustomerId: 'cus_pref_live' });
    expect(stripeMock.customers.retrieve).toHaveBeenCalledWith('cus_pref_live');
  });

  it('WRONG LIVEMODE on the read path: does not adopt, returns null, writes nothing', async () => {
    const { findBillingCustomer } = await billingCustomer();
    await seedSalon('s_mismatch_read');
    await seedSubscription({
      id: 'bsub_mismatch_read',
      salonId: 's_mismatch_read',
      stripeCustomerId: 'cus_live_mode',
      status: 'active',
    });
    // A live-mode customer id reaching a test-mode deployment through the
    // SHARED database — exactly what the owner's condition exists to stop.
    stripeMock.customers.retrieve.mockResolvedValue({ id: 'cus_live_mode', object: 'customer', livemode: true });

    await expect(findBillingCustomer(db, { salonId: 's_mismatch_read' })).resolves.toBeNull();

    expect(await mappingRows('s_mismatch_read')).toHaveLength(0);
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
    expect(sentryHolder.captureMessage).toHaveBeenCalledWith(
      'billing.customer_adoption_environment_mismatch',
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('WRONG LIVEMODE on the create path: creates a fresh customer instead of adopting', async () => {
    const { resolveOrCreateBillingCustomer } = await billingCustomer();
    await seedSalon('s_mismatch_create');
    await seedSubscription({
      id: 'bsub_mismatch_create',
      salonId: 's_mismatch_create',
      stripeCustomerId: 'cus_wrong_mode',
      status: 'active',
    });
    stripeMock.customers.retrieve.mockResolvedValue({ id: 'cus_wrong_mode', object: 'customer', livemode: true });
    stripeMock.customers.create.mockResolvedValue({ id: 'cus_fresh', object: 'customer', livemode: false });

    const record = await resolveOrCreateBillingCustomer({
      salonId: 's_mismatch_create',
      email: 'owner@example.test',
      name: 'Mismatch Salon',
    });

    expect(record).toMatchObject({ stripeCustomerId: 'cus_fresh', source: 'created' });
    expect(stripeMock.customers.create).toHaveBeenCalledTimes(1);

    const rows = await mappingRows('s_mismatch_create');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.stripeCustomerId).toBe('cus_fresh');
  });

  it('a DELETED Stripe customer carries no livemode and is never adopted', async () => {
    const { findBillingCustomer } = await billingCustomer();
    await seedSalon('s_deleted');
    await seedSubscription({
      id: 'bsub_deleted',
      salonId: 's_deleted',
      stripeCustomerId: 'cus_deleted',
      status: 'active',
    });
    stripeMock.customers.retrieve.mockResolvedValue({ id: 'cus_deleted', object: 'customer', deleted: true });

    await expect(findBillingCustomer(db, { salonId: 's_deleted' })).resolves.toBeNull();
    expect(await mappingRows('s_deleted')).toHaveLength(0);
  });

  it('a STRIPE FAILURE during verification throws and persists nothing', async () => {
    const { findBillingCustomer, resolveOrCreateBillingCustomer } = await billingCustomer();
    await seedSalon('s_stripe_down');
    await seedSubscription({
      id: 'bsub_stripe_down',
      salonId: 's_stripe_down',
      stripeCustomerId: 'cus_unverifiable',
      status: 'active',
    });
    stripeMock.customers.retrieve.mockRejectedValue(new Error('stripe unavailable'));

    await expect(findBillingCustomer(db, { salonId: 's_stripe_down' })).rejects.toThrow('stripe unavailable');
    await expect(resolveOrCreateBillingCustomer({ salonId: 's_stripe_down', email: null, name: null }))
      .rejects.toThrow('stripe unavailable');

    expect(await mappingRows('s_stripe_down')).toHaveLength(0);
    // Never adopt on unverified evidence, and never quietly mint a second
    // customer around the failure either.
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
  });

  it('an UNATTESTABLE environment fails closed with CUSTOMER_ENVIRONMENT_MISMATCH', async () => {
    const { findBillingCustomer, BillingCustomerError } = await billingCustomer();
    await seedSalon('s_indeterminate');
    await seedSubscription({
      id: 'bsub_indeterminate',
      salonId: 's_indeterminate',
      stripeCustomerId: 'cus_indeterminate',
      status: 'active',
    });
    // Markers say `test`, the key says live: computeExpectedLivemode is
    // indeterminate, so nothing about the candidate can be verified.
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_billing_customer_unit');

    await expect(findBillingCustomer(db, { salonId: 's_indeterminate' })).rejects.toMatchObject({
      name: 'BillingCustomerError',
      code: 'CUSTOMER_ENVIRONMENT_MISMATCH',
    });
    await expect(findBillingCustomer(db, { salonId: 's_indeterminate' }))
      .rejects.toBeInstanceOf(BillingCustomerError);

    expect(stripeMock.customers.retrieve).not.toHaveBeenCalled();
    expect(await mappingRows('s_indeterminate')).toHaveLength(0);
  });
});

describe('step 3 — create', () => {
  it('sends the exact metadata and idempotency key, and records source=created', async () => {
    const { resolveOrCreateBillingCustomer, buildBillingCustomerIdempotencyKey } = await billingCustomer();
    await seedSalon('s_create');
    stripeMock.customers.create.mockResolvedValue({ id: 'cus_created', object: 'customer', livemode: false });

    const record = await resolveOrCreateBillingCustomer({
      salonId: 's_create',
      email: 'owner@example.test',
      name: 'Create Salon',
    });

    expect(record).toMatchObject({ stripeCustomerId: 'cus_created', source: 'created', planEnv: 'test' });
    expect(record.id).toMatch(/^bcus_/);
    expect(stripeMock.customers.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.customers.create).toHaveBeenCalledWith(
      {
        email: 'owner@example.test',
        name: 'Create Salon',
        metadata: { purpose: 'luster_billing', salonId: 's_create', planEnv: 'test' },
      },
      { idempotencyKey: 'billing-customer:test:s_create:v1' },
    );
    expect(buildBillingCustomerIdempotencyKey({ planEnv: 'test', salonId: 's_create' }))
      .toBe('billing-customer:test:s_create:v1');
    expect(stripeMock.customers.retrieve).not.toHaveBeenCalled();
  });

  it('passes a null email and name through as absent rather than null', async () => {
    const { resolveOrCreateBillingCustomer } = await billingCustomer();
    await seedSalon('s_create_null');
    stripeMock.customers.create.mockResolvedValue({ id: 'cus_created_null', object: 'customer', livemode: false });

    await resolveOrCreateBillingCustomer({ salonId: 's_create_null', email: null, name: null });

    expect(stripeMock.customers.create).toHaveBeenCalledWith(
      {
        email: undefined,
        name: undefined,
        metadata: { purpose: 'luster_billing', salonId: 's_create_null', planEnv: 'test' },
      },
      { idempotencyKey: 'billing-customer:test:s_create_null:v1' },
    );
  });

  it('stamps the row with the deployment plan env, not a default', async () => {
    const { resolveOrCreateBillingCustomer } = await billingCustomer();
    await seedSalon('s_create_prod');
    envHolder.BILLING_PLAN_ENV = 'prod';
    stripeMock.customers.create.mockResolvedValue({ id: 'cus_created_prod', object: 'customer', livemode: true });

    const record = await resolveOrCreateBillingCustomer({ salonId: 's_create_prod', email: null, name: null });

    expect(record.planEnv).toBe('prod');
    expect(stripeMock.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ planEnv: 'prod' }) }),
      { idempotencyKey: 'billing-customer:prod:s_create_prod:v1' },
    );
  });

  it('writes the durable audit row exactly once, when the insert won', async () => {
    const { resolveOrCreateBillingCustomer } = await billingCustomer();
    await seedSalon('s_audit');
    stripeMock.customers.create.mockResolvedValue({ id: 'cus_audit', object: 'customer', livemode: false });

    await resolveOrCreateBillingCustomer({ salonId: 's_audit', email: null, name: null });
    // A second call is a step-1 hit: no second audit row.
    await resolveOrCreateBillingCustomer({ salonId: 's_audit', email: null, name: null });

    const rows = (await auditRows('s_audit')).filter(row => row.action === 'billing_customer_created');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toMatchObject({
      stripeCustomerId: 'cus_audit',
      source: 'created',
      planEnv: 'test',
    });
  });
});

describe('the tenant fence', () => {
  it('refuses a Stripe customer already mapped to ANOTHER salon and writes nothing', async () => {
    const { resolveOrCreateBillingCustomer, BillingCustomerError } = await billingCustomer();
    await seedSalon('s_owner');
    await seedSalon('s_thief');
    await db.insert(schema.billingCustomerSchema).values({
      id: 'bcus_owner',
      salonId: 's_owner',
      planEnv: 'test',
      stripeCustomerId: 'cus_shared',
      source: 'created',
    });
    // Stripe hands back a customer that is already somebody else's — an
    // idempotency-key collision, a hand-edited metadata, a mis-supplied id.
    stripeMock.customers.create.mockResolvedValue({ id: 'cus_shared', object: 'customer', livemode: false });

    await expect(resolveOrCreateBillingCustomer({ salonId: 's_thief', email: null, name: null }))
      .rejects.toMatchObject({ name: 'BillingCustomerError', code: 'CUSTOMER_TENANT_CONFLICT' });
    await expect(resolveOrCreateBillingCustomer({ salonId: 's_thief', email: null, name: null }))
      .rejects.toBeInstanceOf(BillingCustomerError);

    expect(await mappingRows('s_thief')).toHaveLength(0);
    // The rightful owner's row is untouched: never re-tenant, never overwrite.
    expect(await mappingRows('s_owner')).toHaveLength(1);
    expect((await mappingRows('s_owner'))[0]).toMatchObject({ id: 'bcus_owner', stripeCustomerId: 'cus_shared' });
  });

  it('refuses an adoption candidate that belongs to another salon', async () => {
    const { findBillingCustomer } = await billingCustomer();
    await seedSalon('s_owner2');
    await seedSalon('s_thief2');
    await db.insert(schema.billingCustomerSchema).values({
      id: 'bcus_owner2',
      salonId: 's_owner2',
      planEnv: 'test',
      stripeCustomerId: 'cus_shared2',
      source: 'created',
    });
    await seedSubscription({
      id: 'bsub_thief2',
      salonId: 's_thief2',
      stripeCustomerId: 'cus_shared2',
      status: 'active',
    });
    stripeMock.customers.retrieve.mockResolvedValue({ id: 'cus_shared2', object: 'customer', livemode: false });

    await expect(findBillingCustomer(db, { salonId: 's_thief2' }))
      .rejects.toMatchObject({ code: 'CUSTOMER_TENANT_CONFLICT' });

    expect(await mappingRows('s_thief2')).toHaveLength(0);
  });
});

describe('the read surface can never mint money', () => {
  it('findBillingCustomer never calls customers.create under any input', async () => {
    const { findBillingCustomer } = await billingCustomer();
    await seedSalon('s_readonly_none');
    await seedSalon('s_readonly_live');
    await seedSalon('s_readonly_mismatch');
    await seedSubscription({
      id: 'bsub_readonly_live',
      salonId: 's_readonly_live',
      stripeCustomerId: 'cus_readonly_live',
      status: 'active',
    });
    await seedSubscription({
      id: 'bsub_readonly_mismatch',
      salonId: 's_readonly_mismatch',
      stripeCustomerId: 'cus_readonly_mismatch',
      status: 'past_due',
    });
    stripeMock.customers.retrieve.mockImplementation(async (id: string) => (
      id === 'cus_readonly_live'
        ? { id, object: 'customer', livemode: false }
        : { id, object: 'customer', livemode: true }
    ));

    await expect(findBillingCustomer(db, { salonId: 's_readonly_none' })).resolves.toBeNull();
    await expect(findBillingCustomer(db, { salonId: 's_readonly_live' })).resolves.not.toBeNull();
    await expect(findBillingCustomer(db, { salonId: 's_readonly_mismatch' })).resolves.toBeNull();
    await expect(findBillingCustomer(db, { salonId: 's_absent_salon' })).resolves.toBeNull();

    expect(stripeMock.customers.create).not.toHaveBeenCalled();
  });

  it('never consults the legacy salon.stripeCustomerId column', async () => {
    const { findBillingCustomer, resolveOrCreateBillingCustomer } = await billingCustomer();
    await seedSalon('s_legacy');
    await db
      .update(schema.salonSchema)
      .set({ stripeCustomerId: 'cus_legacy_leak' })
      .where(eq(schema.salonSchema.id, 's_legacy'));
    stripeMock.customers.create.mockResolvedValue({ id: 'cus_newtrack', object: 'customer', livemode: false });

    // The legacy column is not new-track evidence: the read path sees nothing.
    await expect(findBillingCustomer(db, { salonId: 's_legacy' })).resolves.toBeNull();

    // And the create path mints a SEPARATE new-track customer, which the owner
    // has accepted, rather than adopting the legacy one.
    const record = await resolveOrCreateBillingCustomer({ salonId: 's_legacy', email: null, name: null });

    expect(record.stripeCustomerId).toBe('cus_newtrack');

    const rows = await allMappings();

    expect(rows.map(row => row.stripeCustomerId)).not.toContain('cus_legacy_leak');
  });

  it('does not even import the salon table (structural proof)', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/libs/billing/billingCustomer.ts'),
      'utf8',
    );
    const schemaImport = source.match(/import \{[^}]*\} from '@\/models\/Schema';/)?.[0];

    // The prose in this module's header discusses the legacy column on purpose,
    // so the proof is the IMPORT, not a mention.
    expect(schemaImport).toBeDefined();
    expect(schemaImport).not.toMatch(/salonSchema/);
  });
});
