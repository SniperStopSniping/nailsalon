import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const {
  requireAdmin,
  getSalonBySlug,
  getSalonById,
  resolveBookingPageContent,
  isCloudinaryConfigured,
  updateBookingPageContentDraft,
  logAuditEvent,
  mkdir,
  writeFile,
  sharpFactory,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getSalonBySlug: vi.fn(),
  getSalonById: vi.fn(),
  resolveBookingPageContent: vi.fn(),
  isCloudinaryConfigured: vi.fn(() => false),
  updateBookingPageContentDraft: vi.fn(),
  logAuditEvent: vi.fn(),
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  sharpFactory: vi.fn(),
}));

vi.mock('@/libs/adminAuth', () => ({ requireAdmin }));
vi.mock('@/libs/queries', () => ({ getSalonBySlug, getSalonById }));
vi.mock('@/libs/Cloudinary', () => ({ isCloudinaryConfigured }));
vi.mock('@/libs/bookingPageContent', () => ({ updateBookingPageContentDraft, resolveBookingPageContent }));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent }));
vi.mock('node:fs/promises', () => ({ mkdir, writeFile }));
vi.mock('cloudinary', () => ({ v2: { config: vi.fn(), uploader: { upload_stream: vi.fn() } } }));
vi.mock('sharp', () => ({ default: sharpFactory }));

const SALON = { id: 'salon_a', slug: 'salon-a', name: 'Salon A' };

function sharpPipeline(width: number, height: number, fail = false) {
  const pipeline = {
    rotate: vi.fn(() => pipeline),
    metadata: vi.fn(async () => {
      if (fail) {
        throw new Error('Input buffer contains unsupported image format');
      }
      return { width, height };
    }),
    resize: vi.fn(() => pipeline),
    webp: vi.fn(() => pipeline),
    toBuffer: vi.fn(async () => ({ data: Buffer.from('webp-bytes'), info: { width: Math.min(width, 2000), height: Math.min(height, 2000) } })),
  };
  return pipeline;
}

function upload(file: File | null, slug = 'salon-a', baseline?: string): Request {
  const body = new FormData();
  if (file) {
    body.append('file', file);
  }
  if (baseline !== undefined) {
    body.append('baselineHeroImageUrl', baseline);
  }
  return new Request(`http://localhost/api/admin/booking-page/cover?salonSlug=${slug}`, { method: 'POST', body });
}

describe('POST /api/admin/booking-page/cover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSalonBySlug.mockImplementation(async (slug: string) => (slug === 'salon-a' ? SALON : null));
    requireAdmin.mockResolvedValue({ ok: true, admin: { id: 'admin_1' } });
    isCloudinaryConfigured.mockReturnValue(false);
    sharpFactory.mockImplementation(() => sharpPipeline(1600, 1000));
    updateBookingPageContentDraft.mockImplementation(async (_salonId: string, patch: { heroImageUrl: string }) => ({
      version: 1,
      draft: { heroImageUrl: patch.heroImageUrl },
      live: { heroImageUrl: null },
    }));
  });

  it('rejects an unauthorized admin before reading the upload', async () => {
    requireAdmin.mockResolvedValue({ ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) });

    const response = await POST(upload(new File(['x'], 'cover.jpg', { type: 'image/jpeg' })));

    expect(response.status).toBe(403);
    expect(requireAdmin).toHaveBeenCalledWith('salon_a');
    expect(sharpFactory).not.toHaveBeenCalled();
    expect(updateBookingPageContentDraft).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown salon slug and never touches storage', async () => {
    const response = await POST(upload(new File(['x'], 'cover.jpg', { type: 'image/jpeg' }), 'other-salon'));

    expect(response.status).toBe(404);
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('rejects non-image types and keeps the current cover', async () => {
    const response = await POST(upload(new File(['x'], 'cover.gif', { type: 'image/gif' })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'UNSUPPORTED_MEDIA_TYPE' } });
    expect(updateBookingPageContentDraft).not.toHaveBeenCalled();
  });

  it('rejects a file sharp cannot decode, whatever its declared type', async () => {
    sharpFactory.mockImplementation(() => sharpPipeline(0, 0, true));

    const response = await POST(upload(new File(['not really an image'], 'cover.png', { type: 'image/png' })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'UNREADABLE_IMAGE' } });
    expect(writeFile).not.toHaveBeenCalled();
    expect(updateBookingPageContentDraft).not.toHaveBeenCalled();
  });

  it('stores an app-owned WebP under the salon and assigns it to the draft only', async () => {
    const response = await POST(upload(new File(['jpeg-bytes'], 'studio.jpg', { type: 'image/jpeg' })));

    expect(response.status).toBe(200);

    const payload = await response.json();

    expect(payload.data.heroImageUrl).toMatch(/^\/uploads\/cover\/salon_a\/cover_[0-9a-f]{16}\.webp$/);
    expect(payload.data.qualityNote).toBeNull();
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('uploads/cover/salon_a'), { recursive: true });
    expect(updateBookingPageContentDraft).toHaveBeenCalledWith('salon_a', { heroImageUrl: payload.data.heroImageUrl });
    expect(payload.content.live.heroImageUrl).toBeNull();
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ salonId: 'salon_a', entityType: 'booking_page_draft' }));
  });

  it('flags a small source as guidance without refusing it', async () => {
    sharpFactory.mockImplementation(() => sharpPipeline(800, 600));

    const response = await POST(upload(new File(['jpeg-bytes'], 'small.jpg', { type: 'image/jpeg' })));

    expect(response.status).toBe(200);

    const payload = await response.json();

    expect(payload.data.qualityNote).toMatch(/small side/);
    expect(updateBookingPageContentDraft).toHaveBeenCalledTimes(1);
  });

  it('keeps a newer choice made while the upload was in flight', async () => {
    getSalonById.mockResolvedValue({ ...SALON, settings: {} });
    resolveBookingPageContent.mockReturnValue({ version: 1, draft: { heroImageUrl: null }, live: { heroImageUrl: null } });

    const response = await POST(upload(new File(['jpeg-bytes'], 'studio.jpg', { type: 'image/jpeg' }), 'salon-a', 'https://cdn.example/previous.webp'));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'STALE_CHOICE' } });
    expect(updateBookingPageContentDraft).not.toHaveBeenCalled();
  });

  it('assigns the upload when the draft still holds the baseline cover', async () => {
    getSalonById.mockResolvedValue({ ...SALON, settings: {} });
    resolveBookingPageContent.mockReturnValue({ version: 1, draft: { heroImageUrl: 'https://cdn.example/previous.webp' }, live: { heroImageUrl: null } });

    const response = await POST(upload(new File(['jpeg-bytes'], 'studio.jpg', { type: 'image/jpeg' }), 'salon-a', 'https://cdn.example/previous.webp'));

    expect(response.status).toBe(200);
    expect(updateBookingPageContentDraft).toHaveBeenCalledTimes(1);
  });

  it('keeps the last valid cover when storage fails', async () => {
    writeFile.mockRejectedValueOnce(new Error('disk full'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(upload(new File(['jpeg-bytes'], 'studio.jpg', { type: 'image/jpeg' })));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'STORAGE_UNAVAILABLE' } });
    expect(updateBookingPageContentDraft).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
