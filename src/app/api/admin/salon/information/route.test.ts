/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdmin,
  getSalonBySlug,
  getActiveLocationsBySalonId,
  getTechniciansBySalonId,
  logAuditEvent,
  updateSet,
  setUpdateResult,
  db,
} = vi.hoisted(() => {
  let updateResult: unknown[] = [];
  const setUpdateResult = (next: unknown[]) => {
    updateResult = next;
  };
  const updateReturning = vi.fn(async () => updateResult);
  // The salon write awaits `.returning()`; the primary-location mirror awaits
  // `.where()` directly, so the chain must be both awaitable and chainable.
  const updateWhere = vi.fn(() => Object.assign(Promise.resolve(updateResult), { returning: updateReturning }));
  const updateSet = vi.fn((_values: Record<string, unknown>) => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const db: Record<string, unknown> = { update };
  db.transaction = async (run: (tx: unknown) => Promise<unknown>) => run(db);
  return {
    requireAdmin: vi.fn(),
    getSalonBySlug: vi.fn(),
    getActiveLocationsBySalonId: vi.fn(),
    getTechniciansBySalonId: vi.fn(),
    logAuditEvent: vi.fn(),
    updateSet,
    setUpdateResult,
    db,
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/libs/adminAuth', async () => ({
  ...(await vi.importActual<typeof import('@/libs/adminAuth')>('@/libs/adminAuth')),
  requireAdmin,
}));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent }));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/queries', () => ({ getSalonBySlug, getActiveLocationsBySalonId, getTechniciansBySalonId }));

import { GET, PATCH } from './route';

const PRIVATE_ADDRESS = '123 Private Street';

function salon(overrides: Record<string, unknown> = {}) {
  return {
    id: 'salon_1',
    slug: 'salon-a',
    name: 'Salon A',
    customDomain: null,
    logoUrl: 'https://cdn.example/logo.png',
    phone: '+14165550100',
    email: 'hello@salon-a.test',
    publicationStatus: 'published',
    slugLockedAt: new Date('2026-08-01T00:00:00.000Z'),
    businessHours: { monday: { open: '10:00', close: '18:00' }, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null },
    settings: {
      booking: { timezone: 'America/Vancouver' },
      bookingExperience: { socialLinks: { instagram: 'https://www.instagram.com/salona/', facebook: null, tiktok: null } },
      bookingPageContent: { version: 1, draft: { locationDisplayMode: 'after_booking' }, live: { locationDisplayMode: 'city_only' } },
      sharedProfile: { bookingOnlyContact: false, callEnabled: true, textEnabled: false, textNumber: null },
    },
    ...overrides,
  };
}

const primaryLocation = {
  id: 'loc_1',
  name: 'Primary location',
  address: PRIVATE_ADDRESS,
  city: 'Toronto',
  state: 'ON',
  zipCode: 'M5V 1A1',
  phone: '+14165550100',
  email: 'hello@salon-a.test',
  businessHours: { monday: { open: '09:00', close: '17:00' }, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null },
  isPrimary: true,
};

/**
 * Renders a drizzle `sql` tree to a readable string for assertions: string
 * chunks verbatim, bound parameters as their JSON payload, columns/tables
 * omitted. Enough to prove WHICH settings keys a write targets.
 */
function flattenSql(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return '';
  }
  const node = value as { queryChunks?: unknown[]; value?: unknown; name?: string };
  if (Array.isArray(node.queryChunks)) {
    return node.queryChunks.map(flattenSql).join('');
  }
  if (Array.isArray(node.value)) {
    return node.value.map(String).join('');
  }
  if (typeof node.value === 'string') {
    return node.value;
  }
  return '';
}

function request(url: string, init?: RequestInit) {
  return new Request(url, init);
}

function patchRequest(body: unknown, slug = 'salon-a') {
  return request(`https://x.test/api/admin/salon/information?salonSlug=${slug}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('admin salon information route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUpdateResult([salon({ name: 'Renamed Studio' })]);
    getSalonBySlug.mockResolvedValue(salon());
    getActiveLocationsBySalonId.mockResolvedValue([primaryLocation]);
    getTechniciansBySalonId.mockResolvedValue([{ id: 'tech_1', name: 'Daniela', avatarUrl: null }]);
    requireAdmin.mockResolvedValue({
      ok: true,
      admin: { id: 'admin_1', isSuperAdmin: false, salons: [{ salonId: 'salon_1', role: 'owner' }] },
    });
  });

  describe('authorization', () => {
    it('400s without a salon slug', async () => {
      const response = await GET(request('https://x.test/api/admin/salon/information'));

      expect(response.status).toBe(400);
    });

    it('404s for an unknown salon before touching auth', async () => {
      getSalonBySlug.mockResolvedValue(null);

      const response = await GET(request('https://x.test/api/admin/salon/information?salonSlug=nope'));

      expect(response.status).toBe(404);
      expect(requireAdmin).not.toHaveBeenCalled();
    });

    it('propagates the tenant guard response for another tenant', async () => {
      requireAdmin.mockResolvedValue({ ok: false, response: new Response('Forbidden', { status: 403 }) });

      const response = await PATCH(patchRequest({ name: 'Hijacked' }));

      expect(response.status).toBe(403);
      expect(updateSet).not.toHaveBeenCalled();
      expect(getActiveLocationsBySalonId).not.toHaveBeenCalled();
    });

    it('denies a non-owner admin membership', async () => {
      requireAdmin.mockResolvedValue({
        ok: true,
        admin: { id: 'admin_2', isSuperAdmin: false, salons: [{ salonId: 'salon_1', role: 'admin' }] },
      });

      const response = await PATCH(patchRequest({ name: 'Hijacked' }));

      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('OWNER_REQUIRED');
      expect(updateSet).not.toHaveBeenCalled();
    });

    it('lets a super admin (impersonation) through', async () => {
      requireAdmin.mockResolvedValue({ ok: true, admin: { id: 'admin_9', isSuperAdmin: true, salons: [] } });

      const response = await GET(request('https://x.test/api/admin/salon/information?salonSlug=salon-a'));

      expect(response.status).toBe(200);
    });
  });

  describe('GET', () => {
    it('returns the canonical current values, including private ones, for the owner', async () => {
      const response = await GET(request('https://x.test/api/admin/salon/information?salonSlug=salon-a'));
      const { data } = await response.json();

      expect(data.salon).toMatchObject({ name: 'Salon A', slug: 'salon-a', slugLocked: true, logoUrl: 'https://cdn.example/logo.png', phone: '+14165550100' });
      expect(data.salon.publicUrl).toContain('/salon-a');
      expect(data.technician).toEqual({ id: 'tech_1', name: 'Daniela', avatarUrl: null });
      expect(data.technicianCount).toBe(1);
      expect(data.instagram).toBe('https://www.instagram.com/salona/');
      expect(data.location).toMatchObject({ id: 'loc_1', address: PRIVATE_ADDRESS, city: 'Toronto' });
      expect(data.addressPrivacy).toEqual({ draft: 'after_booking', live: 'city_only' });
      expect(data.contactPreferences).toEqual({ bookingOnlyContact: false, callEnabled: true, textEnabled: false, textNumber: null });
      expect(data.businessHours.monday).toEqual({ open: '09:00', close: '17:00' });
      expect(data.timezone).toBe('America/Vancouver');
    });

    it('reports a team without guessing which technician is the owner', async () => {
      getTechniciansBySalonId.mockResolvedValue([{ id: 'tech_1', name: 'A' }, { id: 'tech_2', name: 'B' }]);

      const { data } = await (await GET(request('https://x.test/api/admin/salon/information?salonSlug=salon-a'))).json();

      expect(data.technician).toBeNull();
      expect(data.technicianCount).toBe(2);
    });
  });

  describe('PATCH validation', () => {
    it.each([
      ['empty body', {}],
      ['unknown key', { slug: 'new-slug' }],
      ['private profile fields', { ownerName: 'x' }],
      ['bad phone', { phone: '12' }],
      ['bad email', { email: 'not-an-email' }],
      ['closing before opening', { businessHours: { monday: { open: '18:00', close: '09:00' }, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null } }],
      ['non 24h time', { businessHours: { monday: { open: '9am', close: '5pm' }, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null } }],
      ['instagram url on another host', { instagram: 'https://example.com/salona' }],
      ['relative logo path', { logoUrl: 'uploads/logo.png' }],
      ['technician schedule', { weeklySchedule: {} }],
    ])('rejects %s without writing', async (_label, body) => {
      const response = await PATCH(patchRequest(body));

      expect(response.status).toBe(400);
      expect(updateSet).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe('PATCH writes', () => {
    it('writes identity fields to the salon row only and never to the technician', async () => {
      const response = await PATCH(patchRequest({ name: '  Renamed Studio  ', logoUrl: 'https://cdn.example/new-logo.png' }));

      expect(response.status).toBe(200);
      expect(updateSet).toHaveBeenCalledTimes(1);
      expect(updateSet.mock.calls[0]![0]).toMatchObject({ name: 'Renamed Studio', logoUrl: 'https://cdn.example/new-logo.png' });
      expect(updateSet.mock.calls[0]![0]).not.toHaveProperty('settings');
      expect((await response.json()).data.salon.name).toBe('Renamed Studio');
    });

    it('mirrors phone, email and hours onto the primary location without touching staff schedules', async () => {
      const hours = { monday: { open: '10:00', close: '19:00' }, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: { open: '11:00', close: '15:00' } };

      const response = await PATCH(patchRequest({ phone: '(416) 555-0199', email: 'Hello@Salon-A.test ', businessHours: hours }));

      expect(response.status).toBe(200);
      expect(updateSet).toHaveBeenCalledTimes(2);
      expect(updateSet.mock.calls[0]![0]).toMatchObject({ phone: '+14165550199', email: 'hello@salon-a.test', businessHours: hours });
      expect(updateSet.mock.calls[1]![0]).toMatchObject({ phone: '+14165550199', email: 'hello@salon-a.test', businessHours: hours });
      expect(updateSet.mock.calls[1]![0]).not.toHaveProperty('weeklySchedule');
      expect(updateSet.mock.calls[1]![0]).not.toHaveProperty('name');
    });

    it('clears phone and email with empty strings', async () => {
      await PATCH(patchRequest({ phone: '', email: null }));

      expect(updateSet.mock.calls[0]![0]).toMatchObject({ phone: null, email: null });
    });

    it('normalizes an Instagram username into the canonical social link and keeps other settings keys', async () => {
      const response = await PATCH(patchRequest({ instagram: '@isla.nails' }));

      expect(response.status).toBe(200);

      const written = updateSet.mock.calls[0]![0];

      expect(written).toHaveProperty('settings');
      expect(written).not.toHaveProperty('name');

      const rendered = flattenSql(written.settings);

      expect(rendered).toContain('https://www.instagram.com/isla.nails/');
      expect(rendered).toContain('bookingExperience,socialLinks,instagram');
      expect(rendered).not.toContain('facebook');
      expect(rendered).not.toContain('sharedProfile');
    });

    it('writes only the supplied contact permissions into sharedProfile', async () => {
      await PATCH(patchRequest({ contactPreferences: { bookingOnlyContact: true, textNumber: ' +1 416 555 0177 ' } }));

      const written = flattenSql(updateSet.mock.calls[0]![0].settings);

      expect(written).toContain('sharedProfile,bookingOnlyContact');
      expect(written).toContain('+1 416 555 0177');
      expect(written).toContain('sharedProfile,textNumber');
      expect(written).not.toContain('sharedProfile,callEnabled');
      expect(written).not.toContain('sharedProfile,textEnabled');
    });

    it('records an audit event with field names only, never values', async () => {
      await PATCH(patchRequest({ phone: '4165550199', instagram: 'salona' }));

      expect(logAuditEvent).toHaveBeenCalledTimes(1);

      const entry = logAuditEvent.mock.calls[0]![0];

      expect(entry).toMatchObject({ salonId: 'salon_1', actorId: 'admin_1', action: 'settings_updated', entityType: 'salon' });
      expect(entry.metadata.fields).toEqual(['phone', 'instagram']);
      expect(JSON.stringify(entry)).not.toContain('5550199');
      expect(JSON.stringify(entry)).not.toContain('salona');
    });

    it('404s when the salon row disappears mid-write', async () => {
      setUpdateResult([]);

      const response = await PATCH(patchRequest({ name: 'Gone' }));

      expect(response.status).toBe(404);
      expect(logAuditEvent).not.toHaveBeenCalled();
    });
  });
});
