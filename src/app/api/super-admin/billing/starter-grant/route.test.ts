/**
 * P8a super-admin starter-grant endpoint — PGlite proofs against real
 * migrations, mirroring the auth-mocking pattern in
 * `src/app/api/super-admin/organizations/[id]/route.deposit-entitlement.integration.test.ts`
 * (mock `server-only` + `@/libs/DB` via a holder pointing at a PGlite
 * instance, mock the super-admin guard) plus the `@/libs/Env` mock
 * `src/libs/billing/starterGrantBackfill.test.ts` uses (transitively needed
 * by `businessIdentity.ts`'s HMAC fingerprint fallback).
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

const guard = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
}));
vi.mock('@/libs/adminAuth', () => ({ requireSuperAdmin: guard.requireSuperAdmin }));

type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

const rateLimit = vi.hoisted(() => ({
  checkEndpointRateLimit: vi.fn((): RateLimitDecision => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
  rateLimitResponse: vi.fn((retryAfterMs: number) =>
    Response.json({ error: { code: 'RATE_LIMIT_EXCEEDED', retryAfterMs } }, { status: 429 })),
}));
vi.mock('@/libs/rateLimit', () => rateLimit);

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

const { POST } = await import('./route');
const Sentry = await import('@sentry/nextjs');

type Db = ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let db: Db;

const SUPER_ADMIN = { ok: true as const, admin: { id: 'sa_starter_grant_1', email: 'super@luster.test' } };

function post(body: unknown): Promise<Response> {
  return POST(new Request('http://localhost/api/super-admin/billing/starter-grant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

async function seedSalon(input: {
  id: string;
  slug: string;
  ownerClerkUserId?: string | null;
  ownerEmail?: string | null;
  deletedAt?: Date | null;
}) {
  await db.insert(schema.salonSchema).values({
    id: input.id,
    name: `Salon ${input.id}`,
    slug: input.slug,
    ownerClerkUserId: input.ownerClerkUserId ?? null,
    ownerEmail: input.ownerEmail ?? null,
    deletedAt: input.deletedAt ?? null,
  });
}

async function rowCounts() {
  return {
    identities: (await db.select().from(schema.billingBusinessIdentitySchema)).length,
    links: (await db.select().from(schema.billingBusinessIdentityLinkSchema)).length,
    grants: (await db.select().from(schema.billingStarterGrantSchema)).length,
    ledgerRows: (await db.select().from(schema.smsCreditLedgerSchema)).length,
    auditRows: (await db.select().from(schema.auditLogSchema)).length,
  };
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  vi.clearAllMocks();
  guard.requireSuperAdmin.mockResolvedValue(SUPER_ADMIN);
  rateLimit.checkEndpointRateLimit.mockReturnValue({ allowed: true });
});

describe('POST /api/super-admin/billing/starter-grant — auth', () => {
  it('401s when there is no admin session, before any body parsing or write', async () => {
    guard.requireSuperAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    await seedSalon({ id: 's_auth_401', slug: 'auth-401', ownerClerkUserId: 'user_auth_401' });
    const before = await rowCounts();

    const response = await post({ salonSlug: 'auth-401', mode: 'plan' });

    expect(response.status).toBe(401);
    expect(await rowCounts()).toEqual(before);
  });

  it('403s when the session is an admin but not a super-admin, before any write', async () => {
    guard.requireSuperAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });
    await seedSalon({ id: 's_auth_403', slug: 'auth-403', ownerClerkUserId: 'user_auth_403' });
    const before = await rowCounts();

    const response = await post({ salonSlug: 'auth-403', mode: 'apply', confirmation: 'auth-403' });

    expect(response.status).toBe(403);
    expect(await rowCounts()).toEqual(before);
  });
});

describe('POST /api/super-admin/billing/starter-grant — plan', () => {
  it('reports the plan and writes NOTHING', async () => {
    await seedSalon({
      id: 's_plan_route',
      slug: 'plan-route-salon',
      ownerClerkUserId: 'user_plan_route',
      ownerEmail: 'plan-route@example.com',
    });
    const before = await rowCounts();

    const response = await post({ salonSlug: 'plan-route-salon', mode: 'plan' });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      salon: { id: 's_plan_route', slug: 'plan-route-salon' },
      businessIdentityId: null,
      alreadyGranted: false,
      wouldGrant: true,
      credits: 100,
    });
    expect(await rowCounts()).toEqual(before);
  });

  it('404s for an unknown slug', async () => {
    const before = await rowCounts();

    const response = await post({ salonSlug: 'does-not-exist', mode: 'plan' });
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error.code).toBe('SALON_NOT_FOUND');
    expect(await rowCounts()).toEqual(before);
  });

  it('409s for a soft-deleted salon', async () => {
    await seedSalon({
      id: 's_plan_deleted_route',
      slug: 'plan-deleted-route',
      ownerClerkUserId: 'user_plan_deleted_route',
      deletedAt: new Date(),
    });
    const before = await rowCounts();

    const response = await post({ salonSlug: 'plan-deleted-route', mode: 'plan' });
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error.code).toBe('SALON_DELETED');
    expect(await rowCounts()).toEqual(before);
  });
});

describe('POST /api/super-admin/billing/starter-grant — apply', () => {
  it('requires confirmation to exactly match salonSlug, and writes nothing on mismatch', async () => {
    await seedSalon({
      id: 's_apply_confirm',
      slug: 'apply-confirm-salon',
      ownerClerkUserId: 'user_apply_confirm',
    });
    const before = await rowCounts();

    const missing = await post({ salonSlug: 'apply-confirm-salon', mode: 'apply' });

    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe('CONFIRMATION_REQUIRED');

    const wrong = await post({ salonSlug: 'apply-confirm-salon', mode: 'apply', confirmation: 'not-the-slug' });

    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.code).toBe('CONFIRMATION_REQUIRED');

    expect(await rowCounts()).toEqual(before);
  });

  it('grants once with matching confirmation — one grant row, one 100-credit starter lot, one audit row (actor super_admin); a second apply is a no-op', async () => {
    await seedSalon({
      id: 's_apply_route',
      slug: 'apply-route-salon',
      ownerClerkUserId: 'user_apply_route',
      ownerEmail: 'apply-route@example.com',
    });

    const first = await post({ salonSlug: 'apply-route-salon', mode: 'apply', confirmation: 'apply-route-salon' });
    const firstJson = await first.json();

    expect(first.status).toBe(200);
    expect(firstJson.granted).toBe(true);
    expect(firstJson.ledgerEvidence).toMatchObject({ credits: 100, bucket: 'starter' });

    const businessIdentityId = firstJson.businessIdentityId as string;

    const grantRows = await db.select().from(schema.billingStarterGrantSchema)
      .where(eq(schema.billingStarterGrantSchema.businessIdentityId, businessIdentityId));

    expect(grantRows).toHaveLength(1);
    expect(grantRows[0]).toMatchObject({ salonId: 's_apply_route', credits: 100 });

    const lotRows = await db.select().from(schema.smsCreditLedgerSchema)
      .where(eq(schema.smsCreditLedgerSchema.id, firstJson.ledgerEvidence.lotId));

    expect(lotRows).toHaveLength(1);
    expect(lotRows[0]).toMatchObject({ salonId: 's_apply_route', bucket: 'starter', entryType: 'grant', amount: 100 });

    const auditRows = await db.select().from(schema.auditLogSchema)
      .where(eq(schema.auditLogSchema.action, 'billing_starter_grant_backfilled'));
    const auditForIdentity = auditRows.filter(row => row.entityId === businessIdentityId);

    expect(auditForIdentity).toHaveLength(1);
    expect(auditForIdentity[0]).toMatchObject({
      salonId: 's_apply_route',
      actorType: 'super_admin',
      actorId: SUPER_ADMIN.admin.id,
      entityType: 'billing_starter_grant',
    });

    const before = await rowCounts();
    const second = await post({ salonSlug: 'apply-route-salon', mode: 'apply', confirmation: 'apply-route-salon' });
    const secondJson = await second.json();

    expect(second.status).toBe(200);
    expect(secondJson).toEqual({ granted: false, businessIdentityId, ledgerEvidence: null });
    expect(await rowCounts()).toEqual(before);
  });

  it('404s for an unknown slug on apply too, without a Sentry capture', async () => {
    const before = await rowCounts();

    const response = await post({ salonSlug: 'no-such-salon', mode: 'apply', confirmation: 'no-such-salon' });

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('SALON_NOT_FOUND');
    expect(await rowCounts()).toEqual(before);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe('POST /api/super-admin/billing/starter-grant — input validation', () => {
  it('400s invalid JSON', async () => {
    const response = await POST(new Request('http://localhost/api/super-admin/billing/starter-grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    }));

    expect(response.status).toBe(400);
  });

  it('400s a missing salonSlug or an invalid mode', async () => {
    expect((await post({ mode: 'plan' })).status).toBe(400);
    expect((await post({ salonSlug: 'x', mode: 'delete' })).status).toBe(400);
  });

  it('rate-limits before touching the database', async () => {
    rateLimit.checkEndpointRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 5000 });

    const response = await post({ salonSlug: 'whatever', mode: 'plan' });

    expect(response.status).toBe(429);
    expect(rateLimit.rateLimitResponse).toHaveBeenCalledWith(5000);
  });
});
