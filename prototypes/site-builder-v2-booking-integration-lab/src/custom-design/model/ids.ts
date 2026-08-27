export type CustomDesignEntityKind = 'section' | 'image' | 'asset' | 'area';
export type CustomDesignIdFactory = (kind: CustomDesignEntityKind) => string;

const randomId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
};

export const createCustomDesignIdFactory = (): CustomDesignIdFactory =>
  (kind) => `custom_design_${kind}_${randomId()}`;

export const createDeterministicCustomDesignIdFactory = (
  seed = 'test',
): CustomDesignIdFactory => {
  const counts: Record<CustomDesignEntityKind, number> = {
    section: 0,
    image: 0,
    asset: 0,
    area: 0,
  };

  return (kind) => {
    counts[kind] += 1;
    return `custom_design_${kind}_${seed}_${counts[kind]}`;
  };
};
