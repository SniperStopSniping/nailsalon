import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readOwnUploadSchema } from '@/features/business-setup/read-upload.server';

import { POST } from './route';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ access: vi.fn(), open: vi.fn(), edit: vi.fn(), approve: vi.fn(), publish: vi.fn(), message: vi.fn(), readUpload: vi.fn(), applyUpload: vi.fn(), dismissUpload: vi.fn() }));
vi.mock('@/features/business-setup/access.server', () => ({ requireSetupOwner: state.access }));
vi.mock('@/features/business-setup/drafts.server', () => ({ openSetup: state.open, editSetup: state.edit, approveSetup: state.approve, restartSetup: vi.fn(), reviewSetup: vi.fn(), loadSetupHead: vi.fn(), lockSetupSalon: vi.fn() }));
vi.mock('@/features/business-setup/read-upload.server', async original => ({ ...await original<typeof import('@/features/business-setup/read-upload.server')>(), readOwnUpload: state.readUpload, applyOwnUpload: state.applyUpload, dismissOwnUpload: state.dismissUpload }));
vi.mock('@/features/business-setup/publish.server', () => ({ publishSetup: state.publish }));
vi.mock('@/features/business-setup/conversation.server', async original => ({ ...await original<typeof import('@/features/business-setup/conversation.server')>(), runSetupConversation: state.message }));

function request(body: unknown, origin = 'http://localhost:3197') {
  return new Request('http://localhost:3197/api/admin/business-setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.access.mockResolvedValue({ actor: { salonId: 'authorized-salon', adminId: 'owner' }, salon: {}, aiEnabled: false });
  state.open.mockResolvedValue({ revision: { revision: 1 } });
  vi.stubEnv('BUSINESS_SETUP_PUBLISH_ENABLED', 'false');
});

describe('setup request boundary', () => {
  it('rejects cross-origin requests before reading salon information', async () => {
    expect((await POST(request({ action: 'open', salonSlug: 'salon' }, 'https://other.invalid'))).status).toBe(403);
    expect(state.access).not.toHaveBeenCalled();
  });

  it('rejects oversized and unknown actions before domain writes', async () => {
    expect((await POST(request({ action: 'open', salonSlug: 'x'.repeat(65000) }))).status).toBe(413);
    expect((await POST(request({ action: 'run_sql', salonSlug: 'salon' }))).status).toBe(400);
    expect(state.open).not.toHaveBeenCalled();
  });

  it('retains manual access for an existing setup with AI disabled', async () => {
    expect((await POST(request({ action: 'open', salonSlug: 'salon' }))).status).toBe(200);
    expect(state.open).toHaveBeenCalledWith({ salonId: 'authorized-salon', adminId: 'owner' });
  });

  it('does not call the model when AI is disabled', async () => {
    expect((await POST(request({ action: 'message', salonSlug: 'salon', message: { message: 'Hello', operationId: crypto.randomUUID(), expectedRevision: 1, scope: 'website' } }))).status).toBe(503);
    expect(state.message).not.toHaveBeenCalled();
  });

  it('preserves the separate publication kill switch', async () => {
    expect((await POST(request({ action: 'publish', salonSlug: 'salon', operationId: crypto.randomUUID(), approvalId: crypto.randomUUID(), revision: 1 }))).status).toBe(404);
    expect(state.publish).not.toHaveBeenCalled();
  });

  it('does not trust a browser salon slug over the ownership guard', async () => {
    state.access.mockResolvedValue({ response: new Response(null, { status: 403 }) });

    expect((await POST(request({ action: 'open', salonSlug: 'someone-else' }))).status).toBe(403);
    expect(state.open).not.toHaveBeenCalled();
  });
});

it('requires an explicitly own-business upload and keeps model reads behind the AI flag', async () => {
  const input = { expectedRevision: 1, operationId: crypto.randomUUID(), referenceIds: [crypto.randomUUID()], source: 'my_business' };

  expect(readOwnUploadSchema.safeParse({ ...input, source: 'inspiration' }).success).toBe(false);
  expect((await POST(request({ action: 'read_upload', salonSlug: 'salon', input }))).status).toBe(503);
  expect(state.readUpload).not.toHaveBeenCalled();

  state.access.mockResolvedValue({ actor: { salonId: 'authorized-salon', adminId: 'owner' }, salon: {}, aiEnabled: true });

  expect((await POST(request({ action: 'read_upload', salonSlug: 'salon', input }))).status).toBe(200);
  expect(state.readUpload).toHaveBeenCalledWith({ salonId: 'authorized-salon', adminId: 'owner' }, input);
});

it('allows reviewing stored extraction with AI off but never turns it into approval or publication', async () => {
  const operationId = crypto.randomUUID();

  expect((await POST(request({ action: 'apply_upload', salonSlug: 'salon', operationId }))).status).toBe(200);
  expect(state.applyUpload).toHaveBeenCalledWith({ salonId: 'authorized-salon', adminId: 'owner' }, operationId);
  expect(state.approve).not.toHaveBeenCalled();
  expect(state.publish).not.toHaveBeenCalled();
});
