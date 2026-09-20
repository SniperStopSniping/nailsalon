/* eslint-disable style/max-statements-per-line */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PATCH } from './route';

const h = vi.hoisted(() => ({ require: vi.fn(), session: vi.fn() }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon: h.require, getAdminSession: h.session })); vi.mock('@/libs/DB', () => ({ db: {} })); vi.mock('@/libs/auditLog', () => ({ logAuditEvent: vi.fn() })); vi.mock('@/libs/nextVisitOffer.server', () => ({ getNextVisitOfferSettingsData: vi.fn() })); vi.mock('@/models/Schema', () => ({ salonRetentionSettingsSchema: {}, salonSchema: {}, serviceSchema: {} })); const req = (body: unknown) => new Request('http://x/api?salonSlug=a', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('next visit settings API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps tenant authorization ahead of setting validation', async () => {
    h.require.mockResolvedValueOnce({ error: Response.json({}, { status: 403 }) }); const r = await PATCH(req({ enabled: true }));

    expect(r.status).toBe(403); expect(h.session).not.toHaveBeenCalled();
  });

  it('rejects partial settings without mutating config or review settings', async () => {
    h.require.mockResolvedValueOnce({ salon: { id: 's' } }); h.session.mockResolvedValueOnce({ id: 'admin' }); const r = await PATCH(req({ enabled: true, windowDays: 30 }));

    expect(r.status).toBe(400); expect(await r.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('requires a signed-in admin after tenant selection', async () => {
    h.require.mockResolvedValueOnce({ salon: { id: 's' } }); h.session.mockResolvedValueOnce(null); const r = await PATCH(req({ enabled: false, windowDays: 30, discountType: 'percent', value: 5, eligibleServiceIds: [], messageTemplate: 'x' }));

    expect(r.status).toBe(401);
  });
});
