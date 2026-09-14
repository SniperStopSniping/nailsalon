import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PortfolioImageValidationError } from '@/libs/portfolioImageStorage.server';
import { PortfolioLimitError } from '@/libs/portfolioLimits';

import { POST } from './route';

const { authorize, upload, capacity, create, remove, active, audit } = vi.hoisted(() => ({
  authorize: vi.fn(),
  upload: vi.fn(),
  capacity: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  active: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/portfolioAdminContext.server', () => ({ requirePortfolioAdmin: authorize }));
vi.mock('@/libs/portfolioImageStorage.server', async original => ({
  ...await original<typeof import('@/libs/portfolioImageStorage.server')>(),
  uploadPortfolioImage: upload,
  deletePortfolioImage: remove,
  markPortfolioImageActive: active,
}));
vi.mock('@/libs/portfolioMedia.server', () => ({
  canAcceptPortfolioUpload: capacity,
  createPortfolioPhoto: create,
  PUBLICATION_RIGHTS_TEXT: 'Confirm permission.',
  PUBLICATION_RIGHTS_VERSION: 'v1',
}));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent: audit }));

function request(rights = true) {
  const form = new FormData();
  form.set('file', new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
  form.set('publicationRightsConfirmed', String(rights));
  return new Request('https://example.test/api/admin/portfolio/upload?salonSlug=salon-a', { method: 'POST', body: form });
}

describe('Portfolio multipart upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ error: null, context: { salon: { id: 'resolved-salon' }, actorId: 'owner' } });
    capacity.mockResolvedValue({ allowed: true });
    upload.mockResolvedValue({ publicId: 'managed-photo', imageUrl: 'https://example.test/photo.webp', width: 800, height: 600, bytes: 123 });
    create.mockResolvedValue({ id: 'photo' });
    remove.mockResolvedValue(undefined);
    active.mockResolvedValue(undefined);
    audit.mockResolvedValue(undefined);
  });

  it('persists only the server-resolved owner and decoded metadata', async () => {
    expect((await POST(request())).status).toBe(201);
    expect(authorize).toHaveBeenCalledWith('salon-a');
    expect(upload).toHaveBeenCalledWith({ salonId: 'resolved-salon', file: expect.any(File) });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ salonId: 'resolved-salon', publicationRightsConfirmedBy: 'owner', mimeType: 'image/webp', fileSizeBytes: 123 }));
  });

  it('rejects wrong-tenant access before parsing or uploading bytes', async () => {
    authorize.mockResolvedValue({ error: new Response(null, { status: 403 }), context: null });

    expect((await POST(request())).status).toBe(403);
    expect(upload).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('requires publication rights before storage', async () => {
    expect((await POST(request(false))).status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses a full portfolio before uploading', async () => {
    capacity.mockResolvedValue({ allowed: false, stored: 10, max: 10 });

    expect((await POST(request())).status).toBe(403);
    expect(upload).not.toHaveBeenCalled();
  });

  it('cleans up only its own upload when another request claims the last slot', async () => {
    create.mockRejectedValue(new PortfolioLimitError({ stored: 10, max: 10, plan: 'free' }));
    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(remove).toHaveBeenCalledWith({ publicId: 'managed-photo', salonId: 'resolved-salon' });
    expect(active).not.toHaveBeenCalled();
  });

  it('bounds multipart bytes even without a Content-Length header', async () => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array(4_000_001)], 'large.jpg', { type: 'image/jpeg' }));
    const response = await POST(new Request('https://example.test/api/admin/portfolio/upload?salonSlug=salon-a', { method: 'POST', body: form }));

    expect(response.status).toBe(413);
    expect(upload).not.toHaveBeenCalled();
  });

  it('reports storage errors and never inserts a photo', async () => {
    upload.mockRejectedValue(new PortfolioImageValidationError('IMAGE_STORAGE_FAILED', 'Photo storage unavailable.'));
    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'IMAGE_STORAGE_FAILED' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('cleans up its upload when persistence fails', async () => {
    create.mockRejectedValue(new Error('database unavailable'));
    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: 'PHOTO_SAVE_FAILED' } });
    expect(remove).toHaveBeenCalledWith({ publicId: 'managed-photo', salonId: 'resolved-salon' });
  });

  it('keeps the committed image if audit or tagging fails', async () => {
    audit.mockRejectedValue(new Error('audit unavailable'));
    active.mockRejectedValue(new Error('tag unavailable'));

    expect((await POST(request())).status).toBe(201);
    expect(remove).not.toHaveBeenCalled();
  });
});
