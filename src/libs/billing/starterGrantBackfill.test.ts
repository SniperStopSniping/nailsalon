/**
 * P8a — PGlite proofs for the starter-grant backfill (G22, §7.3, §20 step 6).
 * Mirrors the mocking pattern in ./creditGrants.test.ts exactly: `server-only`,
 * `@/libs/DB` and `@/libs/Env` are mocked so `creditGrants.ts`'s (transitive)
 * `@/libs/DB` import and `businessIdentity.ts`'s `@/libs/Env` import never
 * attempt real environment validation.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const envHolder = vi.hoisted(() => ({
  BILLING_IDENTITY_HMAC_SECRET: undefined as string | undefined,
  BILLING_IDENTITY_HMAC_VERSION: undefined as number | undefined,
}));

vi.mock('@/libs/Env', () => ({ Env: envHolder }));

let db: ReturnType<typeof drizzle<typeof schema>>;

const backfill = () => import('./starterGrantBackfill');
const identity = () => import('./businessIdentity');
const grants = () => import('./creditGrants');

async function seedSalon(input: {
  id: string;
  slug: string;
  ownerClerkUserId?: string | null;
  ownerEmail?: string | null;
}) {
  await db.insert(schema.salonSchema).values({
    id: input.id,
    name: `Salon ${input.id}`,
    slug: input.slug,
    ownerClerkUserId: input.ownerClerkUserId ?? null,
    ownerEmail: input.ownerEmail ?? null,
  });
}

const auditRowsForEntity = (entityId: string) =>
  db.select().from(schema.auditLogSchema).where(eq(schema.auditLogSchema.entityId, entityId));

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

describe('planStarterGrantBackfill — read-only', () => {
  it('reports wouldGrant for a fresh salon and writes NOTHING (no identity, no link, no grant, no ledger row)', async () => {
    await seedSalon({
      id: 's_plan1',
      slug: 'plan-salon-1',
      ownerClerkUserId: 'user_plan1',
      ownerEmail: 'owner-plan1@example.com',
    });
    const { planStarterGrantBackfill } = await backfill();

    const identitiesBefore = await db.select().from(schema.billingBusinessIdentitySchema);
    const linksBefore = await db.select().from(schema.billingBusinessIdentityLinkSchema);
    const grantsBefore = await db.select().from(schema.billingStarterGrantSchema);
    const ledgerBefore = await db.select().from(schema.smsCreditLedgerSchema);

    const plan = await planStarterGrantBackfill(db, { salonSlug: 'plan-salon-1' });

    expect(plan).toEqual({
      salon: { id: 's_plan1', slug: 'plan-salon-1' },
      businessIdentityId: null,
      alreadyGranted: false,
      wouldGrant: true,
      credits: 100,
    });

    expect(await db.select().from(schema.billingBusinessIdentitySchema)).toHaveLength(identitiesBefore.length);
    expect(await db.select().from(schema.billingBusinessIdentityLinkSchema)).toHaveLength(linksBefore.length);
    expect(await db.select().from(schema.billingStarterGrantSchema)).toHaveLength(grantsBefore.length);
    expect(await db.select().from(schema.smsCreditLedgerSchema)).toHaveLength(ledgerBefore.length);
  });

  it('resolves an EXISTING business identity read-only when one already links the salon, still writing nothing', async () => {
    await seedSalon({ id: 's_plan2', slug: 'plan-salon-2', ownerClerkUserId: 'user_plan2' });
    const { resolveOrCreateBusinessIdentity } = await identity();
    const identityId = (await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_plan2', salonId: 's_plan2' }))).businessIdentityId;

    const linksBefore = await db.select().from(schema.billingBusinessIdentityLinkSchema);

    const { planStarterGrantBackfill } = await backfill();
    const plan = await planStarterGrantBackfill(db, { salonSlug: 'plan-salon-2' });

    expect(plan.businessIdentityId).toBe(identityId);
    expect(plan.alreadyGranted).toBe(false);
    expect(plan.wouldGrant).toBe(true);
    expect(await db.select().from(schema.billingBusinessIdentityLinkSchema)).toHaveLength(linksBefore.length);
  });

  it('throws SALON_NOT_FOUND for an unknown slug', async () => {
    const { planStarterGrantBackfill } = await backfill();

    await expect(planStarterGrantBackfill(db, { salonSlug: 'does-not-exist' }))
      .rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
  });

  it('refuses a soft-deleted salon', async () => {
    await seedSalon({ id: 's_plan_deleted', slug: 'plan-salon-deleted', ownerClerkUserId: 'user_plan_deleted' });
    await db.update(schema.salonSchema).set({ deletedAt: new Date() }).where(eq(schema.salonSchema.id, 's_plan_deleted'));

    const { planStarterGrantBackfill } = await backfill();

    await expect(planStarterGrantBackfill(db, { salonSlug: 'plan-salon-deleted' }))
      .rejects.toMatchObject({ code: 'SALON_DELETED' });
  });
});

describe('applyStarterGrantBackfill', () => {
  it('grants once — one billing_starter_grant row, one 100-credit starter ledger lot, one audit row; a second apply is a no-op', async () => {
    await seedSalon({
      id: 's_apply1',
      slug: 'apply-salon-1',
      ownerClerkUserId: 'user_apply1',
      ownerEmail: 'apply1@example.com',
    });
    const { applyStarterGrantBackfill, planStarterGrantBackfill } = await backfill();

    const first = await applyStarterGrantBackfill(db, { salonSlug: 'apply-salon-1', actorId: 'cli:test-operator' });

    expect(first.granted).toBe(true);
    expect(first.ledgerEvidence).toMatchObject({ credits: 100, bucket: 'starter' });

    const grantRows = await db.select().from(schema.billingStarterGrantSchema)
      .where(eq(schema.billingStarterGrantSchema.businessIdentityId, first.businessIdentityId));

    expect(grantRows).toHaveLength(1);
    expect(grantRows[0]).toMatchObject({ salonId: 's_apply1', credits: 100 });

    const lotRows = await db.select().from(schema.smsCreditLedgerSchema)
      .where(eq(schema.smsCreditLedgerSchema.id, first.ledgerEvidence!.lotId));

    expect(lotRows).toHaveLength(1);
    expect(lotRows[0]).toMatchObject({
      salonId: 's_apply1',
      bucket: 'starter',
      entryType: 'grant',
      amount: 100,
      idempotencyKey: `starter-grant:${first.businessIdentityId}`,
    });

    const auditRows = await auditRowsForEntity(first.businessIdentityId);
    const backfillAudit = auditRows.filter(row => row.action === 'billing_starter_grant_backfilled');

    expect(backfillAudit).toHaveLength(1);
    expect(backfillAudit[0]).toMatchObject({
      salonId: 's_apply1',
      actorType: 'super_admin',
      actorId: 'cli:test-operator',
      entityType: 'billing_starter_grant',
      entityId: first.businessIdentityId,
    });
    expect(backfillAudit[0]!.metadata).toMatchObject({
      salonSlug: 'apply-salon-1',
      credits: 100,
      lotId: first.ledgerEvidence!.lotId,
    });

    // Second apply: idempotent no-op — no new grant row, no new ledger lot, no new audit row.
    const second = await applyStarterGrantBackfill(db, { salonSlug: 'apply-salon-1', actorId: 'cli:test-operator-2' });

    expect(second).toEqual({
      granted: false,
      businessIdentityId: first.businessIdentityId,
      ledgerEvidence: null,
    });

    expect(await db.select().from(schema.billingStarterGrantSchema)
      .where(eq(schema.billingStarterGrantSchema.businessIdentityId, first.businessIdentityId))).toHaveLength(1);
    expect((await auditRowsForEntity(first.businessIdentityId))
      .filter(row => row.action === 'billing_starter_grant_backfilled')).toHaveLength(1);

    const planAfter = await planStarterGrantBackfill(db, { salonSlug: 'apply-salon-1' });

    expect(planAfter.alreadyGranted).toBe(true);
    expect(planAfter.wouldGrant).toBe(false);
  });

  it('a salon already granted via the LIVE onboarding call shape reports alreadyGranted and apply is a no-op writing no backfill audit row', async () => {
    await seedSalon({
      id: 's_onboard1',
      slug: 'onboard-salon-1',
      ownerClerkUserId: 'user_onboard1',
      ownerEmail: 'onboard1@example.com',
    });
    const { resolveOrCreateBusinessIdentity } = await identity();
    const { grantStarterCredits } = await grants();
    const identityId = await db.transaction(async (tx) => {
      const resolved = await resolveOrCreateBusinessIdentity(tx, {
        clerkUserId: 'user_onboard1',
        salonId: 's_onboard1',
        verifiedEmail: 'onboard1@example.com',
      });
      await grantStarterCredits(tx, { businessIdentityId: resolved.businessIdentityId, salonId: 's_onboard1' });
      return resolved.businessIdentityId;
    });

    const { planStarterGrantBackfill, applyStarterGrantBackfill } = await backfill();
    const plan = await planStarterGrantBackfill(db, { salonSlug: 'onboard-salon-1' });

    expect(plan.businessIdentityId).toBe(identityId);
    expect(plan.alreadyGranted).toBe(true);
    expect(plan.wouldGrant).toBe(false);

    const applied = await applyStarterGrantBackfill(db, { salonSlug: 'onboard-salon-1', actorId: 'cli:test-operator' });

    expect(applied).toEqual({ granted: false, businessIdentityId: identityId, ledgerEvidence: null });

    expect((await auditRowsForEntity(identityId))
      .filter(row => row.action === 'billing_starter_grant_backfilled')).toHaveLength(0);

    // Exactly one starter lot exists for this salon — the onboarding grant,
    // never doubled by the backfill attempt.
    const starterLots = await db.select().from(schema.smsCreditLedgerSchema)
      .where(eq(schema.smsCreditLedgerSchema.salonId, 's_onboard1'));

    expect(starterLots.filter(row => row.bucket === 'starter' && row.amount > 0)).toHaveLength(1);
  });

  it('throws SALON_NOT_FOUND for an unknown slug', async () => {
    const { applyStarterGrantBackfill } = await backfill();

    await expect(applyStarterGrantBackfill(db, { salonSlug: 'does-not-exist', actorId: 'cli:test' }))
      .rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
  });

  it('refuses a soft-deleted salon', async () => {
    await seedSalon({ id: 's_apply_deleted', slug: 'apply-salon-deleted', ownerClerkUserId: 'user_apply_deleted' });
    await db.update(schema.salonSchema).set({ deletedAt: new Date() }).where(eq(schema.salonSchema.id, 's_apply_deleted'));

    const { applyStarterGrantBackfill } = await backfill();

    await expect(applyStarterGrantBackfill(db, { salonSlug: 'apply-salon-deleted', actorId: 'cli:test' }))
      .rejects.toMatchObject({ code: 'SALON_DELETED' });
  });
});
