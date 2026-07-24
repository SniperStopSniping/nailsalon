import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  addContext,
  apiDeleteResourcesByAssetIds,
  apiResourcesByAssetIds,
  apiResourcesByIds,
  apiResourcesByTag,
  apiSignRequest,
  isCloudinaryConfigured,
  mkdir,
  removeTag,
  unlink,
  writeFile,
} = vi.hoisted(() => ({
  addContext: vi.fn(),
  apiDeleteResourcesByAssetIds: vi.fn(),
  apiResourcesByAssetIds: vi.fn(),
  apiResourcesByIds: vi.fn(),
  apiResourcesByTag: vi.fn(),
  apiSignRequest: vi.fn(),
  isCloudinaryConfigured: vi.fn(),
  mkdir: vi.fn(),
  removeTag: vi.fn(),
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
      delete_resources_by_asset_ids: apiDeleteResourcesByAssetIds,
      resources_by_asset_ids: apiResourcesByAssetIds,
      resources_by_ids: apiResourcesByIds,
      resources_by_tag: apiResourcesByTag,
    },
    uploader: {
      add_context: addContext,
      remove_tag: removeTag,
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
  deletePendingServiceImageAssetById,
  generateServiceImagePublicId,
  listPendingServiceImageAssetsPage,
  loadPendingServiceImageAsset,
  managedCloudinaryPublicIdFromUrl,
  markCloudinaryServiceImageActive,
  saveLocalServiceImage,
  SERVICE_IMAGE_FINALIZE_MAX_AGE_SECONDS,
  SERVICE_IMAGE_MAX_BYTES,
  SERVICE_IMAGE_UPLOAD_PRESET,
  serviceImagePendingTag,
  serviceImageUrlReferencesManagedPublicId,
  ServiceImageValidationError,
  verifyCloudinaryServiceImage,
  verifyServiceImageFinalizeToken,
} from './serviceImageStorage.server';
/* eslint-enable import/first */

const salonId = 'salon_1';
const serviceId = 'svc_1';
const assetId = 'asset_AbCdEfGhIjKlMnOp1234567890';
const publicId
  = 'salons/salon_1/services/service_svc_1_AbCdEfGhIjKlMnOp_jpg';
const secureUrl
  = `https://res.cloudinary.com/demo-cloud/image/upload/v123/${publicId}.jpg`;

type SignedUpload = ReturnType<typeof createServiceImageUploadSignature>;
type MockCloudinaryResource = {
  asset_id: string;
  public_id: string;
  resource_type: string;
  type: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
  secure_url: string;
  tags: string[];
  context?: { custom: Record<string, string> };
  created_at: string;
};

function parseSignedContext(context: string): {
  custom: Record<string, string>;
} {
  const custom: Record<string, string> = {};

  for (const item of context.split('|')) {
    const separator = item.indexOf('=');
    if (separator > 0) {
      custom[item.slice(0, separator)] = item.slice(separator + 1);
    }
  }

  return { custom };
}

function pendingResource(
  signed: SignedUpload,
  override: Partial<MockCloudinaryResource> = {},
): MockCloudinaryResource {
  return {
    asset_id: assetId,
    public_id: publicId,
    resource_type: 'image',
    type: 'upload',
    format: 'jpg',
    bytes: 1000,
    width: 1200,
    height: 800,
    secure_url: secureUrl,
    tags: [signed.tags],
    context: parseSignedContext(signed.context),
    created_at: '2026-07-23T12:00:00.000Z',
    ...override,
  };
}

function activeResource(
  signed: SignedUpload,
  override: Partial<MockCloudinaryResource> = {},
): MockCloudinaryResource {
  const pending = pendingResource(signed);

  return {
    ...pending,
    tags: [],
    context: {
      custom: {
        ...pending.context!.custom,
        luster_image_state: 'active',
      },
    },
    ...override,
  };
}

describe('service image storage', () => {
  let defaultSigned: SignedUpload;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'demo-cloud');
    vi.stubEnv('CLOUDINARY_API_KEY', 'public-api-key');
    vi.stubEnv('CLOUDINARY_API_SECRET', 'private-api-secret');
    vi.stubEnv('NODE_ENV', 'test');
    isCloudinaryConfigured.mockReturnValue(true);
    apiSignRequest.mockReturnValue('signed-upload');
    removeTag.mockResolvedValue({ public_ids: [publicId] });
    addContext.mockResolvedValue({ public_ids: [publicId] });
    apiDeleteResourcesByAssetIds.mockResolvedValue({
      deleted: { [assetId]: 'deleted' },
    });
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);
    unlink.mockResolvedValue(undefined);

    defaultSigned = createServiceImageUploadSignature({
      publicId,
      salonId,
      serviceId,
      expectedImageUrl: null,
    });
    apiResourcesByAssetIds.mockResolvedValue({
      resources: [pendingResource(defaultSigned)],
    });
    apiResourcesByIds.mockResolvedValue({
      resources: [activeResource(defaultSigned)],
    });
    apiSignRequest.mockClear();
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

  it('signs fixed type, pending tag, and bound context without exposing the secret or raw finalize token', () => {
    const expectedImageUrl
      = 'https://res.cloudinary.com/demo-cloud/image/upload/v1/old.jpg';
    const signed = createServiceImageUploadSignature({
      publicId,
      salonId,
      serviceId,
      expectedImageUrl,
    });
    const context = parseSignedContext(signed.context).custom;

    expect(apiSignRequest).toHaveBeenCalledWith(
      {
        context: signed.context,
        overwrite: false,
        public_id: publicId,
        tags: signed.tags,
        timestamp: expect.any(Number),
        type: 'upload',
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
      type: 'upload',
      tags: signed.tags,
      signature: 'signed-upload',
      finalizeToken: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(context).toMatchObject({
      luster_image_state: 'pending',
      luster_salon_id: salonId,
      luster_service_id: serviceId,
      luster_deployment_scope: 'test',
      luster_finalize_token_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      luster_pending_binding_v1: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(signed.context).not.toContain(signed.finalizeToken);
    expect(JSON.stringify(signed)).not.toContain('private-api-secret');
  });

  it('binds finalization to the issued salon, service, public id, prior URL, and a short lifetime', () => {
    const timestamp = 1_700_000_000;
    const expectedImageUrl
      = 'https://res.cloudinary.com/demo-cloud/image/upload/v1/old.jpg';
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

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');

    expect(verifyServiceImageFinalizeToken({
      token,
      publicId,
      salonId,
      serviceId,
      expectedImageUrl,
      timestamp,
      nowSeconds: timestamp,
    })).toBe(false);
  });

  it('isolates pending tags and signed metadata between production and preview branches', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'feat/service-image-controls');
    const previewSigned = createServiceImageUploadSignature({
      publicId,
      salonId,
      serviceId,
      expectedImageUrl: null,
    });
    const previewResource = pendingResource(previewSigned);

    expect(previewSigned.tags).toMatch(
      /^luster_service_image_pending_v1_preview_[a-f0-9]{12}$/,
    );

    vi.stubEnv('VERCEL_ENV', 'production');
    apiResourcesByTag.mockResolvedValue({ resources: [previewResource] });

    await expect(
      listPendingServiceImageAssetsPage({ resourceType: 'image' }),
    ).resolves.toMatchObject({
      assets: [],
      skippedUnsafe: 1,
    });
    expect(serviceImagePendingTag()).toBe(
      'luster_service_image_pending_v1_prod',
    );
  });

  it('loads the immutable asset id and uses decoded Cloudinary metadata as authoritative finalization', async () => {
    const verified = await verifyCloudinaryServiceImage({
      assetId,
      publicId,
      salonId,
      serviceId,
      finalizeToken: defaultSigned.finalizeToken,
    });

    expect(apiResourcesByAssetIds).toHaveBeenCalledWith([assetId], {
      tags: true,
      context: true,
    });
    expect(verified).toEqual({
      imageUrl: secureUrl,
      format: 'jpg',
      bytes: 1000,
      width: 1200,
      height: 800,
    });
  });

  it('rejects missing pending tags, altered context, invalid bindings, and the wrong finalize token without authorizing deletion', async () => {
    const original = pendingResource(defaultSigned);
    const cases: MockCloudinaryResource[] = [
      { ...original, tags: [] },
      {
        ...original,
        context: {
          custom: {
            ...original.context!.custom,
            luster_image_state: 'active',
          },
        },
      },
      {
        ...original,
        context: {
          custom: {
            ...original.context!.custom,
            luster_salon_id: 'salon_2',
          },
        },
      },
      {
        ...original,
        context: {
          custom: {
            ...original.context!.custom,
            luster_pending_binding_v1: '0'.repeat(64),
          },
        },
      },
    ];

    for (const resource of cases) {
      apiResourcesByAssetIds.mockResolvedValueOnce({ resources: [resource] });

      await expect(
        verifyCloudinaryServiceImage({
          assetId,
          publicId,
          salonId,
          serviceId,
          finalizeToken: defaultSigned.finalizeToken,
        }),
      ).rejects.toMatchObject({
        code: 'UNMANAGED_IMAGE',
        managedAssetId: undefined,
      });
    }

    apiResourcesByAssetIds.mockResolvedValueOnce({ resources: [original] });

    await expect(
      verifyCloudinaryServiceImage({
        assetId,
        publicId,
        salonId,
        serviceId,
        finalizeToken: '0'.repeat(64),
      }),
    ).rejects.toMatchObject({
      code: 'UNMANAGED_IMAGE',
      managedAssetId: undefined,
    });
    expect(apiDeleteResourcesByAssetIds).not.toHaveBeenCalled();
  });

  it.each([
    [{ resource_type: 'video' }, 'INVALID_IMAGE'],
    [{ type: 'private' }, 'INVALID_IMAGE'],
    [{ format: 'svg' }, 'INVALID_IMAGE'],
    [{ format: 'png' }, 'INVALID_IMAGE'],
    [{ bytes: -1 }, 'INVALID_IMAGE'],
    [{ bytes: SERVICE_IMAGE_MAX_BYTES + 1 }, 'FILE_TOO_LARGE'],
    [{ width: -1 }, 'INVALID_IMAGE'],
    [{ width: 10_001 }, 'IMAGE_DIMENSIONS_TOO_LARGE'],
    [{ width: 8000, height: 6000 }, 'IMAGE_DIMENSIONS_TOO_LARGE'],
    [{ secure_url: 'https://example.com/attacker.jpg' }, 'UNMANAGED_IMAGE'],
  ])(
    'rejects unsafe authoritative metadata and identifies the proven managed asset for cleanup: %o',
    async (override, expectedCode) => {
      apiResourcesByAssetIds.mockResolvedValue({
        resources: [pendingResource(defaultSigned, override)],
      });

      await expect(
        verifyCloudinaryServiceImage({
          assetId,
          publicId,
          salonId,
          serviceId,
          finalizeToken: defaultSigned.finalizeToken,
        }),
      ).rejects.toMatchObject({
        code: expectedCode,
        managedAssetId: assetId,
      });
    },
  );

  it('lists pending assets with bounded pagination for image, video, and raw resource types', async () => {
    for (const resourceType of ['image', 'video', 'raw'] as const) {
      apiResourcesByTag.mockResolvedValueOnce({
        resources: [
          pendingResource(defaultSigned, {
            resource_type: resourceType,
            ...(resourceType === 'image'
              ? { bytes: SERVICE_IMAGE_MAX_BYTES + 1 }
              : {}),
          }),
        ],
        next_cursor: `next-${resourceType}`,
      });

      await expect(
        listPendingServiceImageAssetsPage({
          resourceType,
          maxResults: 1000,
          nextCursor: `cursor-${resourceType}`,
        }),
      ).resolves.toEqual({
        assets: [{
          assetId,
          publicId,
          salonId,
          serviceId,
          resourceType,
          deliveryType: 'upload',
          createdAt: new Date('2026-07-23T12:00:00.000Z'),
        }],
        skippedUnsafe: 0,
        nextCursor: `next-${resourceType}`,
      });

      expect(apiResourcesByTag).toHaveBeenLastCalledWith(
        serviceImagePendingTag(),
        {
          resource_type: resourceType,
          max_results: 100,
          next_cursor: `cursor-${resourceType}`,
          tags: true,
          context: true,
          direction: 'asc',
        },
      );
    }
  });

  it('skips pending-list entries with cross-salon or otherwise unsafe metadata', async () => {
    const original = pendingResource(defaultSigned);
    apiResourcesByTag.mockResolvedValue({
      resources: [
        {
          ...original,
          context: {
            custom: {
              ...original.context!.custom,
              luster_salon_id: 'salon_2',
            },
          },
        },
        {
          ...original,
          asset_id: 'short',
        },
        {
          ...original,
          public_id: 'shared/legacy-image',
        },
      ],
    });

    await expect(
      listPendingServiceImageAssetsPage({ resourceType: 'image' }),
    ).resolves.toEqual({
      assets: [],
      skippedUnsafe: 3,
      nextCursor: null,
    });
    expect(apiDeleteResourcesByAssetIds).not.toHaveBeenCalled();
  });

  it('reloads pending metadata and deletes only the immutable proven asset id', async () => {
    await expect(
      loadPendingServiceImageAsset({
        assetId,
        publicId,
        salonId,
        serviceId,
      }),
    ).resolves.toMatchObject({
      assetId,
      publicId,
      salonId,
      serviceId,
      resourceType: 'image',
    });

    await expect(
      deletePendingServiceImageAssetById({
        assetId,
        publicId,
        salonId,
        serviceId,
      }),
    ).resolves.toBe(true);

    expect(apiResourcesByAssetIds).toHaveBeenCalledWith([assetId], {
      tags: true,
      context: true,
    });
    expect(apiDeleteResourcesByAssetIds).toHaveBeenCalledWith(
      [assetId],
      { invalidate: true },
    );
  });

  it('never deletes an asset id whose latest metadata no longer matches the managed pending authorization', async () => {
    const original = pendingResource(defaultSigned);
    apiResourcesByAssetIds.mockResolvedValue({
      resources: [{
        ...original,
        context: {
          custom: {
            ...original.context!.custom,
            luster_salon_id: 'salon_2',
          },
        },
      }],
    });

    await expect(
      deletePendingServiceImageAssetById({
        assetId,
        publicId,
        salonId,
        serviceId,
      }),
    ).resolves.toBe(false);
    expect(apiDeleteResourcesByAssetIds).not.toHaveBeenCalled();
  });

  it('marks a finalized image active by removing the scoped pending tag and updating its state context', async () => {
    await expect(
      markCloudinaryServiceImageActive({
        publicId,
        salonId,
        serviceId,
      }),
    ).resolves.toBe(true);

    expect(removeTag).toHaveBeenCalledWith(
      serviceImagePendingTag(),
      [publicId],
      {
        resource_type: 'image',
        type: 'upload',
      },
    );
    expect(addContext).toHaveBeenCalledWith(
      'luster_image_state=active|luster_deployment_scope=test',
      [publicId],
      {
        resource_type: 'image',
        type: 'upload',
      },
    );
    expect(apiDeleteResourcesByAssetIds).not.toHaveBeenCalled();
  });

  it('deletes a current-scope active public id by immutable asset id', async () => {
    await expect(
      deleteCloudinaryServiceImageByPublicId({
        publicId,
        salonId,
        serviceId,
      }),
    ).resolves.toBe(true);

    expect(apiResourcesByIds).toHaveBeenCalledWith([publicId], {
      resource_type: 'image',
      type: 'upload',
      tags: true,
      context: true,
    });
    expect(apiDeleteResourcesByAssetIds).toHaveBeenCalledWith([assetId], {
      invalidate: true,
    });
  });

  it.each([
    'missing active metadata',
    'another deployment scope',
    'another salon identity',
  ])('preserves an active-looking asset with %s', async (scenario) => {
    const candidate = activeResource(defaultSigned);
    if (scenario === 'missing active metadata') {
      candidate.context = undefined;
    } else if (scenario === 'another deployment scope') {
      candidate.context!.custom.luster_deployment_scope = 'prod';
    } else {
      candidate.context!.custom.luster_salon_id = 'salon_other';
    }

    apiResourcesByIds.mockResolvedValueOnce({
      resources: [candidate],
    });

    await expect(
      deleteCloudinaryServiceImageByPublicId({
        publicId,
        salonId,
        serviceId,
      }),
    ).resolves.toBe(false);

    expect(apiDeleteResourcesByAssetIds).not.toHaveBeenCalled();
  });

  it('preserves a legacy managed-looking public id with no app metadata', async () => {
    apiResourcesByIds.mockResolvedValueOnce({
      resources: [{
        ...activeResource(defaultSigned),
        context: undefined,
      }],
    });

    await expect(
      deleteCloudinaryServiceImageByPublicId({
        publicId,
        salonId,
        serviceId,
      }),
    ).resolves.toBe(false);

    expect(apiDeleteResourcesByAssetIds).not.toHaveBeenCalled();
  });

  it('uses public image/upload when resolving an active deletion candidate', async () => {
    await deleteCloudinaryServiceImageByPublicId({
      publicId,
      salonId,
      serviceId,
    });

    expect(apiResourcesByIds).toHaveBeenCalledWith([publicId], {
      resource_type: 'image',
      type: 'upload',
      tags: true,
      context: true,
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

    expect(apiResourcesByIds).not.toHaveBeenCalled();
    expect(apiDeleteResourcesByAssetIds).not.toHaveBeenCalled();
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

    expect(apiDeleteResourcesByAssetIds).toHaveBeenCalledWith([assetId], {
      invalidate: true,
    });
  });

  it('recognizes transformed exact-cloud references without widening the deletion allowlist', () => {
    const transformed
      = `https://res.cloudinary.com/demo-cloud/image/upload/c_fill,w_600/q_auto/v456/${publicId}.jpg`;

    expect(serviceImageUrlReferencesManagedPublicId({
      imageUrl: transformed,
      publicId,
    })).toBe(true);
    expect(serviceImageUrlReferencesManagedPublicId({
      imageUrl: transformed.replace('demo-cloud', 'another-cloud'),
      publicId,
    })).toBe(false);
    expect(serviceImageUrlReferencesManagedPublicId({
      imageUrl: `${transformed}?download=1`,
      publicId,
    })).toBe(true);
    expect(serviceImageUrlReferencesManagedPublicId({
      imageUrl: transformed.replace(`${publicId}.jpg`, `${publicId}.png`),
      publicId,
    })).toBe(true);
    expect(serviceImageUrlReferencesManagedPublicId({
      imageUrl: transformed.replace(`${publicId}.jpg`, publicId),
      publicId,
    })).toBe(true);
    expect(managedCloudinaryPublicIdFromUrl({
      imageUrl: transformed,
      salonId,
      serviceId,
    })).toBeNull();
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
