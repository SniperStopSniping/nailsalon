import { afterEach, describe, expect, it, vi } from 'vitest';

import { SavedPreviewAssetRepository } from './saved-preview-assets';

const media = {
  altText: 'Saved Canva page',
  assetId: 'server-media-id',
  fileName: 'page.webp',
  fileSize: 4,
  height: 200,
  mimeType: 'image/webp',
  publicUrl: '/api/onboarding/v1/media/server-media-id',
  role: 'custom_design' as const,
  sortOrder: 0,
  width: 100,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SavedPreviewAssetRepository', () => {
  it('loads account media through the tenant-authorized same-origin URL', async () => {
    const fetcher = vi.fn(async () => new Response(
      new Blob(['safe'], { type: 'image/webp' }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetcher);
    const repository = new SavedPreviewAssetRepository([media]);

    await expect(repository.getOriginal('server-media-id')).resolves.toBeInstanceOf(Blob);
    await expect(repository.getThumbnail('server-media-id')).resolves.toBeInstanceOf(Blob);
    await expect(repository.getMetadata('server-media-id')).resolves.toMatchObject({
      aspectRatio: 0.5,
      id: 'server-media-id',
      mimeType: 'image/webp',
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(media.publicUrl, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
  });

  it('fails closed for unknown IDs and prevents mutations in Preview', async () => {
    const repository = new SavedPreviewAssetRepository([media]);

    await expect(repository.getOriginal('browser-local-id')).resolves.toBeNull();
    await expect(repository.delete('server-media-id')).rejects.toThrow('read-only');
    await expect(repository.stage({} as never)).rejects.toThrow('read-only');
  });
});
