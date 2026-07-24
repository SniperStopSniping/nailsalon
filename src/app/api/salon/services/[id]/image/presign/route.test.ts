import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdminSalon,
  isCloudinaryConfigured,
  selectedRows,
  selectLimit,
  generateServiceImagePublicId,
  createServiceImageUploadSignature,
  checkServiceImagePresignRateLimit,
} = vi.hoisted(() => {
  let rows: unknown[] = [];
  const selectLimit = vi.fn(async () => rows);

  return {
    requireAdminSalon: vi.fn(),
    isCloudinaryConfigured: vi.fn(),
    selectedRows: (nextRows: unknown[]) => {
      rows = nextRows;
    },
    selectLimit,
    generateServiceImagePublicId: vi.fn(),
    createServiceImageUploadSignature: vi.fn(),
    checkServiceImagePresignRateLimit: vi.fn(),
  };
});

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon }));
vi.mock('@/libs/Cloudinary', () => ({ isCloudinaryConfigured }));
vi.mock('@/libs/serviceImagePresignRateLimit.server', () => ({
  checkServiceImagePresignRateLimit,
}));
vi.mock('@/libs/DB', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: selectLimit,
        })),
      })),
    })),
  },
}));
vi.mock('@/libs/serviceImageStorage.server', () => ({
  SERVICE_IMAGE_ALLOWED_CONTENT_TYPES: [
    'image/jpeg',
    'image/png',
    'image/webp',
  ],
  SERVICE_IMAGE_MAX_BYTES: 5 * 1024 * 1024,
  SERVICE_IMAGE_UPLOAD_PRESET: 'luster_service_images_v1',
  serviceImageFormatForContentType: (contentType: string) =>
    contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1],
  generateServiceImagePublicId,
  createServiceImageUploadSignature,
}));

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

function request(body: unknown) {
  return new Request('http://localhost/api/salon/services/svc_1/image/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const context = { params: { id: 'svc_1' } };
const validBody = {
  salonSlug: 'isla-nail-studio',
  contentType: 'image/jpeg',
  fileSize: 1024,
  expectedImageUrl: null,
};

describe('POST /api/salon/services/[id]/image/presign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    selectedRows([{ id: 'svc_1', imageUrl: null }]);
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1', slug: 'isla-nail-studio' },
    });
    isCloudinaryConfigured.mockReturnValue(true);
    checkServiceImagePresignRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 19,
    });
    generateServiceImagePublicId.mockReturnValue(
      'salons/salon_1/services/service_svc_1_token_jpg',
    );
    createServiceImageUploadSignature.mockReturnValue({
      uploadUrl: 'https://api.cloudinary.com/v1_1/demo-cloud/image/upload',
      apiKey: 'public-api-key',
      cloudName: 'demo-cloud',
      timestamp: 123456,
      signature: 'signed-value',
      uploadPreset: 'luster_service_images_v1',
      publicId: 'salons/salon_1/services/service_svc_1_token_jpg',
      overwrite: false,
      type: 'upload',
      tags: 'luster_service_image_pending_v1',
      context: 'signed-pending-context',
      finalizeToken: 'a'.repeat(64),
    });
  });

  it('returns signed direct-upload parameters with an app-generated public id', async () => {
    const response = await POST(request(validBody), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(generateServiceImagePublicId).toHaveBeenCalledWith({
      salonId: 'salon_1',
      serviceId: 'svc_1',
      format: 'jpg',
    });
    expect(body.data).toEqual({
      strategy: 'cloudinary',
      uploadUrl: 'https://api.cloudinary.com/v1_1/demo-cloud/image/upload',
      apiKey: 'public-api-key',
      cloudName: 'demo-cloud',
      timestamp: 123456,
      signature: 'signed-value',
      uploadPreset: 'luster_service_images_v1',
      publicId: 'salons/salon_1/services/service_svc_1_token_jpg',
      overwrite: false,
      type: 'upload',
      tags: 'luster_service_image_pending_v1',
      context: 'signed-pending-context',
      finalizeToken: 'a'.repeat(64),
    });
    expect(createServiceImageUploadSignature).toHaveBeenCalledWith({
      publicId: 'salons/salon_1/services/service_svc_1_token_jpg',
      salonId: 'salon_1',
      serviceId: 'svc_1',
      expectedImageUrl: null,
    });
    expect(JSON.stringify(body)).not.toContain('api-secret');
  });

  it.each([
    ['image/svg+xml', 1024],
    ['image/jpeg', 0],
    ['image/png', 5 * 1024 * 1024 + 1],
  ])('rejects invalid upload metadata: %s / %s', async (contentType, fileSize) => {
    const response = await POST(
      request({ ...validBody, contentType, fileSize }),
      context,
    );

    expect(response.status).toBe(400);
    expect(generateServiceImagePublicId).not.toHaveBeenCalled();
  });

  it('preserves the admin authentication response', async () => {
    requireAdminSalon.mockResolvedValue({
      salon: null,
      error: new Response(null, { status: 401 }),
    });

    expect((await POST(request(validBody), context)).status).toBe(401);
  });

  it('returns 404 for a missing or cross-salon service', async () => {
    selectedRows([]);

    expect((await POST(request(validBody), context)).status).toBe(404);
  });

  it('rejects a stale expected image before creating an upload', async () => {
    selectedRows([{ id: 'svc_1', imageUrl: 'https://res.cloudinary.com/demo/old.jpg' }]);

    const response = await POST(request(validBody), context);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('SERVICE_IMAGE_STALE');
    expect(generateServiceImagePublicId).not.toHaveBeenCalled();
    expect(checkServiceImagePresignRateLimit).not.toHaveBeenCalled();
  });

  it('rate limits an authenticated salon before issuing upload parameters', async () => {
    checkServiceImagePresignRateLimit.mockResolvedValue({
      allowed: false,
      reason: 'rate_limited',
      retryAfterSeconds: 73,
    });

    const response = await POST(request(validBody), context);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('73');
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(generateServiceImagePublicId).not.toHaveBeenCalled();
  });

  it('fails closed when the hosted rate-limit store is unavailable', async () => {
    checkServiceImagePresignRateLimit.mockResolvedValue({
      allowed: false,
      reason: 'unavailable',
    });

    const response = await POST(request(validBody), context);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('IMAGE_UPLOAD_RATE_LIMIT_UNAVAILABLE');
    expect(generateServiceImagePublicId).not.toHaveBeenCalled();
  });

  it('returns the local strategy only outside production when Cloudinary is absent', async () => {
    isCloudinaryConfigured.mockReturnValue(false);
    vi.stubEnv('NODE_ENV', 'development');

    const response = await POST(request(validBody), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ strategy: 'local' });
  });

  it('fails closed in production when Cloudinary is absent', async () => {
    isCloudinaryConfigured.mockReturnValue(false);
    vi.stubEnv('NODE_ENV', 'production');

    const response = await POST(request(validBody), context);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('IMAGE_STORAGE_UNAVAILABLE');
  });
});
