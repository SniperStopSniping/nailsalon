/* eslint-disable import/first */
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/business-setup/manual-website.server', () => ({
  editSharedSetupWebsite: vi.fn(async () => false),
  hasEditingSetup: vi.fn(async () => false),
  getSetupEditingRevision: vi.fn(async () => null),
}));

const { requireAdminOwner, getSalonBySlug, logAuditEvent, publishWebsite, clerkMiddlewareFactory, intlMiddleware } = vi.hoisted(() => ({
  requireAdminOwner: vi.fn(),
  getSalonBySlug: vi.fn(),
  logAuditEvent: vi.fn(),
  publishWebsite: vi.fn(),
  clerkMiddlewareFactory: vi.fn(),
  intlMiddleware: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminOwner }));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent }));
vi.mock('@/libs/queries', () => ({ getSalonBySlug }));
vi.mock('@/libs/bookingPageLifecycle', () => ({ publishWebsite }));
vi.mock('@/libs/publicUrl', () => ({ buildSalonTenantPublicUrl: (path: string) => `https://salon-a.luster.com${path === '/' ? '' : path}` }));
vi.mock('next-intl/middleware', () => ({ default: () => intlMiddleware }));
vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: clerkMiddlewareFactory,
  createRouteMatcher: () => () => false,
}));

import middleware from '../../../../../middleware';
import { POST } from './route';

const DRAFT_SALON = {
  id: 'salon_1',
  slug: 'salon-a',
  customDomain: null,
  publicationStatus: 'draft',
  publishedAt: null,
  slugLockedAt: null,
};

const PUBLISHED_ROW = {
  ...DRAFT_SALON,
  publicationStatus: 'published',
  publishedAt: new Date('2026-08-18T12:00:00.000Z'),
  slugLockedAt: new Date('2026-08-18T12:00:00.000Z'),
};

function request(url: string) {
  return new Request(url, { method: 'POST' });
}

const middlewareEvent = {} as never;

/**
 * Composes the real middleware gate with the real publish handler. This is a
 * focused boundary test, not a claim of Next production-runtime verification.
 */
async function publishThroughMiddleware(origin?: string) {
  const headers = new Headers({ cookie: 'n5_admin_session=owner-session' });
  if (origin !== undefined) {
    headers.set('origin', origin);
  }
  const incoming = new NextRequest(
    'https://x.test/api/admin/salon/publish?salonSlug=salon-a',
    { method: 'POST', headers },
  );
  const gate = await middleware(incoming, middlewareEvent);
  if (gate?.status === 403) {
    return gate;
  }
  return POST(incoming);
}

describe('POST /api/admin/salon/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intlMiddleware.mockImplementation(() => NextResponse.next());
    clerkMiddlewareFactory.mockImplementation((handler: (auth: unknown, request: NextRequest) => Response | Promise<Response>) => async (incoming: NextRequest) => (
      handler(vi.fn(), incoming)
    ));
    getSalonBySlug.mockResolvedValue(DRAFT_SALON);
    requireAdminOwner.mockResolvedValue({ ok: true, admin: { id: 'admin_1' } });
    publishWebsite.mockResolvedValue({ salon: PUBLISHED_ROW, applied: true });
  });

  describe('CSRF middleware boundary around the publish side effect', () => {
    it('denies a cross-site request before the publish handler or publication side effect runs', async () => {
      const response = await publishThroughMiddleware('https://attacker.example');

      expect(response.status).toBe(403);
      expect(getSalonBySlug).not.toHaveBeenCalled();
      expect(requireAdminOwner).not.toHaveBeenCalled();
      expect(publishWebsite).not.toHaveBeenCalled();
    });

    it('allows an exact same-origin browser request to reach the real publish handler', async () => {
      const response = await publishThroughMiddleware('https://x.test');

      expect(response.status).toBe(200);
      expect(publishWebsite).toHaveBeenCalledWith('salon_1');
    });
  });

  describe('validation / auth', () => {
    it('400s when salonSlug is missing', async () => {
      const response = await POST(request('https://x.test/api/admin/salon/publish'));

      expect(response.status).toBe(400);
      expect(publishWebsite).not.toHaveBeenCalled();
    });

    it('404s when the salon does not exist', async () => {
      getSalonBySlug.mockResolvedValue(null);
      const response = await POST(request('https://x.test/api/admin/salon/publish?salonSlug=nope'));

      expect(response.status).toBe(404);
      expect(requireAdminOwner).not.toHaveBeenCalled();
    });

    it('propagates the requireAdminOwner failure response unchanged when unauthenticated', async () => {
      const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      requireAdminOwner.mockResolvedValue({ ok: false, response: denied });

      const response = await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'));

      expect(response.status).toBe(401);
      expect(publishWebsite).not.toHaveBeenCalled();
    });

    it('propagates a 403 when the requesting admin is not a member of this salon (cross-tenant)', async () => {
      const forbidden = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
      requireAdminOwner.mockResolvedValue({ ok: false, response: forbidden });

      const response = await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'));

      expect(response.status).toBe(403);
      expect(publishWebsite).not.toHaveBeenCalled();
    });

    it('resolves the salon before checking admin auth, and authorizes against the salon id, not the slug', async () => {
      await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'));

      expect(getSalonBySlug).toHaveBeenCalledWith('salon-a');
      expect(requireAdminOwner).toHaveBeenCalledWith('salon_1', expect.any(String));
    });

    // AG-security-tenancy-02: publishing stamps slugLockedAt for good, so a
    // collaborator (membership role 'admin') must not reach the UPDATE.
    it('refuses a collaborator with 403 OWNER_REQUIRED and never publishes', async () => {
      requireAdminOwner.mockResolvedValue({
        ok: false,
        response: new Response(
          JSON.stringify({ error: { code: 'OWNER_REQUIRED', message: 'Only the salon owner can publish this website.' } }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        ),
      });

      const response = await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: 'OWNER_REQUIRED',
          message: 'Only the salon owner can publish this website.',
        },
      });
      expect(publishWebsite).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });
  });

  it('keeps failed publication recoverable without returning a false success or audit', async () => {
    publishWebsite.mockRejectedValue(new Error('storage unavailable'));
    const response = await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'PUBLISH_FAILED' } });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  describe('publishing a draft', () => {
    it('uses the shared atomic publication lifecycle and returns original timestamps', async () => {
      const response = await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(publishWebsite).toHaveBeenCalledWith('salon_1');
      expect(body.data).toMatchObject({
        salonId: 'salon_1',
        slug: 'salon-a',
        publicationStatus: 'published',
      });
      expect(body.data.publishedAt).toBe('2026-08-18T12:00:00.000Z');
      expect(body.data.slugLockedAt).toBe('2026-08-18T12:00:00.000Z');
    });

    it('delegates publication exactly once', async () => {
      await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'));

      expect(publishWebsite).toHaveBeenCalledTimes(1);
    });

    it('audit-logs the publish as a tenant-scoped settings_updated event', async () => {
      await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'));

      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
        salonId: 'salon_1',
        actorType: 'admin',
        actorId: 'admin_1',
        action: 'settings_updated',
        entityType: 'salon',
        entityId: 'salon_1',
      }));
    });

    it('returns preview/public urls built from the real slug', async () => {
      const response = await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'));
      const body = await response.json();

      expect(body.data.publicUrl).toBe('https://salon-a.luster.com');
      expect(body.data.bookingUrl).toBe('https://salon-a.luster.com/book/service');
    });
  });

  describe('publishing an already-published salon (idempotent no-op)', () => {
    beforeEach(() => {
      // The locked lifecycle returns the already-published snapshot unchanged.
      publishWebsite.mockResolvedValue({ salon: PUBLISHED_ROW, applied: false });
      getSalonBySlug.mockResolvedValue(PUBLISHED_ROW);
    });

    it('does not re-stamp publishedAt/slugLockedAt and does not audit-log again', async () => {
      const response = await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.publicationStatus).toBe('published');
      expect(body.data.publishedAt).toBe('2026-08-18T12:00:00.000Z');
      expect(body.data.slugLockedAt).toBe('2026-08-18T12:00:00.000Z');
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('is safe to call twice in a row with identical results', async () => {
      const first = await (await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'))).json();
      const second = await (await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'))).json();

      expect(first.data).toEqual(second.data);
    });
  });
});
