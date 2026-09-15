import { describe, expect, it } from 'vitest';

import {
  buildResolvedMenuOrder,
  parseMenuOrderIntent,
  requiresNamedSelection,
} from './menuOrderParser';

const menu = [
  { id: 'gel', name: 'Gel manicure', sortOrder: 1 },
  { id: 'pedi', name: 'Pedicure', sortOrder: 2 },
  { id: 'art', name: 'Nail art', sortOrder: 3 },
];

describe('menu order assistant parser', () => {
  it('accepts the bounded move grammar and derives a complete order', () => {
    const intent = parseMenuOrderIntent(' Move "Nail art" before Gel manicure ');

    expect(intent).toEqual({
      sourceName: 'Nail art',
      targetName: 'Gel manicure',
      placement: 'before',
    });
    expect(buildResolvedMenuOrder(menu, intent!)).toMatchObject({
      sourceId: 'art',
      targetId: 'gel',
      orderedIds: ['art', 'gel', 'pedi'],
    });
  });

  it('does not interpret unrelated or partial text as a mutation', () => {
    expect(parseMenuOrderIntent('put gel first')).toBeNull();
    expect(requiresNamedSelection(menu, {
      sourceName: 'Gel',
      targetName: 'Pedicure',
      placement: 'before',
    })).toBe(true);
  });

  it('requires a selection when exact names are duplicated and rejects same-service moves', () => {
    const duplicated = [...menu, { id: 'gel-2', name: 'Gel Manicure', sortOrder: 4 }];
    const intent = { sourceName: 'Gel manicure', targetName: 'Pedicure', placement: 'after' } as const;

    expect(requiresNamedSelection(duplicated, intent)).toBe(true);
    expect(buildResolvedMenuOrder(menu, {
      sourceName: 'Gel manicure',
      targetName: 'Gel manicure',
      placement: 'after',
    })).toBeNull();
  });

  it('preserves server order when some legacy sort orders are null', () => {
    const legacyOrder = [
      { id: 'a', name: 'A', sortOrder: 10 },
      { id: 'b', name: 'B', sortOrder: 20 },
      { id: 'c', name: 'C', sortOrder: null },
      { id: 'd', name: 'D', sortOrder: null },
    ];

    expect(buildResolvedMenuOrder(legacyOrder, {
      sourceName: 'A',
      targetName: 'B',
      placement: 'after',
    })?.orderedIds).toEqual(['b', 'a', 'c', 'd']);
  });
});
