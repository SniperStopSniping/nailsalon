/**
 * Onboard route — the fail-closed leg that cannot be reached with a getter spy
 * (charter test 22, missing-config).
 *
 * `onboard/route.test.ts` already covers the request-time config reads
 * (`STRIPE_CONNECT_WEBHOOK_SECRET`, `OAUTH_STATE_SECRET`) with `vi.spyOn(Env, …,
 * 'get')`, which works because the route reads those properties per request.
 *
 * `EXPECTED_LIVEMODE` is different: `readiness.ts:135` evaluates
 * `computeExpectedLivemode(process.env)` **once, at module load**. No spy applied
 * after import can change it, so the MODE_INDETERMINATE branch needs its own
 * module graph — which is exactly why the charter puts the missing-config case in
 * its own file. Mocking the *producer* (`@/libs/environmentIsolation`) rather
 * than the readiness module means the const is computed genuinely, through the
 * real code path, from a mode-indeterminate environment.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
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

// A deployment that disagrees with itself: VERCEL_ENV says production, the key
// says test. `computeExpectedLivemode` refuses to pick a winner, and every
// Connect write path must refuse with it rather than guess a mode.
vi.mock('@/libs/environmentIsolation', async () => {
  const actual = await vi.importActual<typeof import('@/libs/environmentIsolation')>(
    '@/libs/environmentIsolation',
  );
  return {
    ...actual,
    computeExpectedLivemode: () => ({ ok: false, code: 'MODE_INDETERMINATE' as const }),
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(async () => ({
    ok: true,
    admin: { id: 'admin_1', isSuperAdmin: false, salons: [{ salonId: 'salon_env_a' }] },
  })),
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

const SALON_A = 'salon_env_a';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/integrations/stripe-connect/onboard', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.1.0.${Math.floor(Math.random() * 250) + 1}`,
    },
  }) as unknown as NextRequest;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({ id: SALON_A, name: 'Env', slug: 'env-a' });
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await db.delete(schema.salonStripeAccountSchema);
  await db.delete(schema.auditLogSchema);

  vi.spyOn(Env, 'STRIPE_CONNECT_WEBHOOK_SECRET', 'get').mockReturnValue('whsec_connect_test');
  vi.spyOn(Env, 'OAUTH_STATE_SECRET', 'get')
    .mockReturnValue('test-oauth-state-secret-at-least-32-characters');
  vi.spyOn(Env, 'LUSTER_DEPOSITS_PILOT_SALON_IDS', 'get').mockReturnValue(SALON_A);
  stripeMock.accountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe.com/setup/x' });
});

describe('test 22 — ENV-1: an indeterminate mode refuses before any provider call', () => {
  it('returns 503 and never creates a Stripe account', async () => {
    // Creating an account under a guessed mode is unrecoverable: the account is
    // real, it is in whichever mode the platform key actually was, and the row
    // that records its mode would be a fabrication.
    const response = await POST(request({ salonId: SALON_A }));

    expect(response.status).toBe(503);
    expect(stripeMock.accountsCreate).not.toHaveBeenCalled();
    expect(stripeMock.accountLinksCreate).not.toHaveBeenCalled();
  });

  it('writes no binding row and no audit row', async () => {
    await POST(request({ salonId: SALON_A }));

    expect(await db.select().from(schema.salonStripeAccountSchema)).toHaveLength(0);
    expect(await db.select().from(schema.auditLogSchema)).toHaveLength(0);
  });

  it('does not leak the internal reason to the caller', async () => {
    const response = await POST(request({ salonId: SALON_A }));
    const body = await response.text();

    // The operator learns the cause from Sentry and the health endpoint; the
    // HTTP body says only that Connect is not configured.
    expect(body).not.toContain('MODE_INDETERMINATE');
    expect(body).not.toContain('sk_test');
  });
});
