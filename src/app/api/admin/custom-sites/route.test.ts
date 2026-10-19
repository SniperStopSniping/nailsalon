import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ access: vi.fn(), save: vi.fn(), generate: vi.fn(), upload: vi.fn(), edit: vi.fn(), business: vi.fn(), editMedia: vi.fn(), replaceCanva: vi.fn(), meter: vi.fn(), read: vi.fn() }));
vi.mock('@/libs/DB', () => ({ db: { transaction: state.read } }));
vi.mock('@/features/ai-credits/request-metering.server', () => ({ runWithAiCredits: state.meter }));
vi.mock('@/features/business-setup/conversation.server', () => ({ runSetupConversation: state.business }));
vi.mock('@/features/business-setup/access.server', () => ({ requireSetupOwner: state.access }));
vi.mock('@/features/custom-sites/artifacts.server', () => ({ saveCustomSource: state.save }));
vi.mock('@/features/custom-sites/generate.server', () => ({ generateCustomSite: state.generate }));
vi.mock('@/features/custom-sites/media-edit.server', async original => ({ ...await original<any>(), editCustomMedia: state.editMedia }));
vi.mock('@/features/custom-sites/canva-replace.server', async original => ({ ...await original<any>(), replaceCanvaPage: state.replaceCanva }));
vi.mock('@/features/custom-sites/assets.server', () => ({ uploadCustomAsset: state.upload }));
vi.mock('@/features/business-setup/drafts.server', () => ({ editSetup: state.edit }));
function request(body: unknown, origin = 'http://localhost:3197') {
  return new Request('http://localhost:3197/api/admin/custom-sites?salonSlug=ignored-browser-slug', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.meter.mockImplementation(async (_actor, _kind, _input, _limit, work) => work());
  state.access.mockResolvedValue({ actor: { salonId: 'authorized-salon', adminId: 'real-owner' }, aiEnabled: false });
  state.edit.mockResolvedValue({ revision: 2 });
});

it('binds custom generation to the authorized owner and exact public credit cap', async () => {
  state.access.mockResolvedValue({ actor: { salonId: 'authorized-salon', adminId: 'real-owner' }, aiEnabled: true });
  state.generate.mockResolvedValue({ head: {} });
  const input = { expectedRevision: 1, operationId: crypto.randomUUID(), message: 'Create an original editorial design.', referenceIds: [], startOver: false };

  expect((await POST(request({ action: 'generate', input, acceptedCreditLimitMicroCad: 2_000_000 }))).status).toBe(200);
  expect(state.meter).toHaveBeenCalledWith({ salonId: 'authorized-salon', adminId: 'real-owner' }, 'design', input, 2_000_000, expect.any(Function));

  state.generate.mockClear();

  expect((await POST(request({ action: 'generate', input, acceptedCreditLimitMicroCad: 50_000_000 }))).status).toBe(400);
  expect(state.generate).not.toHaveBeenCalled();
});

describe('custom website owner boundary', () => {
  it('rejects cross-origin writes before authorization or parsing', async () => {
    expect((await POST(request({}, 'https://attacker.invalid'))).status).toBe(403);
    expect(state.access).not.toHaveBeenCalled();
  });

  it('rejects unauthorized reads and writes', async () => {
    state.access.mockResolvedValue({ response: new Response(null, { status: 403 }) });

    expect((await POST(request({}))).status).toBe(403);
    expect((await GET(new Request('http://localhost:3197/api/admin/custom-sites?salonSlug=other'))).status).toBe(403);
    expect(state.save).not.toHaveBeenCalled();
  });

  it('reports a failed saved-design load without claiming a save failed or leaking private diagnostics', async () => {
    state.read.mockRejectedValueOnce(new Error('private-internal-storage-location'));
    const response = await GET(new Request('http://localhost:3197/api/admin/custom-sites?salonSlug=authorized-salon'));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toContain('could not be loaded');
    expect(JSON.stringify(body)).not.toContain('private-internal-storage-location');
    expect(state.save).not.toHaveBeenCalled();
    expect(state.generate).not.toHaveBeenCalled();
  });

  it('does not expose publication, arbitrary code execution or URL fetch tools', async () => {
    for (const action of ['publish', 'run_sql', 'fetch_url', 'execute']) {
      expect((await POST(request({ action }))).status).toBe(400);
    }

    expect(state.generate).not.toHaveBeenCalled();
  });

  it('blocks provider requests while disabled while retaining owned restoration', async () => {
    expect((await POST(request({ action: 'generate', input: { expectedRevision: 1, operationId: crypto.randomUUID(), message: 'Redesign', referenceIds: [], startOver: false } }))).status).toBe(503);
    expect(state.generate).not.toHaveBeenCalled();

    const input = { expectedRevision: 1, operationId: crypto.randomUUID(), artifactId: crypto.randomUUID() };

    expect((await POST(request({ action: 'restore', input }))).status).toBe(200);
    expect(state.edit.mock.calls[0]?.[0]).toEqual({ salonId: 'authorized-salon', adminId: 'real-owner' });
  });

  it('bounds streamed bodies without trusting Content-Length', async () => {
    expect((await POST(request({ text: 'a'.repeat(160001) }))).status).toBe(413);
    expect(state.upload).not.toHaveBeenCalled();
  });
});

it('routes an explicit price request from the design chat into the canonical service draft', async () => {
  state.access.mockResolvedValue({ actor: { salonId: 'authorized-salon', adminId: 'real-owner' }, aiEnabled: true });
  state.business.mockResolvedValue({ head: {}, reply: 'Price saved in draft.' });
  const input = { expectedRevision: 1, operationId: crypto.randomUUID(), message: 'Keep the design, but change BIAB to $65.', referenceIds: [], startOver: false };

  expect((await POST(request({ action: 'generate', input }))).status).toBe(200);
  expect(state.business).toHaveBeenCalledWith({ salonId: 'authorized-salon', adminId: 'real-owner' }, { expectedRevision: 1, operationId: input.operationId, message: input.message, scope: 'service_price' });
  expect(state.generate).not.toHaveBeenCalled();
});

it('keeps owner photo and design-choice controls available with AI disabled and scopes writes to the authorized salon', async () => {
  const values = { fidelity: 'match', referenceIds: [], ownedReferenceIds: [], websiteAssetIds: [] };
  const input = { expectedRevision: 1, operationId: crypto.randomUUID(), values };

  expect((await POST(request({ action: 'preferences', input }))).status).toBe(200);
  expect(state.edit).toHaveBeenCalledWith({ salonId: 'authorized-salon', adminId: 'real-owner' }, { expectedRevision: 1, operationId: input.operationId, operations: [{ type: 'design_brief', values }] });

  state.editMedia.mockResolvedValue({ head: {} });
  const image = { expectedRevision: 2, operationId: crypto.randomUUID(), assetId: crypto.randomUUID(), replacementId: null };

  expect((await POST(request({ action: 'edit_media', input: image }))).status).toBe(200);
  expect(state.editMedia).toHaveBeenCalledWith({ salonId: 'authorized-salon', adminId: 'real-owner' }, image);
  expect(state.generate).not.toHaveBeenCalled();
});

it('requires explicit same-design consent and scopes sharper artwork replacement without AI or publishing', async () => {
  const input = { expectedRevision: 2, operationId: crypto.randomUUID(), pageAssetId: crypto.randomUUID(), replacementId: crypto.randomUUID(), sameDesignConfirmed: true };
  state.replaceCanva.mockResolvedValue({ head: {} });

  expect((await POST(request({ action: 'replace_canva_page', input: { ...input, sameDesignConfirmed: false } }))).status).toBe(400);
  expect(state.replaceCanva).not.toHaveBeenCalled();
  expect((await POST(request({ action: 'replace_canva_page', input }))).status).toBe(200);
  expect(state.replaceCanva).toHaveBeenCalledWith({ salonId: 'authorized-salon', adminId: 'real-owner' }, input);
  expect(state.generate).not.toHaveBeenCalled();
  expect(state.business).not.toHaveBeenCalled();
});
