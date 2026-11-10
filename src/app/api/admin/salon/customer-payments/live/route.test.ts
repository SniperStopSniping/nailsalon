import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, PATCH } from './route';

const mocks = vi.hoisted(() => ({ owner: vi.fn(), salon: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/adminAuth', () => ({ requireRealSalonOwner: mocks.owner }));
vi.mock('@/libs/queries', () => ({ getSalonBySlug: mocks.salon }));
vi.mock('@/libs/customerPayments/server/workspacePolicyRepository', () => ({ createWorkspacePolicyRepository: () => ({ read: mocks.read, write: mocks.write }) }));
vi.mock('@/libs/customerPayments/server/workspaceRuntime', () => ({ workspaceRuntime: () => ({ executionEnabled: false }) }));
vi.mock('@/libs/customerAssistant/http.server', () => ({ readCustomerJson: (request: Request) => request.json() }));

const input = { requestId: randomUUID(), expectedRevision: 0, enabled: false, cancellationPolicy: '' };
function request(body: unknown = input, origin = 'https://example.invalid') {
  return new Request('https://example.invalid/api/admin/salon/customer-payments/live?salonSlug=salon', { method: 'PATCH', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('APP_ENV', 'test');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('CUSTOMER_PAYMENTS_WORKSPACE_ENABLED', 'true');
  mocks.salon.mockResolvedValue({ id: 'salon-id' });
  mocks.owner.mockResolvedValue({ ok: true, admin: { id: 'actual-owner' } });
  mocks.read.mockResolvedValue({ enabled: false, revision: 0 });
  mocks.write.mockResolvedValue({ enabled: false, revision: 1 });
});

describe('owner activation API', () => {
  it('does no tenant or auth work with the feature off or a cross-origin mutation', async () => {
    vi.stubEnv('CUSTOMER_PAYMENTS_WORKSPACE_ENABLED', 'false');

    expect((await GET(request())).status).toBe(404);
    expect((await PATCH(request())).status).toBe(404);

    vi.stubEnv('CUSTOMER_PAYMENTS_WORKSPACE_ENABLED', 'true');

    expect((await PATCH(request(input, 'https://foreign.invalid'))).status).toBe(403);
    expect(mocks.salon).not.toHaveBeenCalled();
    expect(mocks.owner).not.toHaveBeenCalled();
  });

  it.each([401, 403])('honors the real-owner guard and refuses collaborator or impersonation access (%i)', async (status) => {
    mocks.owner.mockResolvedValue({ ok: false, response: new Response(null, { status }) });

    expect((await GET(request())).status).toBe(status);
    expect((await PATCH(request())).status).toBe(status);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('binds a change to the authenticated owner and resolved salon', async () => {
    const response = await PATCH(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.write).toHaveBeenCalledWith('salon-id', 'actual-owner', input, { executionEnabled: false });
  });

  it.each([{ ...input, actorId: 'forged' }, { ...input, bindingId: 'forged' }, { ...input, enabled: true }, { ...input, platformFeeCents: 99 }])('rejects authority, fees, or missing cancellation policy in the payload', async (body) => {
    expect((await PATCH(request(body))).status).toBe(400);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
