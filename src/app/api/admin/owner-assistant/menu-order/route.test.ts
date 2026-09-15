import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenuOrderError } from '@/libs/ownerAssistant/menuOrder.server';

import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  env: { OWNER_ASSISTANT_ENABLED: 'true' as string | undefined },
  scope: vi.fn(),
  owner: vi.fn(),
  menu: vi.fn(),
  operation: vi.fn(),
  prepare: vi.fn(),
  apply: vi.fn(),
  undo: vi.fn(),
}));
vi.mock('@/libs/Env', () => ({ Env: mocks.env }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalonForSlug: mocks.scope, requireRealSalonOwner: mocks.owner }));
vi.mock('@/libs/ownerAssistant/menuOrder.server', () => ({
  getOwnerAssistantMenu: mocks.menu,
  getMenuOperation: mocks.operation,
  prepareMenuOrder: mocks.prepare,
  applyMenuOrder: mocks.apply,
  undoMenuOrder: mocks.undo,
  MenuOrderError: class extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  },
}));

const endpoint = 'http://localhost/api/admin/owner-assistant/menu-order';
const request = (body: unknown) => new Request(endpoint, { method: 'POST', body: JSON.stringify(body) });
const command = { action: 'apply', salonSlug: 'owner-salon', proposalId: 'proposal-a' };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.OWNER_ASSISTANT_ENABLED = 'true';
  mocks.scope.mockResolvedValue({ error: null, salon: { id: 'resolved-salon' } });
  mocks.owner.mockResolvedValue({ ok: true, admin: { id: 'resolved-owner' } });
  mocks.menu.mockResolvedValue({ menu: [], revision: 0 });
  mocks.apply.mockResolvedValue({ id: 'proposal-a', status: 'applied' });
  mocks.undo.mockResolvedValue({ id: 'proposal-a', status: 'undone' });
});

describe('owner assistant route admission and validation', () => {
  it.each([undefined, 'false'])('is absent before auth/domain access when the flag is %s', async (flag) => {
    mocks.env.OWNER_ASSISTANT_ENABLED = flag;

    expect((await GET(new Request(`${endpoint}?salonSlug=owner-salon`))).status).toBe(404);
    expect((await POST(request(command))).status).toBe(404);
    expect(mocks.scope).not.toHaveBeenCalled();
    expect(mocks.menu).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it.each([401, 403])('propagates scope admission failure %s without reading menu state', async (status) => {
    mocks.scope.mockResolvedValue({ error: new Response(null, { status }), salon: null });

    expect((await POST(request(command))).status).toBe(status);
    expect(mocks.owner).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('checks current owner admission for every read, Apply and Undo', async () => {
    mocks.owner.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });

    expect((await GET(new Request(`${endpoint}?salonSlug=owner-salon`))).status).toBe(403);
    expect((await POST(request(command))).status).toBe(403);
    expect((await POST(request({ ...command, action: 'undo' }))).status).toBe(403);
    expect(mocks.owner).toHaveBeenCalledTimes(3);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.undo).not.toHaveBeenCalled();
  });

  it.each([
    { ...command, actorAdminId: 'attacker' },
    { ...command, salonId: 'foreign-salon' },
    { ...command, action: 'refund' },
    { action: 'prepare', salonSlug: 'owner-salon', idempotencyKey: 'not-a-uuid', orderedIds: ['a'] },
    { action: 'prepare', salonSlug: 'owner-salon', idempotencyKey: '00000000-0000-4000-8000-000000000001', orderedIds: [] },
  ])('rejects malformed or extended action payloads before auth: %j', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.scope).not.toHaveBeenCalled();
  });

  it('passes resolved tenant and actor to actions and receipt reads, with private cache headers', async () => {
    const applied = await POST(request(command));

    expect(applied.status).toBe(200);
    expect(applied.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.apply).toHaveBeenCalledWith({ salonId: 'resolved-salon', actorAdminId: 'resolved-owner', proposalId: 'proposal-a' });
    expect(mocks.scope).toHaveBeenCalledWith('owner-salon', { persistActiveSalon: false });

    mocks.operation.mockResolvedValue({ id: 'proposal-a', status: 'applied' });
    const receipt = await GET(new Request(`${endpoint}?salonSlug=owner-salon&proposalId=proposal-a`));

    expect(receipt.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.operation).toHaveBeenCalledWith({ salonId: 'resolved-salon', actorAdminId: 'resolved-owner', proposalId: 'proposal-a' });
    expect((await receipt.json()).data.receipt.status).toBe('applied');
  });

  it('returns a missing foreign receipt and a stale Apply without success claims', async () => {
    mocks.operation.mockRejectedValue(new MenuOrderError('NOT_FOUND', 'Unavailable'));

    expect((await GET(new Request(`${endpoint}?salonSlug=owner-salon&proposalId=foreign`))).status).toBe(404);

    mocks.apply.mockRejectedValue(new MenuOrderError('STALE', 'Refresh preview'));
    const stale = await POST(request(command));

    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: { code: 'STALE', message: 'Refresh preview' } });
  });
});
