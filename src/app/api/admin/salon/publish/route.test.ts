/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdmin,
  getSalonBySlug,
  getSalonById,
  logAuditEvent,
  buildSalonTenantPublicUrl,
  db,
  updateSet,
  updateWhere,
  updateReturning,
} = vi.hoisted(() => {
  const updateReturning = vi.fn(async () => [] as unknown[]);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  return {
    requireAdmin: vi.fn(),
    getSalonBySlug: vi.fn(),
    getSalonById: vi.fn(),
    logAuditEvent: vi.fn(),
    buildSalonTenantPublicUrl: vi.fn((path: string) => `https://salon-a.luster.com${path === '/' ? '' : path}`),
    db: { update },
    updateSet,
    updateWhere,
    updateReturning,
  };
});

vi.mock('@/libs/adminAuth', () => ({ requireAdmin }));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent }));
vi.mock('@/libs/queries', () => ({ getSalonBySlug, getSalonById }));
vi.mock('@/libs/publicUrl', () => ({ buildSalonTenantPublicUrl }));
vi.mock('@/libs/DB', () => ({ db }));

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

describe('POST /api/admin/salon/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSalonBySlug.mockResolvedValue(DRAFT_SALON);
    getSalonById.mockResolvedValue(DRAFT_SALON);
    requireAdmin.mockResolvedValue({ ok: true, admin: { id: 'admin_1' } });
    updateReturning.mockResolvedValue([PUBLISHED_ROW]);
  });

  describe('validation / auth', () => {
    it('400s when salonSlug is missing', async () => {
      const response = await POST(request('https://x.test/api/admin/salon/publish'));

      expect(response.status).toBe(400);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('404s when the salon does not exist', async () => {
      getSalonBySlug.mockResolvedValue(null);
      const response = await POST(request('https://x.test/api/admin/salon/publish?salonSlug=nope'));

      expect(response.status).toBe(404);
      expect(requireAdmin).not.toHaveBeenCalled();
    });

    it('propagates the requireAdmin failure response unchanged when unauthenticated', async () => {
      const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      requireAdmin.mockResolvedValue({ ok: false, response: denied });

      const response = await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'));

      expect(response.status).toBe(401);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('propagates a 403 when the requesting admin is not a member of this salon (cross-tenant)', async () => {
      const forbidden = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
      requireAdmin.mockResolvedValue({ ok: false, response: forbidden });

      const response = await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'));

      expect(response.status).toBe(403);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('resolves the salon before checking admin auth, and authorizes against the salon id, not the slug', async () => {
      await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'));

      expect(getSalonBySlug).toHaveBeenCalledWith('salon-a');
      expect(requireAdmin).toHaveBeenCalledWith('salon_1');
    });
  });

  describe('publishing a draft', () => {
    it('flips draft to published, stamping publishedAt and slugLockedAt in the same UPDATE', async () => {
      const response = await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
        publicationStatus: 'published',
        publishedAt: expect.any(Date),
        slugLockedAt: expect.any(Date),
      }));
      expect(body.data).toMatchObject({
        salonId: 'salon_1',
        slug: 'salon-a',
        publicationStatus: 'published',
      });
      expect(body.data.publishedAt).toBe('2026-08-18T12:00:00.000Z');
      expect(body.data.slugLockedAt).toBe('2026-08-18T12:00:00.000Z');
    });

    it('only updates a row that is not already published (conditional WHERE)', async () => {
      await POST(request('https://x.test/api/admin/salon/publish?salonSlug=salon-a'));

      expect(updateWhere).toHaveBeenCalledTimes(1);
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
      // The conditional UPDATE finds no row to touch (publicationStatus is
      // already 'published'), so the route falls back to re-reading state.
      updateReturning.mockResolvedValue([]);
      getSalonBySlug.mockResolvedValue(PUBLISHED_ROW);
      getSalonById.mockResolvedValue(PUBLISHED_ROW);
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
