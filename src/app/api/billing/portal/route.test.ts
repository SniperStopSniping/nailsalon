/**
 * Billing Portal session — P5b (G41, G26, D9, D18) proofs.
 *
 * This is a LIVE route used by legacy-flow customers today; P5b's only
 * behaviour changes are (1) the Stripe customer resolves through a live
 * `billing_subscription` row first, falling back to the legacy
 * `salon.stripeCustomerId` projection (G41 — the new billing domain never
 * writes the legacy column, so a new-track subscriber used to hit
 * NO_BILLING_ACCOUNT here even with a live subscription), and (2) the error
 * response is masked (G26 — no more raw `error.message` passthrough). For a
 * legacy-only salon, the `stripe.billingPortal.sessions.create` call and the
 * success response shape must be BYTE-FOR-BYTE identical to the pre-P5b
 * route, which always did:
 *
 *   const session = await stripe.billingPortal.sessions.create({
 *     customer: salon.stripeCustomerId,
 *     return_url: returnUrl || defaultReturnUrl,
 *   });
 *   return NextResponse.json({ url: session.url });
 *
 * The "before" expectation pinned in the first describe block below is that
 * exact call shape, transcribed from the pre-P5b route.ts before any change
 * in this PR.
 *
 * X5 (2026-09-16) deliberately ENDS that byte-for-byte parity in exactly one
 * respect: `return_url` is no longer `returnUrl || defaultReturnUrl`. A
 * caller-supplied value now has to be a same-origin http(s) URL, and anything
 * else falls back to the default instead of reaching Stripe. Parity for a
 * legacy-only salon supplying no `returnUrl`, or a same-origin one, is
 * unchanged and still pinned. The origin itself comes from
 * `resolveBillingAppOrigin()` rather than an inline localhost fallback.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const billingCustomerMock = vi.hoisted(() => ({ findBillingCustomer: vi.fn() }));
vi.mock('@/libs/billing/billingCustomer', () => billingCustomerMock);

const envHolder = vi.hoisted(() => ({
  NEXT_PUBLIC_APP_URL: 'https://app.test' as string | undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

// Mirrors requireAdmin's real membership check (adminAuth.ts:443-454): an
// admin authenticated for one salon is refused a FOREIGN salonId with the
// same 403 Forbidden shape production returns — proves the cross-salon
// rejection happens before any DB read or Stripe call.
// `nonOwnerSalonIds` names the salons where the authenticated admin is a
// COLLABORATOR (`role: 'admin'`), not the owner: `requireAdmin` still admits
// them, `requireAdminOwner` answers 403 OWNER_REQUIRED (adminAuth.ts:488-508).
// Y1/OP-1 made the Portal owner-only — it replaces the payment method and can
// cancel the subscription — so the stub composes the way the real guard does.
const adminHolder = vi.hoisted(() => ({
  deniedSalonIds: new Set<string>(),
  nonOwnerSalonIds: new Set<string>(),
}));
vi.mock('@/libs/adminAuth', () => {
  const requireAdmin = vi.fn(async (salonId: string) => {
    if (adminHolder.deniedSalonIds.has(salonId)) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      };
    }
    return { ok: true, admin: { clerkUserId: 'user_default' } };
  });
  const requireAdminOwner = vi.fn(async (
    salonId: string,
    message = 'Only the salon owner can do this.',
  ) => {
    const guard = await requireAdmin(salonId);
    if (!guard.ok || !adminHolder.nonOwnerSalonIds.has(salonId)) {
      return guard;
    }
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'OWNER_REQUIRED', message } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  });
  return { requireAdmin, requireAdminOwner };
});

vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit: () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
}));

const stripeMock = vi.hoisted(() => ({
  billingPortal: {
    sessions: {
      create: vi.fn(),
    },
  },
}));
vi.mock('@/libs/stripe', () => ({ stripe: stripeMock }));

const sentryMock = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: sentryMock.captureException }));

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  envHolder.NEXT_PUBLIC_APP_URL = 'https://app.test';
  adminHolder.deniedSalonIds = new Set();
  adminHolder.nonOwnerSalonIds = new Set();
  stripeMock.billingPortal.sessions.create.mockReset();
  stripeMock.billingPortal.sessions.create.mockImplementation(async () => ({
    id: 'bps_test_session',
    url: 'https://billing.stripe.test/session',
  }));
  sentryMock.captureException.mockReset();
  billingCustomerMock.findBillingCustomer.mockReset();
  billingCustomerMock.findBillingCustomer.mockResolvedValue(null);
});

const post = async (body: unknown) => {
  const { POST } = await import('./route');
  return POST(new NextRequest('http://localhost/api/billing/portal', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }));
};

let salonCounter = 0;
async function seedSalon(stripeCustomerId: string | null): Promise<string> {
  salonCounter += 1;
  const id = `sal_portal_${salonCounter}`;
  await db.insert(schema.salonSchema).values({
    id,
    name: id,
    slug: id,
    stripeCustomerId,
  });
  return id;
}

describe('legacy-flow customers — byte-identical behaviour', () => {
  it('creates a portal session with the legacy customer id and the exact pre-P5b call arguments', async () => {
    const salonId = await seedSalon('cus_legacy_abc');

    const response = await post({ salonId });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: 'https://billing.stripe.test/session' });

    // The "before" expectation, transcribed from the pre-P5b route: the ONLY
    // call is `stripe.billingPortal.sessions.create({ customer, return_url })`
    // with the salon's legacy stripeCustomerId and the default return URL.
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_legacy_abc',
      return_url: 'https://app.test/admin?tab=billing',
    });
  });

  it('honours an explicit returnUrl exactly as before', async () => {
    const salonId = await seedSalon('cus_legacy_custom_return');

    await post({ salonId, returnUrl: 'https://app.test/admin?tab=settings' });

    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_legacy_custom_return',
      return_url: 'https://app.test/admin?tab=settings',
    });
  });
});

describe('customer resolution (G41)', () => {
  it('uses the canonical billing customer even when the legacy column differs', async () => {
    const salonId = await seedSalon('cus_legacy_stale');
    billingCustomerMock.findBillingCustomer.mockResolvedValueOnce({
      id: 'bcus_portal',
      salonId,
      planEnv: 'test',
      stripeCustomerId: 'cus_new_track_live',
      source: 'adopted_subscription',
    });

    const response = await post({ salonId });

    expect(response.status).toBe(200);
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_new_track_live',
      return_url: 'https://app.test/admin?tab=billing',
    });
  });

  it('uses the canonical resolver result when no legacy customer exists', async () => {
    const salonId = await seedSalon(null);
    billingCustomerMock.findBillingCustomer.mockResolvedValueOnce({
      id: 'bcus_portal_only',
      salonId,
      planEnv: 'test',
      stripeCustomerId: 'cus_current_live',
      source: 'created',
    });

    await post({ salonId });

    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_current_live',
      return_url: 'https://app.test/admin?tab=billing',
    });
  });

  it('falls back to the legacy column when no canonical mapping is available', async () => {
    const salonId = await seedSalon('cus_legacy_wins');

    const response = await post({ salonId });

    expect(response.status).toBe(200);
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_legacy_wins',
      return_url: 'https://app.test/admin?tab=billing',
    });
  });

  it('returns 400 NO_BILLING_ACCOUNT when there is no canonical mapping and no legacy customer id', async () => {
    const salonId = await seedSalon(null);

    const response = await post({ salonId });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('NO_BILLING_ACCOUNT');
    expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
});

describe('error masking (G26)', () => {
  it('returns a fixed message and exactly one Sentry capture on a Stripe error, never error.message', async () => {
    const salonId = await seedSalon('cus_legacy_err');
    stripeMock.billingPortal.sessions.create.mockRejectedValueOnce(
      new Error('secret internal Stripe diagnostic detail'),
    );

    const response = await post({ salonId });

    expect(response.status).toBe(500);

    const body = await response.json();

    expect(body.error.code).toBe('PORTAL_ERROR');
    expect(body.error.message).toBe('The billing portal is temporarily unavailable.');
    expect(JSON.stringify(body)).not.toContain('secret internal Stripe diagnostic detail');

    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      { tags: { endpoint: 'billing/portal' } },
    );
  });
});

describe('access control and input validation (unchanged)', () => {
  it('returns 403 before any DB read or Stripe call for a cross-salon admin', async () => {
    const salonId = await seedSalon('cus_legacy_guarded');
    adminHolder.deniedSalonIds = new Set([salonId]);

    const response = await post({ salonId });

    expect(response.status).toBe(403);
    expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_INPUT when salonId is missing, as today', async () => {
    const response = await post({});

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_INPUT');
    expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
});

// Y1 / OP-1 — owner-only money actions (owner authorization 2026-09-16).
describe('owner-only money actions (Y1/OP-1)', () => {
  it('refuses a non-owner admin OF THIS SALON with 403 OWNER_REQUIRED before any Stripe call', async () => {
    const salonId = await seedSalon('cus_owner_required');
    adminHolder.nonOwnerSalonIds = new Set([salonId]);

    const response = await post({ salonId });

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('OWNER_REQUIRED');
    expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  it('leaves the OWNER unchanged — the identical request opens the portal once the caller owns the salon', async () => {
    const salonId = await seedSalon('cus_owner_unchanged');
    adminHolder.nonOwnerSalonIds = new Set([salonId]);

    expect((await post({ salonId })).status).toBe(403);

    adminHolder.nonOwnerSalonIds = new Set();
    const allowed = await post({ salonId });

    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ url: 'https://billing.stripe.test/session' });
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledTimes(1);
  });
});

// X5 — the return_url origin, and the caller-supplied returnUrl.
describe('X5 — return url origin and returnUrl validation', () => {
  const withVercel = async (value: string | undefined, run: () => Promise<void>) => {
    const previous = process.env.VERCEL;
    if (value === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = value;
    }
    try {
      await run();
    } finally {
      if (previous === undefined) {
        delete process.env.VERCEL;
      } else {
        process.env.VERCEL = previous;
      }
    }
  };

  it('a hosted runtime with NEXT_PUBLIC_APP_URL unset fails masked, with no Stripe call', async () => {
    const salonId = await seedSalon('cus_origin_unset');
    envHolder.NEXT_PUBLIC_APP_URL = undefined;

    await withVercel('1', async () => {
      const response = await post({ salonId });

      expect(response.status).toBe(500);

      const body = await response.json();

      expect(body.error.code).toBe('PORTAL_ERROR');
      expect(body.error.message).toBe('The billing portal is temporarily unavailable.');
      // A customer who just changed their card is never returned to localhost,
      // and is never told which variable the operator forgot.
      expect(JSON.stringify(body)).not.toContain('localhost');
      expect(JSON.stringify(body)).not.toContain('APP_ORIGIN_UNCONFIGURED');
      expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
      expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    });
  });

  it('local development is unaffected: an unset origin off a hosted runtime still returns to localhost', async () => {
    const salonId = await seedSalon('cus_origin_local');
    envHolder.NEXT_PUBLIC_APP_URL = undefined;

    await withVercel(undefined, async () => {
      const response = await post({ salonId });

      expect(response.status).toBe(200);
      expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_origin_local',
        return_url: 'http://localhost:3000/admin?tab=billing',
      });
    });
  });

  it('builds the default return url from the ORIGIN only, dropping a path or bypass token', async () => {
    const salonId = await seedSalon('cus_origin_strip');
    envHolder.NEXT_PUBLIC_APP_URL = 'https://app.test/nested?x-vercel-protection-bypass=tok';

    const response = await post({ salonId });

    expect(response.status).toBe(200);
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_origin_strip',
      return_url: 'https://app.test/admin?tab=billing',
    });
  });

  it('falls back to the default for a FOREIGN-origin returnUrl, which never reaches Stripe', async () => {
    const salonId = await seedSalon('cus_return_foreign');

    const response = await post({ salonId, returnUrl: 'https://evil.example/harvest?next=1' });

    // Silently, deliberately: a management link that returns the owner to
    // their own dashboard beats stranding them outside the Portal.
    expect(response.status).toBe(200);
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_return_foreign',
      return_url: 'https://app.test/admin?tab=billing',
    });

    const sentToStripe = JSON.stringify(stripeMock.billingPortal.sessions.create.mock.calls[0]);

    expect(sentToStripe).not.toContain('evil.example');
  });

  it('falls back for a protocol-relative, a non-http(s), an unparseable and an empty returnUrl alike', async () => {
    const attempt = async (customerId: string, returnUrl: string) => {
      stripeMock.billingPortal.sessions.create.mockClear();
      const salonId = await seedSalon(customerId);
      const response = await post({ salonId, returnUrl });

      expect(response.status).toBe(200);

      const call = stripeMock.billingPortal.sessions.create.mock.calls[0]![0];

      expect(call.return_url).toBe('https://app.test/admin?tab=billing');
      expect(JSON.stringify(call)).not.toContain('evil.example');
    };

    // `//evil.example` is the classic protocol-relative open-redirect vector:
    // it looks like a path and resolves to a foreign origin.
    await attempt('cus_return_protocol_relative', '//evil.example/harvest');
    await attempt('cus_return_scheme', 'javascript:alert(1)');
    await attempt('cus_return_unparseable', 'http://[::bad');
    await attempt('cus_return_empty', '');
    // `blob:` reports OUR origin, so an origin check alone would pass it
    // through to Stripe as an unusable return_url.
    await attempt('cus_return_blob', 'blob:https://app.test/9f1c');
  });

  it('strips credentials from an otherwise same-origin returnUrl', async () => {
    const salonId = await seedSalon('cus_return_userinfo');

    // `https://user:pass@app.test/x` IS same-origin, so the origin check alone
    // would forward the credentials into the link Stripe renders.
    const response = await post({ salonId, returnUrl: 'https://owner:hunter2@app.test/admin?tab=settings' });

    expect(response.status).toBe(200);

    const call = stripeMock.billingPortal.sessions.create.mock.calls[0]![0];

    expect(call.return_url).toBe('https://app.test/admin?tab=settings');
    expect(call.return_url).not.toContain('hunter2');
    expect(call.return_url).not.toContain('@');
  });

  it('accepts a same-origin absolute returnUrl unchanged and absolutises a same-origin path', async () => {
    const absoluteSalonId = await seedSalon('cus_return_absolute');

    await post({ salonId: absoluteSalonId, returnUrl: 'https://app.test/admin?tab=settings' });

    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_return_absolute',
      return_url: 'https://app.test/admin?tab=settings',
    });

    stripeMock.billingPortal.sessions.create.mockClear();
    const relativeSalonId = await seedSalon('cus_return_relative');

    await post({ salonId: relativeSalonId, returnUrl: '/admin?tab=settings' });

    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_return_relative',
      return_url: 'https://app.test/admin?tab=settings',
    });
  });
});
