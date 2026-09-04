import { Blob as NodeBlob } from 'node:buffer';

import { IDBFactory } from 'fake-indexeddb';

import { IndexedDbAssetRepository } from './IndexedDbAssetRepository';
import {
  collectReferencedAssetIds,
  collectReferencedAssetIdsFromSnapshots,
  deleteUnreferencedAssets,
  mergeAssetReferenceSets,
  reclaimStaleStagedAssets,
} from './references';
import type { AssetRepository, PreparedImageAsset } from './types';

const makeAsset = (id: string): PreparedImageAsset => {
  const blob = new NodeBlob([id], { type: 'image/png' }) as unknown as Blob;
  return {
    blob,
    metadata: {
      aspectRatio: 1,
      byteSize: blob.size,
      createdAt: '2026-08-27T12:00:00.000Z',
      fileName: `${id}.png`,
      height: 100,
      id,
      mimeType: 'image/png',
      orientation: 1,
      width: 100,
    },
  };
};

describe('custom design asset references', () => {
  it('collects direct section references and merges document/history sets', () => {
    const current = collectReferencedAssetIds([
      { images: [{ assetId: 'current-a' }, { assetId: 'current-b' }] },
      { images: [{ assetId: 'current-a' }, { assetId: ' ' }] },
    ]);
    const history = new Set(['history-only']);

    expect([...current].sort()).toEqual(['current-a', 'current-b']);
    expect([...mergeAssetReferenceSets(current, history)].sort()).toEqual([
      'current-a',
      'current-b',
      'history-only',
    ]);
  });

  it('conservatively scans nested history-like and circular snapshots', () => {
    const snapshot: Record<string, unknown> = {
      document: {
        pages: [
          {
            sections: [
              {
                sectionType: 'custom_design',
                settings: {
                  images: [
                    {
                      assetId: 'document-asset',
                      interactiveAreas: [{ id: 'area', label: 'Book' }],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      past: [{ removed: { assetId: 'undo-asset' } }],
    };
    snapshot.self = snapshot;

    expect(
      [...collectReferencedAssetIdsFromSnapshots([snapshot])].sort(),
    ).toEqual(['document-asset', 'undo-asset']);
  });

  it('deletes only committed, unreferenced assets and never staged uploads', async () => {
    const repository = new IndexedDbAssetRepository({
      dbName: 'cleanup',
      indexedDB: new IDBFactory(),
    });
    for (const id of ['keep', 'remove-a', 'remove-b']) {
      await repository.stage(makeAsset(id));
      await repository.commit(id);
    }
    await repository.stage(makeAsset('upload-in-progress'));

    const onDeleted = vi.fn();
    const result = await deleteUnreferencedAssets(
      repository,
      new Set(['keep', 'history-reference']),
      {
        confirmUnreferenced: vi.fn().mockResolvedValue(true),
        onDeleted,
      },
    );

    expect(result).toEqual({
      deleted: ['remove-a', 'remove-b'],
      failed: [],
      retained: ['keep'],
    });
    expect(await repository.has('keep')).toBe(true);
    expect(
      await repository.has('upload-in-progress', { includeStaged: true }),
    ).toBe(true);
    expect(await repository.has('remove-a')).toBe(false);
    expect(onDeleted.mock.calls.flat().sort()).toEqual(['remove-a', 'remove-b']);

    repository.close();
  });

  it('reports per-asset deletion failures without risking referenced IDs', async () => {
    const keep = { ...makeAsset('keep'), state: 'committed' as const };
    const fail = { ...makeAsset('fail'), state: 'committed' as const };
    const repository = {
      delete: vi.fn(async (assetId: string) => {
        if (assetId === 'fail') {
          throw new Error('denied');
        }
        return true;
      }),
      list: vi.fn().mockResolvedValue([keep, fail]),
    } as unknown as AssetRepository;

    const onDeleted = vi.fn();
    const result = await deleteUnreferencedAssets(repository, new Set(['keep']), {
      confirmUnreferenced: vi.fn().mockResolvedValue(true),
      onDeleted,
    });

    expect(repository.delete).not.toHaveBeenCalledWith('keep');
    expect(onDeleted).not.toHaveBeenCalled();
    expect(result.retained).toEqual(['keep']);
    expect(result.failed).toMatchObject([
      { assetId: 'fail', error: { message: 'denied' } },
    ]);
  });

  it('rechecks authoritative references immediately before delete', async () => {
    const summaries = ['first', 'late-reference'].map(id => ({
      metadata: makeAsset(id).metadata,
      stagedAt: '2026-08-27T12:00:00.000Z',
      state: 'committed' as const,
    }));
    const liveReferences = new Set<string>();
    const repository = {
      delete: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue(summaries),
    } as unknown as AssetRepository;
    const onDeleted = vi.fn((assetId: string) => {
      if (assetId === 'first') {
        liveReferences.add('late-reference');
      }
    });

    const result = await deleteUnreferencedAssets(repository, new Set(), {
      confirmUnreferenced: async assetId => !liveReferences.has(assetId),
      onDeleted,
    });

    expect(repository.delete).toHaveBeenCalledTimes(1);
    expect(repository.delete).toHaveBeenCalledWith('first');
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(onDeleted).toHaveBeenCalledWith('first');
    expect(result).toEqual({
      deleted: ['first'],
      failed: [],
      retained: ['late-reference'],
    });
  });

  it('reclaims only expired, unprotected stages after final confirmation', async () => {
    const day = 24 * 60 * 60 * 1000;
    const base = Date.parse('2026-08-20T12:00:00.000Z');
    let clock = base;
    const repository = new IndexedDbAssetRepository({
      dbName: 'stale-stages',
      indexedDB: new IDBFactory(),
      now: () => clock,
    });
    for (const id of ['expired', 'protected', 'confirmation-declined']) {
      await repository.stage(makeAsset(id));
    }
    clock += day * 2;
    await repository.stage(makeAsset('recent'));
    const onDiscarded = vi.fn();
    const confirmDiscard = vi.fn(
      async (assetId: string) => assetId !== 'confirmation-declined',
    );

    const result = await reclaimStaleStagedAssets(repository, {
      confirmDiscard,
      now: clock,
      onDiscarded,
      protectedAssetIds: new Set(['protected']),
      ttlMs: day,
    });

    expect(result).toEqual({
      discarded: ['expired'],
      failed: [],
      retained: ['confirmation-declined', 'protected', 'recent'],
    });
    expect(confirmDiscard.mock.calls.map(([assetId]) => assetId).sort()).toEqual([
      'confirmation-declined',
      'expired',
    ]);
    expect(onDiscarded).toHaveBeenCalledOnce();
    expect(onDiscarded).toHaveBeenCalledWith('expired');
    expect(
      await repository.has('expired', { includeStaged: true }),
    ).toBe(false);
    expect(
      await repository.has('protected', { includeStaged: true }),
    ).toBe(true);

    repository.close();
  });
});
