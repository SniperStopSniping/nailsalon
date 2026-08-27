import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  IndexedDbAssetRepository,
  ObjectUrlRegistry,
  type AssetObjectUrlState,
  type AssetRepository,
} from '../assets';
import {
  CustomDesignAssetTransactionCoordinator,
  type CustomDesignAssetTransactionCoordinatorOptions,
} from './AssetTransactionCoordinator';

export type CustomDesignAssetUrlKind = 'original' | 'thumbnail';

export type CustomDesignAssetUrlState =
  | { assetId: string; kind: CustomDesignAssetUrlKind; status: 'loading' }
  | { assetId: string; kind: CustomDesignAssetUrlKind; status: 'missing' }
  | { assetId: string; error: Error; kind: CustomDesignAssetUrlKind; status: 'error' }
  | { assetId: string; kind: CustomDesignAssetUrlKind; status: 'ready'; url: string }
  | { assetId: string; error: Error; kind: CustomDesignAssetUrlKind; status: 'unavailable' };

type AssetEnvironment = {
  coordinator: CustomDesignAssetTransactionCoordinator | null;
  epochs: ReadonlyMap<string, number>;
  originalRegistry: ObjectUrlRegistry | null;
  repository: AssetRepository | null;
  storageError: Error | null;
  thumbnailRegistry: ObjectUrlRegistry | null;
};

const AssetContext = createContext<AssetEnvironment | null>(null);

type ResourceBundle = Omit<AssetEnvironment, 'epochs'> & {
  cancelScheduledDisposal: () => void;
  scheduleDisposal: () => void;
};

export type CustomDesignAssetProviderProps = {
  children: ReactNode;
  getReachableAssetIds: CustomDesignAssetTransactionCoordinatorOptions['getReachableAssetIds'];
  onError?: (error: Error) => void;
  repository?: AssetRepository;
};

const asError = (error: unknown): Error =>
  error instanceof Error
    ? error
    : new Error('Uploaded-design storage is unavailable.');

export function CustomDesignAssetProvider({
  children,
  getReachableAssetIds,
  onError,
  repository: providedRepository,
}: CustomDesignAssetProviderProps) {
  const reachableRef = useRef(getReachableAssetIds);
  const errorRef = useRef(onError);
  reachableRef.current = getReachableAssetIds;
  errorRef.current = onError;
  const [epochs, setEpochs] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const bumpEpochs = useCallback((assetIds: readonly string[]) => {
    setEpochs((current) => {
      const next = new Map(current);
      for (const assetId of new Set(assetIds)) {
        next.set(assetId, (next.get(assetId) ?? 0) + 1);
      }
      return next;
    });
  }, []);

  const resources = useMemo<ResourceBundle>(() => {
    let repository: AssetRepository;
    let ownsRepository = false;
    try {
      repository = providedRepository ?? new IndexedDbAssetRepository();
      ownsRepository = providedRepository === undefined;
    } catch (error) {
      const storageError = asError(error);
      return {
        cancelScheduledDisposal: () => undefined,
        coordinator: null,
        originalRegistry: null,
        repository: null,
        scheduleDisposal: () => undefined,
        storageError,
        thumbnailRegistry: null,
      };
    }

    const originalRegistry = new ObjectUrlRegistry({
      loadBlob: (assetId) => repository.getOriginal(assetId),
    });
    const thumbnailRegistry = new ObjectUrlRegistry({
      loadBlob: (assetId) => repository.getThumbnail(assetId),
    });
    const coordinator = new CustomDesignAssetTransactionCoordinator({
      getReachableAssetIds: () => reachableRef.current(),
      onAssetsChanged: (assetIds) => {
        for (const assetId of assetIds) {
          originalRegistry.invalidate(assetId);
          thumbnailRegistry.invalidate(assetId);
        }
        bumpEpochs(assetIds);
      },
      onError: (error) => errorRef.current?.(error),
      repository,
    });
    let disposalTimer: number | null = null;
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      coordinator.close();
      originalRegistry.teardown();
      thumbnailRegistry.teardown();
      if (ownsRepository) repository.close();
    };

    return {
      cancelScheduledDisposal: () => {
        if (disposalTimer === null) return;
        window.clearTimeout(disposalTimer);
        disposalTimer = null;
      },
      coordinator,
      originalRegistry,
      repository,
      scheduleDisposal: () => {
        if (disposalTimer !== null || disposed) return;
        // React StrictMode immediately re-runs effects after its cleanup probe.
        // Deferring disposal one task lets that setup cancel the teardown while
        // still releasing resources after a real provider unmount.
        disposalTimer = window.setTimeout(dispose, 0);
      },
      storageError: null,
      thumbnailRegistry,
    };
  }, [bumpEpochs, providedRepository]);

  useEffect(() => {
    resources.cancelScheduledDisposal();
    return resources.scheduleDisposal;
  }, [resources]);

  const value = useMemo<AssetEnvironment>(() => ({
    coordinator: resources.coordinator,
    epochs,
    originalRegistry: resources.originalRegistry,
    repository: resources.repository,
    storageError: resources.storageError,
    thumbnailRegistry: resources.thumbnailRegistry,
  }), [epochs, resources]);

  return <AssetContext.Provider value={value}>{children}</AssetContext.Provider>;
}

const useAssetEnvironment = (): AssetEnvironment => {
  const value = useContext(AssetContext);
  if (!value) {
    throw new Error('Custom Design asset hooks require CustomDesignAssetProvider.');
  }
  return value;
};

export const useCustomDesignAssetCoordinator = ():
CustomDesignAssetTransactionCoordinator | null =>
  useAssetEnvironment().coordinator;

export const useCustomDesignAssetRepository = (): AssetRepository | null =>
  useAssetEnvironment().repository;

export const useCustomDesignAssetStorageError = (): Error | null =>
  useAssetEnvironment().storageError;

const normalizeLeaseState = (
  state: AssetObjectUrlState,
  kind: CustomDesignAssetUrlKind,
): CustomDesignAssetUrlState | null => {
  switch (state.status) {
    case 'cancelled':
      return null;
    case 'error':
      return { assetId: state.assetId, error: state.error, kind, status: 'error' };
    case 'missing':
      return { assetId: state.assetId, kind, status: 'missing' };
    case 'ready':
      return { assetId: state.assetId, kind, status: 'ready', url: state.url };
  }
};

export const useCustomDesignAssetUrl = (
  assetId: string,
  kind: CustomDesignAssetUrlKind = 'original',
): CustomDesignAssetUrlState => {
  const environment = useAssetEnvironment();
  const epoch = environment.epochs.get(assetId) ?? 0;
  const registry = kind === 'original'
    ? environment.originalRegistry
    : environment.thumbnailRegistry;
  const [state, setState] = useState<CustomDesignAssetUrlState>(() => ({
    assetId,
    kind,
    status: 'loading',
  }));

  useEffect(() => {
    if (!registry || environment.storageError) {
      setState({
        assetId,
        error: environment.storageError ?? new Error('Image storage is unavailable.'),
        kind,
        status: 'unavailable',
      });
      return undefined;
    }
    if (!assetId.trim()) {
      setState({ assetId, kind, status: 'missing' });
      return undefined;
    }

    let active = true;
    setState({ assetId, kind, status: 'loading' });
    const lease = registry.acquire(assetId);
    void lease.state.then((next) => {
      if (!active) return;
      const normalized = normalizeLeaseState(next, kind);
      if (normalized) setState(normalized);
    });
    return () => {
      active = false;
      lease.release();
    };
  }, [assetId, environment.storageError, epoch, kind, registry]);

  return state;
};

export const useCustomDesignAssetUrls = (
  assetId: string,
): {
  original: CustomDesignAssetUrlState;
  thumbnail: CustomDesignAssetUrlState;
} => ({
  original: useCustomDesignAssetUrl(assetId, 'original'),
  thumbnail: useCustomDesignAssetUrl(assetId, 'thumbnail'),
});

export type CustomDesignAssetUrlPair = {
  original: CustomDesignAssetUrlState;
  thumbnail: CustomDesignAssetUrlState;
};

/**
 * Resolves a dynamic owner image list without calling hooks in a loop. One
 * effect owns every original/thumbnail lease and releases the full set when
 * IDs, epochs, or the consuming surface change.
 */
export const useCustomDesignAssetMap = (
  assetIds: readonly string[],
): ReadonlyMap<string, CustomDesignAssetUrlPair> => {
  const environment = useAssetEnvironment();
  const uniqueIds = useMemo(
    () => [...new Set(assetIds.filter((assetId) => assetId.trim()))],
    [assetIds.join('\u0000')],
  );
  const epochSignature = uniqueIds
    .map((assetId) => `${assetId}:${environment.epochs.get(assetId) ?? 0}`)
    .join('|');
  const loadingMap = useCallback((): ReadonlyMap<string, CustomDesignAssetUrlPair> =>
    new Map(uniqueIds.map((assetId) => [assetId, {
      original: { assetId, kind: 'original', status: 'loading' },
      thumbnail: { assetId, kind: 'thumbnail', status: 'loading' },
    }])), [uniqueIds]);
  const [states, setStates] = useState<ReadonlyMap<string, CustomDesignAssetUrlPair>>(
    loadingMap,
  );

  useEffect(() => {
    if (
      !environment.originalRegistry
      || !environment.thumbnailRegistry
      || environment.storageError
    ) {
      const unavailable = environment.storageError
        ?? new Error('Image storage is unavailable.');
      setStates(new Map(uniqueIds.map((assetId) => [assetId, {
        original: { assetId, error: unavailable, kind: 'original', status: 'unavailable' },
        thumbnail: { assetId, error: unavailable, kind: 'thumbnail', status: 'unavailable' },
      }])));
      return undefined;
    }

    let active = true;
    setStates(loadingMap());
    const leases = uniqueIds.flatMap((assetId) => ([
      {
        kind: 'original' as const,
        lease: environment.originalRegistry?.acquire(assetId),
      },
      {
        kind: 'thumbnail' as const,
        lease: environment.thumbnailRegistry?.acquire(assetId),
      },
    ])).filter((entry): entry is {
      kind: CustomDesignAssetUrlKind;
      lease: NonNullable<typeof entry.lease>;
    } => Boolean(entry.lease));

    for (const { kind, lease } of leases) {
      void lease.state.then((next) => {
        if (!active) return;
        const normalized = normalizeLeaseState(next, kind);
        if (!normalized) return;
        setStates((current) => {
          const nextStates = new Map(current);
          const prior = nextStates.get(lease.assetId) ?? {
            original: {
              assetId: lease.assetId,
              kind: 'original' as const,
              status: 'loading' as const,
            },
            thumbnail: {
              assetId: lease.assetId,
              kind: 'thumbnail' as const,
              status: 'loading' as const,
            },
          };
          nextStates.set(lease.assetId, { ...prior, [kind]: normalized });
          return nextStates;
        });
      });
    }

    return () => {
      active = false;
      leases.forEach(({ lease }) => lease.release());
    };
  }, [
    environment.originalRegistry,
    environment.storageError,
    environment.thumbnailRegistry,
    epochSignature,
    loadingMap,
    uniqueIds,
  ]);

  return states;
};
