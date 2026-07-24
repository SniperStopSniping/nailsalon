import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdminSalon,
  isCloudinaryConfigured,
  selectReferences,
  selectRows,
  setReferenceRows,
  setSelectedRows,
  setUpdatedRows,
  updateSet,
  assertManagedServiceImagePublicId,
  verifyCloudinaryServiceImage,
  saveLocalServiceImage,
  deletePendingServiceImageAssetById,
  deleteManagedServiceImage,
  managedCloudinaryPublicIdFromUrl,
  markCloudinaryServiceImageActive,
  serviceImageUrlReferencesManagedPublicId,
  verifyServiceImageFinalizeToken,
} = vi.hoisted(() => {
  let selected: unknown[] = [];
  let references: unknown[] = [];
  let updated: unknown[] = [];
  const selectRows = vi.fn(async () => selected);
  const selectReferences = vi.fn(async () => references);
  const updateRows = vi.fn(async () => updated);
  const updateSet = vi.fn(() => ({
    where: vi.fn(() => ({
      returning: updateRows,
    })),
  }));

  return {
    requireAdminSalon: vi.fn(),
    isCloudinaryConfigured: vi.fn(),
    selectReferences,
    selectRows,
    setReferenceRows: (rows: unknown[]) => {
      references = rows;
    },
    setSelectedRows: (rows: unknown[]) => {
      selected = rows;
    },
    setUpdatedRows: (rows: unknown[]) => {
      updated = rows;
    },
    updateSet,
    assertManagedServiceImagePublicId: vi.fn(),
    verifyCloudinaryServiceImage: vi.fn(),
    saveLocalServiceImage: vi.fn(),
    deletePendingServiceImageAssetById: vi.fn(),
    deleteManagedServiceImage: vi.fn(),
    managedCloudinaryPublicIdFromUrl: vi.fn(),
    markCloudinaryServiceImageActive: vi.fn(),
    serviceImageUrlReferencesManagedPublicId: vi.fn(),
    verifyServiceImageFinalizeToken: vi.fn(),
  };
});

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon }));
vi.mock('@/libs/Cloudinary', () => ({ isCloudinaryConfigured }));
vi.mock('@/libs/DB', () => ({
  db: {
    select: vi.fn((fields?: unknown) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => fields
          ? selectReferences()
          : {
              limit: selectRows,
            }),
      })),
    })),
    update: vi.fn(() => ({
      set: updateSet,
    })),
  },
}));
vi.mock('@/libs/serviceImageStorage.server', () => {
  class ServiceImageValidationError extends Error {
    code: string;
    managedAssetId?: string;

    constructor(code: string, message: string, managedAssetId?: string) {
      super(message);
      this.code = code;
      this.managedAssetId = managedAssetId;
    }
  }

  return {
    SERVICE_IMAGE_ALLOWED_CONTENT_TYPES: [
      'image/jpeg',
      'image/png',
      'image/webp',
    ],
    SERVICE_IMAGE_MAX_BYTES: 5 * 1024 * 1024,
    ServiceImageValidationError,
    assertManagedServiceImagePublicId,
    verifyCloudinaryServiceImage,
    saveLocalServiceImage,
    deletePendingServiceImageAssetById,
    deleteManagedServiceImage,
    managedCloudinaryPublicIdFromUrl,
    markCloudinaryServiceImageActive,
    serviceImageUrlReferencesManagedPublicId,
    verifyServiceImageFinalizeToken,
  };
});

/* eslint-disable import/first */
import { DELETE, POST } from './route';
/* eslint-enable import/first */

const oldUrl
  = 'https://res.cloudinary.com/demo/image/upload/v1/salons/salon_1/services/service_svc_1_old_jpg.jpg';
const newUrl
  = 'https://res.cloudinary.com/demo/image/upload/v2/salons/salon_1/services/service_svc_1_new_jpg.jpg';
const publicId = 'salons/salon_1/services/service_svc_1_new_jpg';
const assetId = 'asset_AbCdEfGhIjKlMnOp';

function service(imageUrl: string | null = oldUrl) {
  return {
    id: 'svc_1',
    salonId: 'salon_1',
    name: 'Gel Manicure',
    slug: 'gel-manicure',
    description: null,
    descriptionItems: null,
    price: 5000,
    priceDisplayText: null,
    durationMinutes: 60,
    preparationBufferMinutes: 0,
    cleanupBufferMinutes: 0,
    category: 'manicure',
    bookingCategory: 'manicure',
    templateKey: 'gel_manicure',
    imageUrl,
    sortOrder: 1,
    featuredOrder: null,
    isActive: true,
    isIntroPrice: false,
    introPriceLabel: null,
    introPriceExpiresAt: null,
  };
}

function cloudRequest(overrides: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/salon/services/svc_1/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      salonSlug: 'isla-nail-studio',
      assetId,
      publicId,
      expectedImageUrl: oldUrl,
      timestamp: 123456,
      finalizeToken: 'a'.repeat(64),
      ...overrides,
    }),
  });
}

const context = { params: { id: 'svc_1' } };

describe('/api/salon/services/[id]/image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1', slug: 'isla-nail-studio' },
    });
    isCloudinaryConfigured.mockReturnValue(true);
    assertManagedServiceImagePublicId.mockImplementation(() => {});
    setSelectedRows([service()]);
    setUpdatedRows([service(newUrl)]);
    verifyCloudinaryServiceImage.mockResolvedValue({
      imageUrl: newUrl,
      format: 'jpg',
      bytes: 1024,
      width: 1200,
      height: 800,
    });
    saveLocalServiceImage.mockResolvedValue({
      imageUrl: '/uploads/services/salon_1/service_svc_1_AbCdEfGhIjKlMnOp.webp',
    });
    deletePendingServiceImageAssetById.mockResolvedValue(true);
    deleteManagedServiceImage.mockResolvedValue(true);
    managedCloudinaryPublicIdFromUrl.mockImplementation(
      ({ imageUrl }: { imageUrl: string }) =>
        imageUrl === newUrl ? publicId : null,
    );
    serviceImageUrlReferencesManagedPublicId.mockReturnValue(false);
    setReferenceRows([]);
    verifyServiceImageFinalizeToken.mockReturnValue(true);
    markCloudinaryServiceImageActive.mockResolvedValue(true);
  });

  it('finalizes a verified Cloudinary upload and cleans the previous managed image', async () => {
    const response = await POST(cloudRequest(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(assertManagedServiceImagePublicId).toHaveBeenCalledWith({
      publicId,
      salonId: 'salon_1',
      serviceId: 'svc_1',
    });
    expect(verifyCloudinaryServiceImage).toHaveBeenCalledWith({
      assetId,
      publicId,
      salonId: 'salon_1',
      serviceId: 'svc_1',
      finalizeToken: 'a'.repeat(64),
    });
    expect(markCloudinaryServiceImageActive).toHaveBeenCalledWith({
      publicId,
      salonId: 'salon_1',
      serviceId: 'svc_1',
    });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: newUrl }));
    expect(deleteManagedServiceImage).toHaveBeenCalledWith({
      imageUrl: oldUrl,
      salonId: 'salon_1',
      serviceId: 'svc_1',
    });
    expect(body.data.service.imageUrl).toBe(newUrl);
  });

  it('rejects a missing or cross-salon service without touching storage', async () => {
    setSelectedRows([]);

    const response = await POST(cloudRequest(), context);

    expect(response.status).toBe(404);
    expect(verifyCloudinaryServiceImage).not.toHaveBeenCalled();
    expect(deleteManagedServiceImage).not.toHaveBeenCalled();
  });

  it('rejects an app-unmanaged public id before querying Cloudinary', async () => {
    assertManagedServiceImagePublicId.mockImplementation(() => {
      throw new Error('unmanaged');
    });

    const response = await POST(cloudRequest({ publicId: 'someone/else/image' }), context);

    expect(response.status).toBe(400);
    expect(verifyCloudinaryServiceImage).not.toHaveBeenCalled();
  });

  it('rejects a public id that is not bound to the server-issued finalization token', async () => {
    verifyServiceImageFinalizeToken.mockReturnValue(false);

    const response = await POST(cloudRequest(), context);

    expect(response.status).toBe(400);
    expect(verifyCloudinaryServiceImage).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('treats replaying the currently active public id as idempotent without deleting it', async () => {
    setSelectedRows([service(newUrl)]);

    const response = await POST(
      cloudRequest({
        expectedImageUrl: newUrl,
      }),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.service.imageUrl).toBe(newUrl);
    expect(verifyCloudinaryServiceImage).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
    expect(deletePendingServiceImageAssetById).not.toHaveBeenCalled();
    expect(deleteManagedServiceImage).not.toHaveBeenCalled();
  });

  it('rejects a stale replacement without verifying or deleting anything', async () => {
    setSelectedRows([service(newUrl)]);

    const response = await POST(cloudRequest(), context);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('SERVICE_IMAGE_STALE');
    expect(verifyCloudinaryServiceImage).not.toHaveBeenCalled();
    expect(deleteManagedServiceImage).not.toHaveBeenCalled();
  });

  it('removes a failed validation upload while preserving the old database image', async () => {
    const { ServiceImageValidationError } = await import('@/libs/serviceImageStorage.server');
    verifyCloudinaryServiceImage.mockRejectedValue(
      new ServiceImageValidationError(
        'INVALID_IMAGE_CONTENT',
        'Invalid image bytes',
        assetId,
      ),
    );

    const response = await POST(cloudRequest(), context);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_IMAGE_CONTENT');
    expect(deletePendingServiceImageAssetById).toHaveBeenCalledWith({
      assetId,
      publicId,
      salonId: 'salon_1',
      serviceId: 'svc_1',
    });
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('immediately deletes an authoritatively oversized upload by immutable asset id', async () => {
    const { ServiceImageValidationError } = await import('@/libs/serviceImageStorage.server');
    verifyCloudinaryServiceImage.mockRejectedValue(
      new ServiceImageValidationError(
        'FILE_TOO_LARGE',
        'Image must be 5 MB or smaller',
        assetId,
      ),
    );

    const response = await POST(cloudRequest(), context);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('FILE_TOO_LARGE');
    expect(deletePendingServiceImageAssetById).toHaveBeenCalledWith({
      assetId,
      publicId,
      salonId: 'salon_1',
      serviceId: 'svc_1',
    });
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('never deletes an asset id whose pending binding could not be verified', async () => {
    const { ServiceImageValidationError } = await import('@/libs/serviceImageStorage.server');
    verifyCloudinaryServiceImage.mockRejectedValue(
      new ServiceImageValidationError(
        'UNMANAGED_IMAGE',
        'Upload binding mismatch',
      ),
    );

    const response = await POST(cloudRequest(), context);

    expect(response.status).toBe(400);
    expect(deletePendingServiceImageAssetById).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('preserves an upload when Cloudinary verification fails transiently', async () => {
    verifyCloudinaryServiceImage.mockRejectedValue(
      new Error('Cloudinary API unavailable'),
    );

    const response = await POST(cloudRequest(), context);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe('IMAGE_VERIFICATION_FAILED');
    expect(deletePendingServiceImageAssetById).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('compensates when the conditional database update loses a race', async () => {
    setUpdatedRows([]);

    const response = await POST(cloudRequest(), context);

    expect(response.status).toBe(409);
    expect(deletePendingServiceImageAssetById).toHaveBeenCalledWith({
      assetId,
      publicId,
      salonId: 'salon_1',
      serviceId: 'svc_1',
    });
    expect(deleteManagedServiceImage).not.toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: oldUrl }),
    );
  });

  it('does not delete the active image when another finalization of the same public id wins', async () => {
    selectRows
      .mockResolvedValueOnce([service()])
      .mockResolvedValueOnce([service(newUrl)]);
    setUpdatedRows([]);

    const response = await POST(cloudRequest(), context);

    expect(response.status).toBe(200);
    expect(deletePendingServiceImageAssetById).not.toHaveBeenCalled();
  });

  it('preserves the upload when a database error makes the update outcome ambiguous', async () => {
    updateSet.mockImplementationOnce(() => {
      throw new Error('database unavailable');
    });

    const response = await POST(cloudRequest(), context);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe('IMAGE_SAVE_FAILED');
    expect(deletePendingServiceImageAssetById).not.toHaveBeenCalled();
    expect(deleteManagedServiceImage).not.toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: oldUrl }),
    );
  });

  it('never deletes the new image when a database error occurs after its URL was committed', async () => {
    selectRows
      .mockResolvedValueOnce([service()])
      .mockResolvedValueOnce([service(newUrl)]);
    updateSet.mockImplementationOnce(() => {
      throw new Error('connection lost after commit');
    });

    const response = await POST(cloudRequest(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.service.imageUrl).toBe(newUrl);
    expect(deletePendingServiceImageAssetById).not.toHaveBeenCalled();
    expect(deleteManagedServiceImage).toHaveBeenCalledWith({
      imageUrl: oldUrl,
      salonId: 'salon_1',
      serviceId: 'svc_1',
    });
  });

  it('keeps a successfully saved new image when old-image cleanup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    deleteManagedServiceImage.mockRejectedValue(new Error('cleanup failed'));

    const response = await POST(cloudRequest(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.service.imageUrl).toBe(newUrl);
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it('preserves a previous managed image that is still referenced by another salon service', async () => {
    const oldPublicId
      = 'salons/salon_1/services/service_svc_1_AbCdEfGhIjKlMnOp_jpg';
    managedCloudinaryPublicIdFromUrl.mockImplementation(
      ({ imageUrl }: { imageUrl: string }) =>
        imageUrl === oldUrl ? oldPublicId : imageUrl === newUrl ? publicId : null,
    );
    serviceImageUrlReferencesManagedPublicId.mockReturnValue(true);
    setReferenceRows([{
      id: 'svc_other',
      imageUrl:
        `https://res.cloudinary.com/demo/image/upload/c_fill,w_600/v9/${oldPublicId}.jpg`,
    }]);

    const response = await POST(cloudRequest(), context);

    expect(response.status).toBe(200);
    expect(serviceImageUrlReferencesManagedPublicId).toHaveBeenCalledWith({
      imageUrl: expect.stringContaining('/c_fill,w_600/'),
      publicId: oldPublicId,
    });
    expect(deleteManagedServiceImage).not.toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: oldUrl }),
    );
  });

  it('fails closed and preserves an old managed image when shared-reference lookup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const oldPublicId
      = 'salons/salon_1/services/service_svc_1_AbCdEfGhIjKlMnOp_jpg';
    managedCloudinaryPublicIdFromUrl.mockImplementation(
      ({ imageUrl }: { imageUrl: string }) =>
        imageUrl === oldUrl ? oldPublicId : imageUrl === newUrl ? publicId : null,
    );
    selectReferences.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await POST(cloudRequest(), context);

    expect(response.status).toBe(200);
    expect(deleteManagedServiceImage).not.toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: oldUrl }),
    );
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('previous service image is shared'),
      expect.any(Error),
    );

    consoleError.mockRestore();
  });

  it('keeps a successfully saved image when clearing its pending tag fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    markCloudinaryServiceImageActive.mockRejectedValue(
      new Error('metadata update failed'),
    );

    const response = await POST(cloudRequest(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.service.imageUrl).toBe(newUrl);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('pending marker could not be cleared'),
      expect.any(Error),
    );

    consoleError.mockRestore();
  });

  it('uses Sharp-backed local storage only in development without Cloudinary', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    isCloudinaryConfigured.mockReturnValue(false);
    setSelectedRows([service(null)]);
    setUpdatedRows([
      service('/uploads/services/salon_1/service_svc_1_AbCdEfGhIjKlMnOp.webp'),
    ]);
    const formData = new FormData();
    formData.append('salonSlug', 'isla-nail-studio');
    formData.append('expectedImageUrl', '');
    formData.append(
      'file',
      new File(['image-bytes'], 'service.png', { type: 'image/png' }),
    );

    const response = await POST(
      new Request('http://localhost/api/salon/services/svc_1/image', {
        method: 'POST',
        body: formData,
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(saveLocalServiceImage).toHaveBeenCalledWith(
      expect.objectContaining({
        salonId: 'salon_1',
        serviceId: 'svc_1',
      }),
    );
  });

  it.each([
    [new File(['svg'], 'unsafe.svg', { type: 'image/svg+xml' }), 'INVALID_FILE_TYPE'],
    [
      new File(
        [new Uint8Array(5 * 1024 * 1024 + 1)],
        'too-large.png',
        { type: 'image/png' },
      ),
      'FILE_TOO_LARGE',
    ],
  ])('rejects an invalid development-local file before storage', async (file, expectedCode) => {
    vi.stubEnv('NODE_ENV', 'development');
    isCloudinaryConfigured.mockReturnValue(false);
    const formData = new FormData();

    formData.append('salonSlug', 'isla-nail-studio');
    formData.append('expectedImageUrl', oldUrl);
    formData.append('file', file);

    const response = await POST(
      new Request('http://localhost/api/salon/services/svc_1/image', {
        method: 'POST',
        body: formData,
      }),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe(expectedCode);
    expect(saveLocalServiceImage).not.toHaveBeenCalled();
  });

  it('rejects multipart uploads in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const formData = new FormData();
    formData.append('file', new File(['x'], 'x.png', { type: 'image/png' }));

    const response = await POST(
      new Request('http://localhost/api/salon/services/svc_1/image', {
        method: 'POST',
        body: formData,
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(saveLocalServiceImage).not.toHaveBeenCalled();
  });

  it('preserves the admin authentication response before reading or changing a service image', async () => {
    requireAdminSalon.mockResolvedValue({
      salon: null,
      error: new Response(null, { status: 403 }),
    });

    const response = await POST(cloudRequest(), context);

    expect(response.status).toBe(403);
    expect(verifyCloudinaryServiceImage).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('clears an external image without attempting destructive cleanup', async () => {
    const externalUrl = 'https://example.com/legacy.jpg';
    setSelectedRows([service(externalUrl)]);
    setUpdatedRows([service(null)]);
    deleteManagedServiceImage.mockResolvedValue(false);

    const response = await DELETE(
      new Request(
        `http://localhost/api/salon/services/svc_1/image?salonSlug=isla-nail-studio&expectedImageUrl=${encodeURIComponent(externalUrl)}`,
        { method: 'DELETE' },
      ),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: null }));
    expect(deleteManagedServiceImage).toHaveBeenCalledWith({
      imageUrl: externalUrl,
      salonId: 'salon_1',
      serviceId: 'svc_1',
    });
    expect(body.data.service.imageUrl).toBeNull();
  });

  it('does not clear the newest image for a stale removal', async () => {
    setSelectedRows([service(newUrl)]);

    const response = await DELETE(
      new Request(
        `http://localhost/api/salon/services/svc_1/image?salonSlug=isla-nail-studio&expectedImageUrl=${encodeURIComponent(oldUrl)}`,
        { method: 'DELETE' },
      ),
      context,
    );

    expect(response.status).toBe(409);
    expect(updateSet).not.toHaveBeenCalled();
    expect(deleteManagedServiceImage).not.toHaveBeenCalled();
  });
});
