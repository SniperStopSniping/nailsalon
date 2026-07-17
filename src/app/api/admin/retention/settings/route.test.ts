import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RETENTION_SETTINGS } from '@/libs/retentionAssistant';

import { GET, PATCH } from './route';

vi.mock('server-only', () => ({}));

const {
  requireAdminSalon,
  getAdminSession,
  logAuditEvent,
  getRetentionSettingsForSalon,
  saveRetentionSettingsForSalon,
  selectQueue,
  db,
} = vi.hoisted(() => {
  const selectQueue: unknown[] = [];
  const query = (result: unknown) => {
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => result),
      then: (resolve: (value: unknown) => void, reject?: (reason: unknown) => void) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  };
  return {
    requireAdminSalon: vi.fn(),
    getAdminSession: vi.fn(),
    logAuditEvent: vi.fn(),
    getRetentionSettingsForSalon: vi.fn(),
    saveRetentionSettingsForSalon: vi.fn(),
    selectQueue,
    db: {
      select: vi.fn(() => query(selectQueue.shift() ?? [])),
    },
  };
});

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon, getAdminSession }));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent }));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/retentionSettings.server', () => ({
  getRetentionSettingsForSalon,
  saveRetentionSettingsForSalon,
}));

describe('/api/admin/retention/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    requireAdminSalon.mockResolvedValue({ salon: { id: 'salon_1', slug: 'salon-a' }, error: null });
    getAdminSession.mockResolvedValue({ id: 'admin_1' });
    getRetentionSettingsForSalon.mockResolvedValue(DEFAULT_RETENTION_SETTINGS);
    saveRetentionSettingsForSalon.mockImplementation(async (_salonId, settings) => settings);
  });

  it('rejects an admin who does not own the requested salon', async () => {
    requireAdminSalon.mockResolvedValue({
      salon: null,
      error: new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403 }),
    });

    const response = await GET(new Request('http://localhost/api/admin/retention/settings?salonSlug=other'));

    expect(response.status).toBe(403);
    expect(getRetentionSettingsForSalon).not.toHaveBeenCalled();
  });

  it('returns defaults and only the salon active services', async () => {
    selectQueue.push([{ id: 'service_1', name: 'Builder Gel' }]);

    const response = await GET(new Request('http://localhost/api/admin/retention/settings?salonSlug=salon-a'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.settings).toEqual(DEFAULT_RETENTION_SETTINGS);
    expect(body.data.availableServices).toEqual([{ id: 'service_1', name: 'Builder Gel' }]);
  });

  it('rejects eligible service ids from another tenant', async () => {
    selectQueue.push([]);

    const response = await PATCH(new Request(
      'http://localhost/api/admin/retention/settings?salonSlug=salon-a',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sixWeekPromotion: { eligibleServiceIds: ['foreign_service'] } }),
      },
    ));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_SERVICE');
    expect(saveRetentionSettingsForSalon).not.toHaveBeenCalled();
  });

  it('merges and persists valid partial settings without dropping promotion fields', async () => {
    selectQueue.push(
      [{ id: 'service_1' }],
      [{ id: 'service_1', name: 'Builder Gel' }],
    );

    const response = await PATCH(new Request(
      'http://localhost/api/admin/retention/settings?salonSlug=salon-a',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultRebookDays: 28,
          sixWeekPromotion: {
            enabled: true,
            value: 15,
            eligibleServiceIds: ['service_1'],
          },
        }),
      },
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(saveRetentionSettingsForSalon).toHaveBeenCalledWith(
      'salon_1',
      expect.objectContaining({
        defaultRebookDays: 28,
        sixWeekPromotion: expect.objectContaining({
          enabled: true,
          value: 15,
          eligibleServiceIds: ['service_1'],
          expiryDays: 14,
          singleUse: true,
        }),
      }),
    );
    expect(body.data.availableServices).toEqual([{ id: 'service_1', name: 'Builder Gel' }]);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      actorId: 'admin_1',
      action: 'settings_updated',
    }));
  });
});
