import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  isRedisAvailableMock,
  isStorageConfiguredMock,
} = vi.hoisted(() => ({
  isRedisAvailableMock: vi.fn(),
  isStorageConfiguredMock: vi.fn(),
}));

vi.mock('@/core/redis/redisClient', () => ({
  isRedisAvailable: isRedisAvailableMock,
  redis: null,
}));

vi.mock('@/core/storage/storageClient', () => ({
  generateObjectKey: vi.fn(),
  generatePresignedUpload: vi.fn(),
  isStorageConfigured: isStorageConfiguredMock,
}));

vi.mock('@/libs/staffApiGuards', () => ({
  requireStaffAppointmentAccess: vi.fn(),
}));

import { POST } from './route';

describe('POST /api/appointments/[id]/photos/presign setup errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('explains when upload session storage is unavailable', async () => {
    isRedisAvailableMock.mockResolvedValue(false);

    const response = await POST(
      new Request('http://localhost/api/appointments/appt_1/photos/presign', { method: 'POST' }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toEqual({
      code: 'UPLOAD_SESSION_STORAGE_UNAVAILABLE',
      message: 'Photo uploads are not available because upload session storage is not configured. Add REDIS_URL in Vercel, then redeploy.',
    });
  });

  it('explains when Cloudinary storage is not configured', async () => {
    isRedisAvailableMock.mockResolvedValue(true);
    isStorageConfiguredMock.mockReturnValue(false);

    const response = await POST(
      new Request('http://localhost/api/appointments/appt_1/photos/presign', { method: 'POST' }),
      { params: { id: 'appt_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toEqual({
      code: 'STORAGE_NOT_CONFIGURED',
      message: 'Photo uploads are not available because Cloudinary storage is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in Vercel.',
    });
  });
});
