import type { EntityKind, IdFactory } from './types';

const randomId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
};

export const createIdFactory = (): IdFactory => (kind) => `${kind}_${randomId()}`;

export const createDeterministicIdFactory = (seed = 'test'): IdFactory => {
  const counts: Record<EntityKind, number> = {
    site: 0,
    page: 0,
    section: 0,
    navigation_item: 0,
  };

  return (kind) => {
    counts[kind] += 1;
    return `${kind}_${seed}_${counts[kind]}`;
  };
};
