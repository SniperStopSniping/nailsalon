export type AssetObjectUrlState =
  | { assetId: string; status: 'cancelled' }
  | { assetId: string; error: Error; status: 'error' }
  | { assetId: string; status: 'missing' }
  | { assetId: string; status: 'ready'; url: string };

export type AssetObjectUrlLease = {
  assetId: string;
  release: () => void;
  state: Promise<AssetObjectUrlState>;
};

export type ObjectUrlRegistryOptions = {
  createObjectURL?: (blob: Blob) => string;
  loadBlob: (assetId: string) => Promise<Blob | null>;
  revokeObjectURL?: (url: string) => void;
};

type RegistryEntry = {
  assetId: string;
  invalidated: boolean;
  references: number;
  result?: Promise<AssetObjectUrlState>;
  url?: string;
};

const normalizeError = (error: unknown): Error =>
  error instanceof Error ? error : new Error('The image could not be loaded.');

export class ObjectUrlRegistry {
  private readonly createUrl: (blob: Blob) => string;
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly loadBlob: (assetId: string) => Promise<Blob | null>;
  private readonly revokeUrl: (url: string) => void;

  constructor(options: ObjectUrlRegistryOptions) {
    this.loadBlob = options.loadBlob;
    this.createUrl
      = options.createObjectURL ?? (blob => globalThis.URL.createObjectURL(blob));
    this.revokeUrl
      = options.revokeObjectURL ?? (url => globalThis.URL.revokeObjectURL(url));
  }

  acquire = (assetId: string): AssetObjectUrlLease => {
    let entry = this.entries.get(assetId);
    if (!entry) {
      entry = {
        assetId,
        invalidated: false,
        references: 0,
      };
      this.entries.set(assetId, entry);
    }

    entry.references += 1;
    let active = true;
    const acquiredEntry = entry;
    const state = this.load(acquiredEntry).then((result) => {
      if (
        !active
        || acquiredEntry.invalidated
        || this.entries.get(assetId) !== acquiredEntry
      ) {
        return { assetId, status: 'cancelled' } as const;
      }
      return result;
    });

    return {
      assetId,
      release: () => {
        if (!active) {
          return;
        }
        active = false;
        this.release(acquiredEntry);
      },
      state,
    };
  };

  invalidate = (assetId: string): void => {
    const entry = this.entries.get(assetId);
    if (!entry) {
      return;
    }

    entry.invalidated = true;
    if (entry.url) {
      this.revokeUrl(entry.url);
    }
    this.entries.delete(assetId);
  };

  referenceCount = (assetId: string): number =>
    this.entries.get(assetId)?.references ?? 0;

  teardown = (): void => {
    for (const entry of this.entries.values()) {
      entry.invalidated = true;
      if (entry.url) {
        this.revokeUrl(entry.url);
      }
    }
    this.entries.clear();
  };

  private load = (entry: RegistryEntry): Promise<AssetObjectUrlState> => {
    if (entry.result) {
      return entry.result;
    }

    entry.result = Promise.resolve()
      .then(() => this.loadBlob(entry.assetId))
      .then((blob): AssetObjectUrlState => {
        if (
          entry.invalidated
          || entry.references === 0
          || this.entries.get(entry.assetId) !== entry
        ) {
          return { assetId: entry.assetId, status: 'cancelled' };
        }
        if (!blob) {
          return { assetId: entry.assetId, status: 'missing' };
        }

        try {
          const url = this.createUrl(blob);
          entry.url = url;
          return { assetId: entry.assetId, status: 'ready', url };
        } catch (error) {
          return {
            assetId: entry.assetId,
            error: normalizeError(error),
            status: 'error',
          };
        }
      })
      .catch(
        (error): AssetObjectUrlState => ({
          assetId: entry.assetId,
          error: normalizeError(error),
          status: 'error',
        }),
      );

    return entry.result;
  };

  private release = (entry: RegistryEntry): void => {
    if (entry.references > 0) {
      entry.references -= 1;
    }
    if (entry.references > 0 || this.entries.get(entry.assetId) !== entry) {
      return;
    }

    entry.invalidated = true;
    if (entry.url) {
      this.revokeUrl(entry.url);
    }
    this.entries.delete(entry.assetId);
  };
}
