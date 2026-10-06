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
  BILLING_STARTER_IDENTITY_READY: undefined as string | undefined,
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

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  identitySpy.signals = [];
  envHolder.BILLING_STARTER_IDENTITY_READY = undefined;
  // Default for the pre-existing suite: no HMAC secret, exactly as before.
  envHolder.BILLING_IDENTITY_HMAC_SECRET = undefined;
  envHolder.BILLING_IDENTITY_HMAC_VERSION = undefined;
});

let counter = 0;
async function eligibleSalon() {
  counter++;
  envHolder.BILLING_IDENTITY_HMAC_SECRET = 'disposable-test-identity-key';
  envHolder.BILLING_IDENTITY_HMAC_VERSION = 1;
  envHolder.BILLING_STARTER_IDENTITY_READY = 'true';
  const salonId = `eligible_${counter}`;
  const email = `${salonId}@example.com`;
  const phone = `+1416555${String(counter).padStart(4, '0')}`;
  await seedSalon({ id: salonId, slug: salonId, ownerClerkUserId: salonId });
  await seedOwner({ adminId: `admin_${salonId}`, salonId, clerkUserId: salonId, email, emailVerifiedAt: new Date() });
  const { resolveOrCreateBusinessIdentity } = await identity();
  const result = await db.transaction(tx => resolveOrCreateBusinessIdentity(tx, { salonId, clerkUserId: salonId, verifiedEmail: email, verifiedPhone: phone }));
  return { salonId, email, phone, businessIdentityId: result.businessIdentityId };
}

describe('free model migration', () => {
  it('rehearses without writes and grants 50 non-expiring credits once with audit evidence', async () => {
    const { salonId } = await eligibleSalon();
    const { planStarterGrantBackfill, applyStarterGrantBackfill } = await backfill();

    expect(await planStarterGrantBackfill(db, { salonSlug: salonId })).toMatchObject({ wouldGrant: true, credits: 50, heldReason: null });
    expect(await db.select().from(schema.smsCreditAccountSchema).where(eq(schema.smsCreditAccountSchema.salonId, salonId))).toEqual([]);

    const first = await applyStarterGrantBackfill(db, { salonSlug: salonId, actorId: 'qa' });

    expect(first).toMatchObject({ granted: true, ledgerEvidence: { credits: 50, bucket: 'starter' } });
    expect(await applyStarterGrantBackfill(db, { salonSlug: salonId, actorId: 'qa' })).toMatchObject({ granted: false });
    expect(await db.select().from(schema.smsCreditLedgerSchema).where(eq(schema.smsCreditLedgerSchema.salonId, salonId))).toMatchObject([{ amount: 50, expiresAt: null }]);
    expect(await db.select().from(schema.auditLogSchema).where(eq(schema.auditLogSchema.salonId, salonId))).toHaveLength(1);
  });

  it('preserves a historical 100-credit grant even while new identity claims are disabled', async () => {
    const { salonId, businessIdentityId } = await eligibleSalon();
    const { lockCreditAccount, appendLotGrant } = await import('./creditLedger');
    await db.transaction(async (tx) => {
      await lockCreditAccount(tx, salonId);
      const { lotId } = await appendLotGrant(tx, { salonId, bucket: 'starter', amount: 100, expiresAt: null, idempotencyKey: `historical:${salonId}`, reason: 'starter_grant' });
      await tx.insert(schema.billingStarterGrantSchema).values({ id: `old_${salonId}`, businessIdentityId, salonId, credits: 100, ledgerId: lotId });
    });
    envHolder.BILLING_STARTER_IDENTITY_READY = undefined;
    const { applyStarterGrantBackfill } = await backfill();

    expect(await applyStarterGrantBackfill(db, { salonSlug: salonId, actorId: 'qa' })).toMatchObject({ granted: false });
    expect(await db.select().from(schema.smsCreditLedgerSchema).where(eq(schema.smsCreditLedgerSchema.salonId, salonId))).toMatchObject([{ amount: 100 }]);
  });

  it('holds unverified salons and never treats owner_email as verified evidence', async () => {
    const { salonId } = await eligibleSalon();
    const other = `${salonId}_unverified`;
    await seedSalon({ id: other, slug: other, ownerEmail: 'unverified@example.com' });
    const { planStarterGrantBackfill, applyStarterGrantBackfill } = await backfill();

    expect(await planStarterGrantBackfill(db, { salonSlug: other })).toMatchObject({ wouldGrant: false, heldReason: 'CONTACT_VERIFICATION_REQUIRED' });
    await expect(applyStarterGrantBackfill(db, { salonSlug: other, actorId: 'qa' })).rejects.toMatchObject({ code: 'CONTACT_VERIFICATION_REQUIRED' });
    expect(identitySpy.signals.at(-1)).toMatchObject({ verifiedEmail: null });
    expect(await db.select().from(schema.smsCreditLedgerSchema).where(eq(schema.smsCreditLedgerSchema.salonId, other))).toEqual([]);
  });

  it('reports the same readiness hold during rehearsal and application', async () => {
    const { salonId } = await eligibleSalon();
    envHolder.BILLING_STARTER_IDENTITY_READY = undefined;
    const { planStarterGrantBackfill, applyStarterGrantBackfill } = await backfill();

    expect(await planStarterGrantBackfill(db, { salonSlug: salonId })).toMatchObject({ wouldGrant: false, heldReason: 'IDENTITY_SETUP_REQUIRED' });
    await expect(applyStarterGrantBackfill(db, { salonSlug: salonId, actorId: 'qa' })).rejects.toMatchObject({ code: 'IDENTITY_SETUP_REQUIRED' });
  });

  it('does not give a shared identity another allowance after recreation', async () => {
    const { salonId, email, phone } = await eligibleSalon();
    const { applyStarterGrantBackfill } = await backfill();
    await applyStarterGrantBackfill(db, { salonSlug: salonId, actorId: 'qa' });
    const recreated = `${salonId}_recreated`;
    await seedSalon({ id: recreated, slug: recreated });
    const { resolveOrCreateBusinessIdentity } = await identity();
    await db.transaction(tx => resolveOrCreateBusinessIdentity(tx, { salonId: recreated, verifiedEmail: email, verifiedPhone: phone }));

    expect(await applyStarterGrantBackfill(db, { salonSlug: recreated, actorId: 'qa' })).toMatchObject({ granted: false });
    expect(await db.select().from(schema.smsCreditLedgerSchema).where(eq(schema.smsCreditLedgerSchema.salonId, recreated))).toEqual([]);
  });

  it('holds conflicting identity evidence without writes', async () => {
    const { salonId } = await eligibleSalon();
    const conflicting = `${salonId}_conflict`;
    await seedSalon({ id: conflicting, slug: conflicting, ownerClerkUserId: salonId });
    const { resolveOrCreateBusinessIdentity } = await identity();
    await db.transaction(tx => resolveOrCreateBusinessIdentity(tx, { salonId: conflicting }));
    const { applyStarterGrantBackfill, planStarterGrantBackfill } = await backfill();

    await expect(planStarterGrantBackfill(db, { salonSlug: conflicting })).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' });
    await expect(applyStarterGrantBackfill(db, { salonSlug: conflicting, actorId: 'qa' })).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' });
    expect(await db.select().from(schema.smsCreditAccountSchema).where(eq(schema.smsCreditAccountSchema.salonId, conflicting))).toEqual([]);
  });
});
