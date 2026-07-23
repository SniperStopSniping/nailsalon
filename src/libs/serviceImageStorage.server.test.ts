import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  apiResource,
  apiSignRequest,
  destroy,
  isCloudinaryConfigured,
  mkdir,
  unlink,
  writeFile,
} = vi.hoisted(() => ({
  apiResource: vi.fn(),
  apiSignRequest: vi.fn(),
  destroy: vi.fn(),
  isCloudinaryConfigured: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('nanoid', () => ({
  nanoid: () => 'AbCdEfGhIjKlMnOp',
}));
vi.mock('node:fs/promises', () => ({
  mkdir,
  unlink,
  writeFile,
}));
vi.mock('@/libs/Cloudinary', () => ({
  isCloudinaryConfigured,
  cloudinary: {
    api: {
      resource: apiResource,
    },
    uploader: {
      destroy,
    },
    utils: {
      api_sign_request: apiSignRequest,
    },
  },
}));

/* eslint-disable import/first */
import {
  assertManagedServiceImagePublicId,
  createServiceImageFinalizeToken,
  createServiceImageUploadSignature,
  deleteCloudinaryServiceImageByPublicId,
  deleteManagedServiceImage,
  generateServiceImagePublicId,
  saveLocalServiceImage,
  SERVICE_IMAGE_FINALIZE_MAX_AGE_SECONDS,
  SERVICE_IMAGE_MAX_BYTES,
  SERVICE_IMAGE_UPLOAD_PRESET,
  ServiceImageValidationError,
  verifyCloudinaryServiceImage,
  verifyServiceImageFinalizeToken,
} from './serviceImageStorage.server';
/* eslint-enable import/first */

const salonId = 'salon_1';
const serviceId = 'svc_1';
const publicId
  = 'salons/salon_1/services/service_svc_1_AbCdEfGhIjKlMnOp_jpg';
const secureUrl
  = `https://res.cloudinary.com/demo-cloud/image/upload/v123/${publicId}.jpg`;

describe('service image storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'demo-cloud');
    vi.stubEnv('CLOUDINARY_API_KEY', 'public-api-key');
    vi.stubEnv('CLOUDINARY_API_SECRET', 'private-api-secret');
    vi.stubEnv('NODE_ENV', 'test');
    isCloudinaryConfigured.mockReturnValue(true);
    apiSignRequest.mockReturnValue('signed-upload');
    apiResource.mockResolvedValue({
      public_id: publicId,
      resource_type: 'image',
      type: 'upload',
      format: 'jpg',
      bytes: 1000,
      width: 1200,
      height: 800,
      secure_url: secureUrl,
    });
    destroy.mockResolvedValue({ result: 'ok' });
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);
    unlink.mockResolvedValue(undefined);
  });

  it('generates a unique app-controlled public id without a filename extension', () => {
    const generated = generateServiceImagePublicId({
      salonId,
      serviceId,
      format: 'webp',
    });

    expect(generated).toBe(
      'salons/salon_1/services/service_svc_1_AbCdEfGhIjKlMnOp_webp',
    );
    expect(generated).not.toMatch(/\.webp$/);
    expect(() =>
      assertManagedServiceImagePublicId({
        publicId: generated,
        salonId,
        serviceId,
      })).not.toThrow();
  });

  it('rejects public ids outside the authenticated salon and service prefix', () => {
    expect(() =>
      assertManagedServiceImagePublicId({
        publicId: 'salons/salon_2/services/service_svc_1_AbCdEfGhIjKlMnOp_jpg',
        salonId,
        serviceId,
      })).toThrow(ServiceImageValidationError);
  });

  it('signs the app-controlled preset and fixed upload parameters without exposing the secret', () => {
    const signed = createServiceImageUploadSignature(publicId);

    expect(apiSignRequest).toHaveBeenCalledWith(
      {
        overwrite: false,
        public_id: publicId,
        timestamp: expect.any(Number),
        upload_preset: SERVICE_IMAGE_UPLOAD_PRESET,
      },
      'private-api-secret',
    );
    expect(signed).toMatchObject({
      uploadUrl: 'https://api.cloudinary.com/v1_1/demo-cloud/image/upload',
      apiKey: 'public-api-key',
      cloudName: 'demo-cloud',
      uploadPreset: 'luster_service_images_v1',
      publicId,
      overwrite: false,
      signature: 'signed-upload',
    });
    expect(JSON.stringify(signed)).not.toContain('private-api-secret');
  });

  it('binds finalization to the issued salon, service, public id, prior URL, and a short lifetime', () => {
    const timestamp = 1_700_000_000;
    const expectedImageUrl = 'https://res.cloudinary.com/demo-cloud/image/upload/v1/old.jpg';
    const token = createServiceImageFinalizeToken({
      publicId,
      salonId,
      serviceId,
      expectedImageUrl,
      timestamp,
    });

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(token).not.toContain('private-api-secret');
    expect(verifyServiceImageFinalizeToken({
      token,
      publicId,
      salonId,
      serviceId,
      expectedImageUrl,
      timestamp,
      nowSeconds: timestamp + SERVICE_IMAGE_FINALIZE_MAX_AGE_SECONDS,
    })).toBe(true);
    expect(verifyServiceImageFinalizeToken({
      token,
      publicId,
      salonId,
      serviceId,
      expectedImageUrl: null,
      timestamp,
      nowSeconds: timestamp,
    })).toBe(false);
    expect(verifyServiceImageFinalizeToken({
      token,
      publicId,
      salonId,
      serviceId,
      expectedImageUrl,
      timestamp,
      nowSeconds: timestamp + SERVICE_IMAGE_FINALIZE_MAX_AGE_SECONDS + 1,
    })).toBe(false);
  });

  it('uses decoded Cloudinary metadata as the authoritative validation result', async () => {
    const verified = await verifyCloudinaryServiceImage({
      publicId,
      salonId,
      serviceId,
    });

    expect(apiResource).toHaveBeenCalledWith(publicId, {
      resource_type: 'image',
      type: 'upload',
    });
    expect(verified).toEqual({
      imageUrl: secureUrl,
      format: 'jpg',
      bytes: 1000,
      width: 1200,
      height: 800,
    });
  });

  it.each([
    [{ format: 'svg' }, 'INVALID_IMAGE'],
    [{ format: 'png' }, 'INVALID_IMAGE'],
    [{ bytes: -1 }, 'INVALID_IMAGE'],
    [{ bytes: SERVICE_IMAGE_MAX_BYTES + 1 }, 'FILE_TOO_LARGE'],
    [{ width: -1 }, 'INVALID_IMAGE'],
    [{ width: 10_001 }, 'IMAGE_DIMENSIONS_TOO_LARGE'],
    [{ width: 8000, height: 6000 }, 'IMAGE_DIMENSIONS_TOO_LARGE'],
    [{ secure_url: 'https://example.com/attacker.jpg' }, 'UNMANAGED_IMAGE'],
  ])('rejects unsafe decoded metadata: %o', async (override, expectedCode) => {
    apiResource.mockResolvedValue({
      public_id: publicId,
      resource_type: 'image',
      type: 'upload',
      format: 'jpg',
      bytes: 1000,
      width: 1200,
      height: 800,
      secure_url: secureUrl,
      ...override,
    });

    await expect(
      verifyCloudinaryServiceImage({ publicId, salonId, serviceId }),
    ).rejects.toMatchObject({ code: expectedCode });
  });

  it('deletes a known public id with CDN invalidation', async () => {
    await expect(
      deleteCloudinaryServiceImageByPublicId({
        publicId,
        salonId,
        serviceId,
      }),
    ).resolves.toBe(true);

    expect(destroy).toHaveBeenCalledWith(publicId, {
      resource_type: 'image',
      type: 'upload',
      invalidate: true,
    });
  });

  it('never deletes an arbitrary external or legacy URL', async () => {
    await expect(
      deleteManagedServiceImage({
        imageUrl: 'https://example.com/image.jpg',
        salonId,
        serviceId,
      }),
    ).resolves.toBe(false);
    await expect(
      deleteManagedServiceImage({
        imageUrl: '/assets/images/services/manicure-gel-nude.webp',
        salonId,
        serviceId,
      }),
    ).resolves.toBe(false);
    await expect(
      deleteManagedServiceImage({
        imageUrl:
          'https://res.cloudinary.com/demo-cloud/image/upload/v1/salons/salon_2/services/service_svc_1_AbCdEfGhIjKlMnOp_jpg.jpg',
        salonId,
        serviceId,
      }),
    ).resolves.toBe(false);
    await expect(
      deleteManagedServiceImage({
        imageUrl:
          'https://res.cloudinary.com/demo-cloud/image/upload/v1/salons/salon_1/services/legacy-service.jpg',
        salonId,
        serviceId,
      }),
    ).resolves.toBe(false);
    await expect(
      deleteManagedServiceImage({
        imageUrl: `${secureUrl}?transformation=attacker-controlled`,
        salonId,
        serviceId,
      }),
    ).resolves.toBe(false);
    await expect(
      deleteManagedServiceImage({
        imageUrl: secureUrl.replace(
          'https://res.cloudinary.com',
          'https://res.cloudinary.com:444',
        ),
        salonId,
        serviceId,
      }),
    ).resolves.toBe(false);

    expect(destroy).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('deletes only a Cloudinary URL that resolves to the managed public id', async () => {
    await expect(
      deleteManagedServiceImage({
        imageUrl: secureUrl,
        salonId,
        serviceId,
      }),
    ).resolves.toBe(true);

    expect(destroy).toHaveBeenCalledWith(publicId, expect.objectContaining({
      invalidate: true,
    }));
  });

  it('validates actual local bytes with Sharp and writes a normalized WebP under the managed root', async () => {
    isCloudinaryConfigured.mockReturnValue(false);
    vi.stubEnv('NODE_ENV', 'development');
    const png = await sharp({
      create: {
        width: 8,
        height: 6,
        channels: 3,
        background: '#ff69b4',
      },
    })
      .png()
      .toBuffer();
    const file = new File([png], 'service.png', { type: 'image/png' });

    const result = await saveLocalServiceImage({
      file,
      salonId,
      serviceId,
    });

    expect(result).toEqual({
      imageUrl:
        '/uploads/services/salon_1/service_svc_1_AbCdEfGhIjKlMnOp.webp',
    });
    expect(mkdir).toHaveBeenCalledWith(
      expect.stringMatching(/public[/\\]uploads[/\\]services[/\\]salon_1$/),
      { recursive: true },
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(
        /public[/\\]uploads[/\\]services[/\\]salon_1[/\\]service_svc_1_AbCdEfGhIjKlMnOp\.webp$/,
      ),
      expect.any(Buffer),
    );
  });

  it('rejects spoofed local MIME and invalid image bytes', async () => {
    isCloudinaryConfigured.mockReturnValue(false);
    vi.stubEnv('NODE_ENV', 'development');
    const png = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: '#fff',
      },
    })
      .png()
      .toBuffer();

    await expect(
      saveLocalServiceImage({
        file: new File([png], 'spoof.jpg', { type: 'image/jpeg' }),
        salonId,
        serviceId,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    await expect(
      saveLocalServiceImage({
        file: new File(['not-an-image'], 'bad.png', { type: 'image/png' }),
        salonId,
        serviceId,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('rejects local path traversal identifiers and all local writes in production', async () => {
    isCloudinaryConfigured.mockReturnValue(false);
    vi.stubEnv('NODE_ENV', 'development');
    const file = new File(['bytes'], 'service.png', { type: 'image/png' });

    await expect(
      saveLocalServiceImage({
        file,
        salonId: '../salon',
        serviceId,
      }),
    ).rejects.toMatchObject({ code: 'UNMANAGED_IMAGE' });

    vi.stubEnv('NODE_ENV', 'production');

    await expect(
      saveLocalServiceImage({ file, salonId, serviceId }),
    ).rejects.toMatchObject({ code: 'IMAGE_STORAGE_UNAVAILABLE' });

    expect(writeFile).not.toHaveBeenCalled();
  });

  it('deletes only the exact generated local service path outside production', async () => {
    isCloudinaryConfigured.mockReturnValue(false);
    vi.stubEnv('NODE_ENV', 'development');
    const imageUrl
      = '/uploads/services/salon_1/service_svc_1_AbCdEfGhIjKlMnOp.webp';

    await expect(
      deleteManagedServiceImage({ imageUrl, salonId, serviceId }),
    ).resolves.toBe(true);
    expect(unlink).toHaveBeenCalledWith(
      expect.stringMatching(
        /public[/\\]uploads[/\\]services[/\\]salon_1[/\\]service_svc_1_AbCdEfGhIjKlMnOp\.webp$/,
      ),
    );
  });
});
