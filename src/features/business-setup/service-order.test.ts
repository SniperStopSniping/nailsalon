import { expect, it } from 'vitest';

import { setupServiceDisplayOrder } from './service-order';

it('uses canonical menu positions rather than alphabetical names or generated identities', () => {
  const rows = [{ id: 'a', name: 'BIAB', sortOrder: 9, createdAt: new Date(0) }, { id: 'z', name: 'Gel', sortOrder: 2, createdAt: new Date(100) }];

  expect(setupServiceDisplayOrder(rows).map(row => row.name)).toEqual(['Gel', 'BIAB']);
  expect(rows.map(row => row.id)).toEqual(['a', 'z']);
});

it('matches legacy creation order and PostgreSQL ascending null-last semantics', () => {
  const rows = [{ id: 'null-order', sortOrder: null, createdAt: new Date(0) }, { id: 'newer', sortOrder: 0, createdAt: new Date(10) }, { id: 'null-time', sortOrder: 0, createdAt: null }, { id: 'older', sortOrder: 0, createdAt: new Date(0) }];

  expect(setupServiceDisplayOrder(rows).map(row => row.id)).toEqual(['older', 'newer', 'null-time', 'null-order']);
});

it('uses a deterministic identity tiebreak only when canonical order and time match', () => {
  const rows = [{ id: 'b', sortOrder: 0, createdAt: new Date(0) }, { id: 'a', sortOrder: 0, createdAt: new Date(0) }];

  expect(setupServiceDisplayOrder(rows).map(row => row.id)).toEqual(['a', 'b']);
});
