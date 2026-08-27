import { render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';

import type { AssetRepository } from '../assets';
import {
  CustomDesignAssetProvider,
  useCustomDesignAssetMap,
} from './CustomDesignAssetProvider';

const repository = (
  overrides: Partial<AssetRepository> = {},
): AssetRepository => ({
  clear: vi.fn().mockResolvedValue(0),
  close: vi.fn(),
  commit: vi.fn(),
  commitBatch: vi.fn(),
  delete: vi.fn(),
  deleteDatabase: vi.fn(),
  discard: vi.fn(),
  get: vi.fn(),
  getMetadata: vi.fn(),
  getOriginal: vi.fn().mockResolvedValue(null),
  getThumbnail: vi.fn().mockResolvedValue(null),
  has: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  stage: vi.fn(),
  ...overrides,
});

function AssetMapProbe({ assetIds }: { assetIds: readonly string[] }) {
  const states = useCustomDesignAssetMap(assetIds);
  return (
    <ul>
      {[...states.entries()].map(([assetId, pair]) => (
        <li key={assetId}>
          {assetId}:{pair.original.status}:{pair.thumbnail.status}
        </li>
      ))}
    </ul>
  );
}

describe('CustomDesignAssetProvider', () => {
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  afterEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
  });

  it('owns a dynamic map of original and thumbnail leases with distinct states', async () => {
    const createObjectURL = vi.fn(() => 'blob:owner-original');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    const original = new Blob(['original'], { type: 'image/png' });
    const assets = repository({
      getOriginal: vi.fn().mockResolvedValue(original),
      getThumbnail: vi.fn().mockResolvedValue(null),
    });

    const view = render(
      <CustomDesignAssetProvider
        getReachableAssetIds={() => new Set(['asset-one'])}
        repository={assets}
      >
        <AssetMapProbe assetIds={['asset-one', 'asset-one']} />
      </CustomDesignAssetProvider>,
    );

    expect(await screen.findByText('asset-one:ready:missing')).toBeVisible();
    expect(assets.getOriginal).toHaveBeenCalledOnce();
    expect(assets.getThumbnail).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:owner-original');
  });

  it('distinguishes storage errors from missing blobs', async () => {
    const assets = repository({
      getOriginal: vi.fn().mockRejectedValue(new Error('read denied')),
      getThumbnail: vi.fn().mockResolvedValue(null),
    });
    render(
      <CustomDesignAssetProvider
        getReachableAssetIds={() => new Set()}
        repository={assets}
      >
        <AssetMapProbe assetIds={['asset-error']} />
      </CustomDesignAssetProvider>,
    );

    expect(await screen.findByText('asset-error:error:missing')).toBeVisible();
  });

  it('does not leak a URL through StrictMode setup and cleanup probes', async () => {
    const createObjectURL = vi.fn(() => 'blob:strict');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    const assets = repository({
      getOriginal: vi.fn().mockResolvedValue(
        new Blob(['strict'], { type: 'image/png' }),
      ),
    });
    const view = render(
      <StrictMode>
        <CustomDesignAssetProvider
          getReachableAssetIds={() => new Set(['strict'])}
          repository={assets}
        >
          <AssetMapProbe assetIds={['strict']} />
        </CustomDesignAssetProvider>
      </StrictMode>,
    );

    expect(await screen.findByText('strict:ready:missing')).toBeVisible();
    expect(createObjectURL).toHaveBeenCalledOnce();
    view.unmount();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledOnce());
  });
});
