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
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

// Y9: records every `resolveOrCreateBusinessIdentity` call's SIGNALS while
// still running the real implementation against PGlite, so the tests can
// assert both what the backfill passed and what it actually wrote.
const identitySpy = vi.hoisted(() => ({ signals: [] as Record<string, unknown>[] }));
vi.mock('./businessIdentity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./businessIdentity')>();
  return {
    ...actual,
    resolveOrCreateBusinessIdentity: async (
      tx: Parameters<typeof actual.resolveOrCreateBusinessIdentity>[0],
      signals: Parameters<typeof actual.resolveOrCreateBusinessIdentity>[1],
    ) => {
      identitySpy.signals.push({ ...signals });
      return actual.resolveOrCreateBusinessIdentity(tx, signals);
    },
  };
});

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

/**
 * Y9: the owner's `admin_user` row plus its `owner` membership. The
 * `emailVerifiedAt` argument is the ONLY thing that makes the address a
 * verified one — `admin_user.email_verified_at` (`Schema.ts:2065`).
 */
let ownerPhoneCounter = 1_000_000;
async function seedOwner(input: {
  adminId: string;
  salonId: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  clerkUserId?: string | null;
  role?: string;
}) {
  ownerPhoneCounter += 1;
  await db.insert(schema.adminUserSchema).values({
    id: input.adminId,
    phoneE164: `+1555${ownerPhoneCounter}`,
    clerkUserId: input.clerkUserId ?? null,
    name: `Owner ${input.adminId}`,
    email: input.email,
    emailVerifiedAt: input.emailVerifiedAt,
  });
  await db.insert(schema.adminSalonMembershipSchema).values({
    adminId: input.adminId,
    salonId: input.salonId,
    role: input.role ?? 'owner',
  });
}

const auditRowsForEntity = (entityId: string) =>
  db.select().from(schema.auditLogSchema).where(eq(schema.auditLogSchema.entityId, entityId));

const linksFor = (businessIdentityId: string) =>
  db.select().from(schema.billingBusinessIdentityLinkSchema)
    .where(eq(schema.billingBusinessIdentityLinkSchema.businessIdentityId, businessIdentityId));

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  identitySpy.signals = [];
  // Default for the pre-existing suite: no HMAC secret, exactly as before.
  envHolder.BILLING_IDENTITY_HMAC_SECRET = undefined;
  envHolder.BILLING_IDENTITY_HMAC_VERSION = undefined;
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

/**
 * Y9 (final handoff §6.2) — an UNVERIFIED `salon.owner_email` must never
 * become a durable `email_hmac` identity link.
 *
 * These tests configure the HMAC secret (`BILLING_IDENTITY_HMAC_SECRET` /
 * `_VERSION`), which is unset in every environment today and is exactly what
 * makes the defect unreachable in production right now — with it unset,
 * `computeEmailFingerprint` fail-closes to null and no email link is ever
 * built. The suite sets it precisely so the regression is provable.
 */
describe('Y9 — verified-email gating of the identity signal', () => {
  beforeEach(() => {
    envHolder.BILLING_IDENTITY_HMAC_SECRET = 'y9_test_identity_secret';
    envHolder.BILLING_IDENTITY_HMAC_VERSION = 1;
  });

  it('passes verifiedEmail: null when the owner\'s admin_user row has NO verified email, and still grants', async () => {
    await seedSalon({
      id: 's_y9_unverified',
      slug: 'y9-unverified',
      ownerClerkUserId: 'user_y9_unverified',
      ownerEmail: 'shared-unverified@example.com',
    });
    await seedOwner({
      adminId: 'au_y9_unverified',
      salonId: 's_y9_unverified',
      clerkUserId: 'user_y9_unverified',
      email: 'shared-unverified@example.com',
      emailVerifiedAt: null,
    });

    const { applyStarterGrantBackfill } = await backfill();
    const result = await applyStarterGrantBackfill(db, {
      salonSlug: 'y9-unverified',
      actorId: 'cli:y9',
    });

    expect(identitySpy.signals).toHaveLength(1);
    expect(identitySpy.signals[0]).toEqual({
      clerkUserId: 'user_y9_unverified',
      salonId: 's_y9_unverified',
      stripeCustomerId: null,
      verifiedEmail: null,
    });

    // The grant still applies — the clerk_user/salon signals carry it.
    expect(result.granted).toBe(true);

    const linkTypes = (await linksFor(result.businessIdentityId)).map(row => row.linkType).sort();

    expect(linkTypes).toEqual(['clerk_user', 'salon']);
    expect(linkTypes).not.toContain('email_hmac');
  });

  it('passes the owner\'s VERIFIED admin_user email through unchanged, and builds the email_hmac link', async () => {
    await seedSalon({
      id: 's_y9_verified',
      slug: 'y9-verified',
      ownerClerkUserId: 'user_y9_verified',
      ownerEmail: 'stale-contact@example.com',
    });
    await seedOwner({
      adminId: 'au_y9_verified',
      salonId: 's_y9_verified',
      clerkUserId: 'user_y9_verified',
      email: 'verified-owner@example.com',
      emailVerifiedAt: new Date('2026-01-02T03:04:05.000Z'),
    });

    const { applyStarterGrantBackfill } = await backfill();
    const result = await applyStarterGrantBackfill(db, {
      salonSlug: 'y9-verified',
      actorId: 'cli:y9',
    });

    expect(identitySpy.signals).toHaveLength(1);
    // The VERIFIED admin_user address — never the salon's free-text column.
    expect(identitySpy.signals[0]).toMatchObject({ verifiedEmail: 'verified-owner@example.com' });
    expect(result.granted).toBe(true);

    const { computeEmailFingerprint } = await identity();
    const expected = computeEmailFingerprint('verified-owner@example.com');
    const emailLinks = (await linksFor(result.businessIdentityId))
      .filter(row => row.linkType === 'email_hmac');

    expect(emailLinks).toHaveLength(1);
    expect(emailLinks[0]).toMatchObject({ linkValue: expected!.digest, hmacKeyVersion: 1 });

    // The stale salon.owner_email was never fingerprinted into a link.
    const staleFingerprint = computeEmailFingerprint('stale-contact@example.com');
    const staleLinks = await db.select().from(schema.billingBusinessIdentityLinkSchema)
      .where(eq(schema.billingBusinessIdentityLinkSchema.linkValue, staleFingerprint!.digest));

    expect(staleLinks).toHaveLength(0);
  });

  it('REGRESSION: two salons sharing an UNVERIFIED owner email resolve to SEPARATE identities and each grant applies exactly once', async () => {
    const sharedEmail = 'two-salons-one-mailbox@example.com';
    await seedSalon({
      id: 's_y9_shared_a',
      slug: 'y9-shared-a',
      ownerClerkUserId: 'user_y9_shared_a',
      ownerEmail: sharedEmail,
    });
    await seedOwner({
      adminId: 'au_y9_shared_a',
      salonId: 's_y9_shared_a',
      clerkUserId: 'user_y9_shared_a',
      email: null,
      emailVerifiedAt: null,
    });
    await seedSalon({
      id: 's_y9_shared_b',
      slug: 'y9-shared-b',
      ownerClerkUserId: 'user_y9_shared_b',
      ownerEmail: sharedEmail,
    });
    await seedOwner({
      adminId: 'au_y9_shared_b',
      salonId: 's_y9_shared_b',
      clerkUserId: 'user_y9_shared_b',
      email: null,
      emailVerifiedAt: null,
    });

    const { applyStarterGrantBackfill } = await backfill();
    const a = await applyStarterGrantBackfill(db, { salonSlug: 'y9-shared-a', actorId: 'cli:y9' });
    const b = await applyStarterGrantBackfill(db, { salonSlug: 'y9-shared-b', actorId: 'cli:y9' });

    // Before the fix both calls linked `email_hmac(sharedEmail)`, the second
    // resolved to the FIRST salon's identity, and its grant silently
    // reported granted: false.
    expect(a.businessIdentityId).not.toBe(b.businessIdentityId);
    expect(a.granted).toBe(true);
    expect(b.granted).toBe(true);

    for (const salonId of ['s_y9_shared_a', 's_y9_shared_b']) {
      const lots = await db.select().from(schema.smsCreditLedgerSchema)
        .where(eq(schema.smsCreditLedgerSchema.salonId, salonId));

      expect(lots.filter(row => row.bucket === 'starter' && row.amount > 0)).toHaveLength(1);
    }

    const sharedDigest = (await identity()).computeEmailFingerprint(sharedEmail)!.digest;
    const sharedLinks = await db.select().from(schema.billingBusinessIdentityLinkSchema)
      .where(eq(schema.billingBusinessIdentityLinkSchema.linkValue, sharedDigest));

    expect(sharedLinks).toHaveLength(0);
  });

  it('finds the verified email through the owner MEMBERSHIP when the salon has no owner_clerk_user_id (legacy salon)', async () => {
    await seedSalon({
      id: 's_y9_legacy',
      slug: 'y9-legacy',
      ownerClerkUserId: null,
      ownerEmail: 'legacy-contact@example.com',
    });
    await seedOwner({
      adminId: 'au_y9_legacy',
      salonId: 's_y9_legacy',
      clerkUserId: null,
      email: 'legacy-verified@example.com',
      emailVerifiedAt: new Date('2025-06-01T00:00:00.000Z'),
    });

    const { applyStarterGrantBackfill } = await backfill();
    const result = await applyStarterGrantBackfill(db, { salonSlug: 'y9-legacy', actorId: 'cli:y9' });

    expect(identitySpy.signals[0]).toMatchObject({
      clerkUserId: null,
      salonId: 's_y9_legacy',
      verifiedEmail: 'legacy-verified@example.com',
    });
    expect(result.granted).toBe(true);
  });

  it('ignores a NON-owner membership: an admin member\'s verified email is not the business identity', async () => {
    await seedSalon({
      id: 's_y9_member',
      slug: 'y9-member',
      ownerClerkUserId: null,
      ownerEmail: 'member-contact@example.com',
    });
    await seedOwner({
      adminId: 'au_y9_member',
      salonId: 's_y9_member',
      clerkUserId: null,
      email: 'staff-verified@example.com',
      emailVerifiedAt: new Date('2025-06-01T00:00:00.000Z'),
      role: 'admin',
    });

    const { applyStarterGrantBackfill } = await backfill();
    const result = await applyStarterGrantBackfill(db, { salonSlug: 'y9-member', actorId: 'cli:y9' });

    expect(identitySpy.signals[0]).toMatchObject({ verifiedEmail: null });
    expect(result.granted).toBe(true);
  });

  it('plan mode resolves through the same verified-email signal — an unverified shared address never resolves another salon\'s identity', async () => {
    const sharedEmail = 'plan-shared@example.com';
    await seedSalon({
      id: 's_y9_plan_owner',
      slug: 'y9-plan-owner',
      ownerClerkUserId: 'user_y9_plan_owner',
      ownerEmail: sharedEmail,
    });
    await seedOwner({
      adminId: 'au_y9_plan_owner',
      salonId: 's_y9_plan_owner',
      clerkUserId: 'user_y9_plan_owner',
      email: sharedEmail,
      emailVerifiedAt: new Date('2026-02-02T00:00:00.000Z'),
    });

    const { applyStarterGrantBackfill, planStarterGrantBackfill } = await backfill();
    const granted = await applyStarterGrantBackfill(db, {
      salonSlug: 'y9-plan-owner',
      actorId: 'cli:y9',
    });

    expect(granted.granted).toBe(true);

    // A SECOND, unrelated salon whose free-text owner_email happens to match
    // the first salon's VERIFIED address, but whose own owner has no
    // verified email.
    await seedSalon({
      id: 's_y9_plan_other',
      slug: 'y9-plan-other',
      ownerClerkUserId: 'user_y9_plan_other',
      ownerEmail: sharedEmail,
    });
    await seedOwner({
      adminId: 'au_y9_plan_other',
      salonId: 's_y9_plan_other',
      clerkUserId: 'user_y9_plan_other',
      email: null,
      emailVerifiedAt: null,
    });

    const plan = await planStarterGrantBackfill(db, { salonSlug: 'y9-plan-other' });

    expect(plan.businessIdentityId).toBeNull();
    expect(plan.alreadyGranted).toBe(false);
    expect(plan.wouldGrant).toBe(true);
  });

  it('propagates IDENTITY_CONFLICT and rolls the whole backfill back — no grant, no ledger lot, no audit row', async () => {
    await seedSalon({
      id: 's_y9_conflict',
      slug: 'y9-conflict',
      ownerClerkUserId: 'user_y9_conflict',
      ownerEmail: 'conflict@example.com',
    });
    await seedOwner({
      adminId: 'au_y9_conflict',
      salonId: 's_y9_conflict',
      clerkUserId: 'user_y9_conflict',
      email: null,
      emailVerifiedAt: null,
    });

    // Two DIFFERENT pre-existing identities, one holding the clerk_user
    // link and one holding the salon link.
    const { resolveOrCreateBusinessIdentity } = await identity();
    await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_y9_conflict' }));
    await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { salonId: 's_y9_conflict' }));

    const { applyStarterGrantBackfill } = await backfill();

    await expect(applyStarterGrantBackfill(db, { salonSlug: 'y9-conflict', actorId: 'cli:y9' }))
      .rejects.toMatchObject({ name: 'BusinessIdentityError', code: 'IDENTITY_CONFLICT' });

    const grants = await db.select().from(schema.billingStarterGrantSchema)
      .where(eq(schema.billingStarterGrantSchema.salonId, 's_y9_conflict'));

    expect(grants).toHaveLength(0);

    const lots = await db.select().from(schema.smsCreditLedgerSchema)
      .where(eq(schema.smsCreditLedgerSchema.salonId, 's_y9_conflict'));

    expect(lots).toHaveLength(0);

    const audits = await db.select().from(schema.auditLogSchema)
      .where(eq(schema.auditLogSchema.salonId, 's_y9_conflict'));

    expect(audits.filter(row => row.action === 'billing_starter_grant_backfilled')).toHaveLength(0);
  });
});
