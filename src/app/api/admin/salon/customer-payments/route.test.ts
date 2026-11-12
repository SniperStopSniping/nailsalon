import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '@/libs/customerPayments/settings';

import { GET, PATCH } from './route';

const mocks = vi.hoisted(() => ({ gate: vi.fn(), requireAdminOwner: vi.fn(), getSalonBySlug: vi.fn(), read: vi.fn(), save: vi.fn(), factory: vi.fn(), provider: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/customerPayments/preparationGate', () => ({ isCustomerPaymentPreparationEnabled: mocks.gate }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminOwner: mocks.requireAdminOwner }));
vi.mock('@/libs/queries', () => ({ getSalonBySlug: mocks.getSalonBySlug }));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/customerPayments/server/preparationRepository', () => ({ createCustomerPaymentPreparationRepository: mocks.factory }));
vi.mock('@/libs/depositActivation.server', () => ({ prepareDepositActivation: mocks.provider }));
vi.mock('stripe', () => ({ default: mocks.provider }));
vi.mock('@/libs/customerAssistant/http.server', () => ({ readCustomerJson: (request: Request) => request.json().catch(() => null) }));

const body = { expectedRevision: 0, requestId: '1cfb5245-a096-40fa-8fb5-689af6617d93', settings: DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS };
const result = { testOnly: true, collectionEnabled: false, revision: 0, settings: DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS };
function request(value: unknown = body, origin = 'http://localhost') {
  return new Request('http://localhost/api/admin/salon/customer-payments?salonSlug=test-salon', { method: 'PATCH', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(value) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate.mockReturnValue(true);
  mocks.getSalonBySlug.mockResolvedValue({ id: 'salon1' });
  mocks.requireAdminOwner.mockResolvedValue({ ok: true, admin: { id: 'owner1' } });
  mocks.read.mockResolvedValue(result);
  mocks.save.mockResolvedValue({ ...result, revision: 1 });
  mocks.factory.mockReturnValue({ readCustomerPaymentSettingsDraft: mocks.read, saveCustomerPaymentSettingsDraft: mocks.save });
});

describe('owner-only customer payment draft API', () => {
  it('fails closed before auth/database work when gate is off', async () => {
    mocks.gate.mockReturnValue(false);

    expect((await GET(request())).status).toBe(404);
    expect((await PATCH(request())).status).toBe(404);
    expect(mocks.getSalonBySlug).not.toHaveBeenCalled();
    expect(mocks.requireAdminOwner).not.toHaveBeenCalled();
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  it.each([401, 403])('respects missing auth or owner/tenant denial (%i)', async (status) => {
    mocks.requireAdminOwner.mockResolvedValue({ ok: false, response: new Response(null, { status }) });

    expect((await GET(request())).status).toBe(status);
    expect((await PATCH(request())).status).toBe(status);
    expect(mocks.requireAdminOwner).toHaveBeenCalledWith('salon1');
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  it('returns default-off test draft without provider calls', async () => {
    const response = await GET(request());

    expect(await response.json()).toEqual(result);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.read).toHaveBeenCalledWith('salon1');
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it('binds save to authenticated salon and actor', async () => {
    const response = await PATCH(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ testOnly: true, collectionEnabled: false, revision: 1 });
    expect(mocks.save).toHaveBeenCalledWith({ ...body, salonId: 'salon1', actorId: 'owner1' });
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it('forbids cross-origin writes before lookup', async () => {
    expect((await PATCH(request(body, 'https://foreign.invalid'))).status).toBe(403);
    expect(mocks.getSalonBySlug).not.toHaveBeenCalled();
  });

  it.each([
    { ...body, salonId: 'other' },
    { ...body, settings: { ...body.settings, mode: 'full_online_required' } },
    { ...body, settings: { ...body.settings, mode: 'required_deposit' } },
    { ...body, settings: { ...body.settings, feePayer: 'customer' } },
    { ...body, expectedRevision: -1 },
  ])('rejects unsupported schema without persistence', async (value) => {
    expect((await PATCH(request(value))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each(['CUSTOMER_PAYMENT_DRAFT_REVISION_CONFLICT', 'CUSTOMER_PAYMENT_DRAFT_REPLAY_CONFLICT'])('returns recoverable conflict for %s', async (code) => {
    mocks.save.mockRejectedValueOnce(new Error(code));
    const response = await PATCH(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code } });
  });
});
