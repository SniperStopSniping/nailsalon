import { ObjectUrlRegistry } from './ObjectUrlRegistry';

const awaitedText = new WeakMap<Blob, string>();

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
};

describe('ObjectUrlRegistry', () => {
  it('deduplicates in-flight loads and revokes at the final release', async () => {
    const pending = deferred<Blob | null>();
    const loadBlob = vi.fn(() => pending.promise);
    const createObjectURL = vi.fn(() => 'blob:luster/one');
    const revokeObjectURL = vi.fn();
    const registry = new ObjectUrlRegistry({
      createObjectURL,
      loadBlob,
      revokeObjectURL,
    });

    const first = registry.acquire('asset-one');
    const second = registry.acquire('asset-one');
    await Promise.resolve();

    expect(loadBlob).toHaveBeenCalledTimes(1);
    expect(registry.referenceCount('asset-one')).toBe(2);

    pending.resolve(new Blob(['image'], { type: 'image/png' }));

    await expect(first.state).resolves.toEqual({
      assetId: 'asset-one',
      status: 'ready',
      url: 'blob:luster/one',
    });
    await expect(second.state).resolves.toMatchObject({
      status: 'ready',
      url: 'blob:luster/one',
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    first.release();
    first.release();

    expect(registry.referenceCount('asset-one')).toBe(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    second.release();

    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:luster/one');
    expect(registry.referenceCount('asset-one')).toBe(0);
  });

  it('cancels a StrictMode-style release before load without creating a URL', async () => {
    const pending = deferred<Blob | null>();
    const createObjectURL = vi.fn(() => 'blob:unused');
    const revokeObjectURL = vi.fn();
    const registry = new ObjectUrlRegistry({
      createObjectURL,
      loadBlob: () => pending.promise,
      revokeObjectURL,
    });

    const lease = registry.acquire('slow');
    lease.release();
    pending.resolve(new Blob(['late'], { type: 'image/png' }));

    await expect(lease.state).resolves.toEqual({
      assetId: 'slow',
      status: 'cancelled',
    });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('returns typed missing and load-error states', async () => {
    const missingRegistry = new ObjectUrlRegistry({
      createObjectURL: vi.fn(),
      loadBlob: vi.fn().mockResolvedValue(null),
      revokeObjectURL: vi.fn(),
    });
    const missing = missingRegistry.acquire('missing');

    await expect(missing.state).resolves.toEqual({
      assetId: 'missing',
      status: 'missing',
    });

    missing.release();

    const errorRegistry = new ObjectUrlRegistry({
      createObjectURL: vi.fn(),
      loadBlob: vi.fn().mockRejectedValue(new Error('storage denied')),
      revokeObjectURL: vi.fn(),
    });
    const failed = errorRegistry.acquire('failed');

    await expect(failed.state).resolves.toMatchObject({
      assetId: 'failed',
      error: expect.objectContaining({ message: 'storage denied' }),
      status: 'error',
    });

    failed.release();

    const synchronousErrorRegistry = new ObjectUrlRegistry({
      createObjectURL: vi.fn(),
      loadBlob: () => {
        throw new Error('synchronous denial');
      },
      revokeObjectURL: vi.fn(),
    });
    const synchronousFailure = synchronousErrorRegistry.acquire('sync-failed');

    await expect(synchronousFailure.state).resolves.toMatchObject({
      error: expect.objectContaining({ message: 'synchronous denial' }),
      status: 'error',
    });

    synchronousFailure.release();
  });

  it('returns an error state when object URL creation itself fails', async () => {
    const registry = new ObjectUrlRegistry({
      createObjectURL: () => {
        throw new Error('URL unavailable');
      },
      loadBlob: vi
        .fn()
        .mockResolvedValue(new Blob(['image'], { type: 'image/png' })),
      revokeObjectURL: vi.fn(),
    });
    const lease = registry.acquire('no-url');

    await expect(lease.state).resolves.toMatchObject({
      error: expect.objectContaining({ message: 'URL unavailable' }),
      status: 'error',
    });

    lease.release();
  });

  it('invalidates a ready URL and permits a fresh load', async () => {
    const loadBlob = vi
      .fn()
      .mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second');
    const revokeObjectURL = vi.fn();
    const registry = new ObjectUrlRegistry({
      createObjectURL,
      loadBlob,
      revokeObjectURL,
    });
    const first = registry.acquire('asset');
    await first.state;
    registry.invalidate('asset');

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first');
    expect(registry.referenceCount('asset')).toBe(0);

    const second = registry.acquire('asset');

    await expect(second.state).resolves.toMatchObject({ url: 'blob:second' });
    expect(loadBlob).toHaveBeenCalledTimes(2);

    first.release();
    second.release();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:second');
  });

  it('revokes every live URL during teardown', async () => {
    const revokeObjectURL = vi.fn();
    const registry = new ObjectUrlRegistry({
      createObjectURL: blob => `blob:${awaitedText.get(blob)}`,
      loadBlob: async (assetId) => {
        const blob = new Blob([assetId], { type: 'image/png' });
        awaitedText.set(blob, assetId);
        return blob;
      },
      revokeObjectURL,
    });
    const first = registry.acquire('first');
    const second = registry.acquire('second');
    await Promise.all([first.state, second.state]);
    registry.teardown();

    expect(new Set(revokeObjectURL.mock.calls.flat())).toEqual(
      new Set(['blob:first', 'blob:second']),
    );
    expect(registry.referenceCount('first')).toBe(0);

    first.release();
    second.release();

    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
