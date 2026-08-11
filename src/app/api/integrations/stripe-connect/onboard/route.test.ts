/**
 * Onboard route: tenancy, exposure and fail-closed config
 * (charter tests 9, 22 (config legs), 33).
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  admin: {
    id: 'admin_1',
    isSuperAdmin: false,
    salons: [{ salonId: 'salon_onboard_a' }],
  } as { id: string; isSuperAdmin: boolean; salons: { salonId: string }[] },
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(async (salonId: string) => {
    if (auth.admin.isSuperAdmin
      || auth.admin.salons.some(membership => membership.salonId === salonId)) {
      return { ok: true, admin: auth.admin };
    }
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    };
  }),
}));

const stripeMock = vi.hoisted(() => ({
  accountsCreate: vi.fn(),
  accountsRetrieve: vi.fn(),
  accountLinksCreate: vi.fn(),
}));

vi.mock('@/libs/stripe', async () => {
  const { default: RealStripe } = await vi.importActual<typeof import('stripe')>('stripe');
  const unpinned = new RealStripe('sk_test_placeholder');
  const actualModule = await vi.importActual<typeof import('@/libs/stripe')>('@/libs/stripe');
  return {
    stripe: {
      accounts: { create: stripeMock.accountsCreate, retrieve: stripeMock.accountsRetrieve },
      accountLinks: { create: stripeMock.accountLinksCreate },
      webhooks: unpinned.webhooks,
    },
    EXPECTED_STRIPE_API_VERSION: actualModule.EXPECTED_STRIPE_API_VERSION,
  };
});

const { POST } = await import('./route');
const { Env } = await import('@/libs/Env');

const SALON_A = 'salon_onboard_a';
const SALON_B = 'salon_onboard_b';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/integrations/stripe-connect/onboard', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250) + 1}` },
  }) as unknown as NextRequest;
}

/**
 * The exposure gate is the per-salon `features.money.deposits` entitlement now
 * that the env allowlist is retired, so "who may onboard" is set on the salon
 * row rather than on an environment variable. The comma-separated argument is
 * kept so each case below still reads as the allowlist it is standing in for.
 */
async function allowlist(value: string | undefined) {
  const entitled = new Set(
    (value ?? '').split(',').map(id => id.trim()).filter(Boolean),
  );
  for (const id of [SALON_A, SALON_B]) {
    await db
      .update(schema.salonSchema)
      .set({ features: entitled.has(id) ? { money: { deposits: true } } : {} })
      .where(eq(schema.salonSchema.id, id));
  }
}

function accountPayload(id = 'acct_onboard') {
  return {
    id,
    object: 'account',
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    country: 'CA',
    controller: {
      stripe_dashboard: { type: 'full' },
      losses: { payments: 'stripe' },
      fees: { payer: 'account' },
      requirement_collection: 'stripe',
    },
    requirements: {
      currently_due: [],
      eventually_due: [],
      past_due: [],
      pending_verification: [],
      current_deadline: null,
      disabled_reason: null,
    },
    metadata: {},
  };
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  for (const [id, slug] of [[SALON_A, 'onboard-a'], [SALON_B, 'onboard-b']]) {
    await db.insert(schema.salonSchema).values({ id: id!, name: 'Onboard', slug: slug! });
  }
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  auth.admin = { id: 'admin_1', isSuperAdmin: false, salons: [{ salonId: SALON_A }] };
  await db.delete(schema.salonStripeAccountSchema);
  await db.delete(schema.auditLogSchema);
  stripeMock.accountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe.com/setup/x' });

  // The vitest environment supplies neither of these, and the route correctly
  // refuses without them. Individual fail-closed tests re-stub them to undefined.
  vi.spyOn(Env, 'STRIPE_CONNECT_WEBHOOK_SECRET', 'get').mockReturnValue('whsec_connect_test');
  vi.spyOn(Env, 'OAUTH_STATE_SECRET', 'get')
    .mockReturnValue('test-oauth-state-secret-at-least-32-characters');
});

// =============================================================================
// TEST 33 — tenant isolation and the exposure gate
// =============================================================================

describe('test 33 — TENANT-1 on the id-bearing route', () => {
  it('an admin of salon A cannot act on salon B', async () => {
    await allowlist(`${SALON_A},${SALON_B}`);

    const response = await POST(request({ salonId: SALON_B }));

    expect(response.status).toBe(403);
    expect(stripeMock.accountsCreate).not.toHaveBeenCalled();
    expect(await db.select().from(schema.salonStripeAccountSchema)).toHaveLength(0);
  });

  it('(a) a non-pilot salon with no binding is refused as SALON_NOT_FOUND', async () => {
    // Deliberately the same shape as a genuinely missing salon, so the endpoint
    // does not confirm to a prober which salons are in the pilot.
    await allowlist(undefined);

    const response = await POST(request({ salonId: SALON_A }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'SALON_NOT_FOUND' } });
    expect(stripeMock.accountsCreate).not.toHaveBeenCalled();
    expect(stripeMock.accountLinksCreate).not.toHaveBeenCalled();
    expect(await db.select().from(schema.salonStripeAccountSchema)).toHaveLength(0);
  });

  it('(b) a non-pilot salon WITH a revoked binding is not stranded', async () => {
    // Clause (ii) of the predicate: an already-bound salon can always resume,
    // revoke and re-bind even after being removed from the allowlist.
    await allowlist(undefined);
    await db.insert(schema.salonStripeAccountSchema).values({
      id: 'sacct_old',
      salonId: SALON_A,
      stripeAccountId: 'acct_old',
      livemode: false,
      revokedAt: new Date('2026-08-01T00:00:00Z'),
      revocationCause: 'revoked_local',
    });
    stripeMock.accountsCreate.mockResolvedValue(accountPayload('acct_new'));

    const response = await POST(request({ salonId: SALON_A }));

    expect(response.status).toBe(200);
    expect(stripeMock.accountsCreate).toHaveBeenCalledTimes(1);
  });

  it('(c) an allowlisted salon proceeds normally', async () => {
    await allowlist(`${SALON_A}`);
    stripeMock.accountsCreate.mockResolvedValue(accountPayload());

    const response = await POST(request({ salonId: SALON_A }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: 'https://connect.stripe.com/setup/x' });
    expect(await db.select().from(schema.salonStripeAccountSchema)).toHaveLength(1);
  });
});

// =============================================================================
// TEST 9 — BIND-1 behavioural
// =============================================================================

describe('test 9 — BIND-1: a forged account id in the body is ignored', () => {
  it('persists the SERVER-created id, never the caller\'s', async () => {
    await allowlist(SALON_A);
    stripeMock.accountsCreate.mockResolvedValue(accountPayload('acct_SERVER'));

    const response = await POST(request({
      salonId: SALON_A,
      stripeAccountId: 'acct_ATTACKER',
      account: 'acct_ATTACKER',
      account_id: 'acct_ATTACKER',
    }));

    expect(response.status).toBe(200);

    const [row] = await db.select().from(schema.salonStripeAccountSchema);

    expect(row?.stripeAccountId).toBe('acct_SERVER');
  });
});

// =============================================================================
// TEST 22 — fail-closed configuration
// =============================================================================

describe('test 22 — ENV-1 fail closed on missing config', () => {
  it('refuses with 503 when the Connect webhook secret is unset', async () => {
    // A binding created while the Connect endpoint is dead has no lifecycle
    // signal at all: the deauthorization event is one-shot.
    await allowlist(SALON_A);
    vi.spyOn(Env, 'STRIPE_CONNECT_WEBHOOK_SECRET', 'get').mockReturnValue(undefined);

    const response = await POST(request({ salonId: SALON_A }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: 'STRIPE_CONNECT_NOT_CONFIGURED' },
    });
    expect(stripeMock.accountsCreate).not.toHaveBeenCalled();
    expect(await db.select().from(schema.salonStripeAccountSchema)).toHaveLength(0);
  });

  it('refuses with 503 when the OAuth state secret is unset', async () => {
    await allowlist(SALON_A);
    vi.spyOn(Env, 'STRIPE_CONNECT_WEBHOOK_SECRET', 'get').mockReturnValue('whsec_connect');
    vi.spyOn(Env, 'OAUTH_STATE_SECRET', 'get').mockReturnValue(undefined);

    const response = await POST(request({ salonId: SALON_A }));

    expect(response.status).toBe(503);
    expect(stripeMock.accountsCreate).not.toHaveBeenCalled();
    expect(await db.select().from(schema.salonStripeAccountSchema)).toHaveLength(0);
  });

  it('never leaks provider detail when the create fails', async () => {
    await allowlist(SALON_A);
    stripeMock.accountsCreate.mockRejectedValue(
      Object.assign(new Error('acct_secret_leak for jane@example.com'), {
        type: 'StripeAPIError',
        statusCode: 503,
      }),
    );

    const response = await POST(request({ salonId: SALON_A }));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toContain('STRIPE_UNAVAILABLE');
    expect(body).not.toContain('acct_secret_leak');
    expect(body).not.toContain('jane@example.com');
    expect(await db.select().from(schema.salonStripeAccountSchema)).toHaveLength(0);
  });
});
