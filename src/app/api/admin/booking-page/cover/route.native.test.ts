import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const { requireAdmin, writeFile, updateBookingPageContentDraft, logAuditEvent } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  writeFile: vi.fn(async (_path: string, _data: Buffer) => undefined),
  updateBookingPageContentDraft: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/adminAuth', () => ({ requireAdmin }));
vi.mock('@/libs/queries', () => ({
  getSalonBySlug: vi.fn(async () => ({ id: 'cover_test_salon' })),
  getSalonById: vi.fn(),
}));
vi.mock('@/libs/Cloudinary', () => ({ isCloudinaryConfigured: vi.fn(() => false) }));
vi.mock('@/libs/bookingPageContent', () => ({ updateBookingPageContentDraft, resolveBookingPageContent: vi.fn() }));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), writeFile }));
vi.mock('cloudinary', () => ({ v2: { config: vi.fn(), uploader: { upload_stream: vi.fn() } } }));

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="pink"/></svg>');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const photo = () => sharp({ create: { width: 64, height: 32, channels: 3, background: '#f0d8dd' } });

function upload(bytes: Buffer, type: string): Request {
  const body = new FormData();
  body.set('file', new File([new Uint8Array(bytes)], 'cover.jpg', { type }));
  return new Request('http://localhost/api/admin/booking-page/cover?salonSlug=cover-test', { method: 'POST', body });
}

describe('cover uploads with the real native decoder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ ok: true, admin: { id: 'test_owner' } });
    updateBookingPageContentDraft.mockResolvedValue({ draft: {}, live: { heroImageUrl: '/existing-live-cover.webp' } });
  });

  it.each(['image/jpeg', 'image/png', 'image/webp'])('rejects harmless SVG bytes disguised as %s before storage or draft updates', async (type) => {
    const response = await POST(upload(svg, type));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'UNREADABLE_IMAGE' } });
    expect(writeFile).not.toHaveBeenCalled();
    expect(updateBookingPageContentDraft).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['GIF', async () => gif],
    ['TIFF', async () => photo().tiff().toBuffer()],
    ['AVIF', async () => photo().avif().toBuffer()],
    ['invalid bytes', async () => Buffer.from('this is not a photo')],
  ] as const)('rejects %s bytes carrying a JPEG label', async (_format, bytes) => {
    const response = await POST(upload(await bytes(), 'image/jpeg'));

    expect(response.status).toBe(400);
    expect(writeFile).not.toHaveBeenCalled();
    expect(updateBookingPageContentDraft).not.toHaveBeenCalled();
  });

  it.each(['jpeg', 'png', 'webp'] as const)('converts a genuine %s upload to a safe WebP draft asset', async (format) => {
    const response = await POST(upload(await photo().toFormat(format).toBuffer(), `image/${format}`));

    expect(response.status).toBe(200);

    const payload = await response.json();

    expect(payload.data).toMatchObject({ width: 64, height: 32 });
    expect(payload.content.live.heroImageUrl).toBe('/existing-live-cover.webp');
    expect(writeFile).toHaveBeenCalledOnce();

    const savedBytes = vi.mocked(writeFile).mock.calls[0]![1] as Buffer;

    expect(await sharp(savedBytes).metadata()).toMatchObject({ format: 'webp', width: 64, height: 32 });
    expect(updateBookingPageContentDraft).toHaveBeenCalledWith('cover_test_salon', { heroImageUrl: payload.data.heroImageUrl });
  });

  it('normalizes phone orientation and removes EXIF from the saved image', async () => {
    const response = await POST(upload(await photo().withMetadata({ orientation: 6 }).jpeg().toBuffer(), 'image/jpeg'));

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ width: 32, height: 64 });

    const metadata = await sharp(vi.mocked(writeFile).mock.calls[0]![1] as Buffer).metadata();

    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  it('bounds the longest edge while preserving the photo aspect ratio', async () => {
    const bytes = await sharp({ create: { width: 3200, height: 1600, channels: 3, background: '#f0d8dd' } }).jpeg().toBuffer();
    const response = await POST(upload(bytes, 'image/jpeg'));

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ width: 2000, height: 1000 });
  });

  it('rejects an unauthorized owner without parsing the submitted image', async () => {
    requireAdmin.mockResolvedValue({ ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) });
    const request = upload(svg, 'image/jpeg');
    const readBody = vi.spyOn(request, 'formData');

    expect((await POST(request)).status).toBe(403);
    expect(readBody).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(updateBookingPageContentDraft).not.toHaveBeenCalled();
  });
});
