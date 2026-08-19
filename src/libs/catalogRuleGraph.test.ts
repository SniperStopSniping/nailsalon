import { describe, expect, it } from 'vitest';

import type { CatalogAutoAddEdge } from './catalogRuleGraph';
import { detectAutoAddCycle, expandAutoAddClosure } from './catalogRuleGraph';

describe('detectAutoAddCycle', () => {
  it('returns null for an empty graph', () => {
    expect(detectAutoAddCycle([])).toBeNull();
  });

  it('returns null for a simple acyclic chain', () => {
    const edges: CatalogAutoAddEdge[] = [
      { from: { kind: 'service', id: 'svc1' }, toAddOnId: 'a' },
      { from: { kind: 'addOn', id: 'a' }, toAddOnId: 'b' },
    ];

    expect(detectAutoAddCycle(edges)).toBeNull();
  });

  it('detects a direct two-node cycle (a auto-adds b, b auto-adds a)', () => {
    const edges: CatalogAutoAddEdge[] = [
      { from: { kind: 'addOn', id: 'a' }, toAddOnId: 'b' },
      { from: { kind: 'addOn', id: 'b' }, toAddOnId: 'a' },
    ];
    const cycle = detectAutoAddCycle(edges);

    expect(cycle).not.toBeNull();
    expect(cycle).toContain('addOn:a');
    expect(cycle).toContain('addOn:b');
  });

  it('detects a longer transitive cycle (a -> b -> c -> a)', () => {
    const edges: CatalogAutoAddEdge[] = [
      { from: { kind: 'addOn', id: 'a' }, toAddOnId: 'b' },
      { from: { kind: 'addOn', id: 'b' }, toAddOnId: 'c' },
      { from: { kind: 'addOn', id: 'c' }, toAddOnId: 'a' },
    ];

    expect(detectAutoAddCycle(edges)).not.toBeNull();
  });

  it('a service can never be a cycle target (only add-ons are auto-add objects), so a service-rooted chain cannot cycle back to the service', () => {
    const edges: CatalogAutoAddEdge[] = [
      { from: { kind: 'service', id: 'svc1' }, toAddOnId: 'a' },
      { from: { kind: 'addOn', id: 'a' }, toAddOnId: 'b' },
      { from: { kind: 'addOn', id: 'b' }, toAddOnId: 'c' },
    ];

    expect(detectAutoAddCycle(edges)).toBeNull();
  });

  it('is deterministic regardless of input edge order', () => {
    const forward: CatalogAutoAddEdge[] = [
      { from: { kind: 'addOn', id: 'a' }, toAddOnId: 'b' },
      { from: { kind: 'addOn', id: 'b' }, toAddOnId: 'c' },
      { from: { kind: 'addOn', id: 'c' }, toAddOnId: 'a' },
    ];
    const reversed = [...forward].reverse();

    expect(detectAutoAddCycle(forward)).toEqual(detectAutoAddCycle(reversed));
  });

  it('ignores a benign diamond (two roots feeding the same add-on) as acyclic', () => {
    const edges: CatalogAutoAddEdge[] = [
      { from: { kind: 'service', id: 'svc1' }, toAddOnId: 'a' },
      { from: { kind: 'service', id: 'svc1' }, toAddOnId: 'b' },
      { from: { kind: 'addOn', id: 'a' }, toAddOnId: 'c' },
      { from: { kind: 'addOn', id: 'b' }, toAddOnId: 'c' },
    ];

    expect(detectAutoAddCycle(edges)).toBeNull();
  });
});

describe('expandAutoAddClosure', () => {
  it('returns an empty list when nothing auto-adds from the roots', () => {
    expect(expandAutoAddClosure([], [{ kind: 'service', id: 'svc1' }])).toEqual([]);
  });

  it('expands a single-hop auto-add from a service root', () => {
    const edges: CatalogAutoAddEdge[] = [
      { from: { kind: 'service', id: 'svc1' }, toAddOnId: 'a' },
    ];

    expect(expandAutoAddClosure(edges, [{ kind: 'service', id: 'svc1' }])).toEqual(['a']);
  });

  it('expands a chained auto-add transitively (a triggers b)', () => {
    const edges: CatalogAutoAddEdge[] = [
      { from: { kind: 'service', id: 'svc1' }, toAddOnId: 'a' },
      { from: { kind: 'addOn', id: 'a' }, toAddOnId: 'b' },
    ];

    expect(expandAutoAddClosure(edges, [{ kind: 'service', id: 'svc1' }])).toEqual(['a', 'b']);
  });

  it('never duplicates an add-on reachable by two different paths', () => {
    const edges: CatalogAutoAddEdge[] = [
      { from: { kind: 'service', id: 'svc1' }, toAddOnId: 'a' },
      { from: { kind: 'service', id: 'svc1' }, toAddOnId: 'b' },
      { from: { kind: 'addOn', id: 'a' }, toAddOnId: 'c' },
      { from: { kind: 'addOn', id: 'b' }, toAddOnId: 'c' },
    ];
    const closure = expandAutoAddClosure(edges, [{ kind: 'service', id: 'svc1' }]);

    expect(closure.filter(id => id === 'c')).toHaveLength(1);
  });

  it('produces the same order regardless of edge array order (deterministic wave ordering)', () => {
    const edges: CatalogAutoAddEdge[] = [
      { from: { kind: 'service', id: 'svc1' }, toAddOnId: 'z' },
      { from: { kind: 'service', id: 'svc1' }, toAddOnId: 'a' },
      { from: { kind: 'addOn', id: 'z' }, toAddOnId: 'y' },
    ];
    const reversed = [...edges].reverse();
    const roots = [{ kind: 'service' as const, id: 'svc1' }];

    expect(expandAutoAddClosure(edges, roots)).toEqual(expandAutoAddClosure(reversed, roots));
  });

  it('roots that already include an add-on can trigger further expansion from it', () => {
    const edges: CatalogAutoAddEdge[] = [
      { from: { kind: 'addOn', id: 'a' }, toAddOnId: 'b' },
    ];

    expect(expandAutoAddClosure(edges, [{ kind: 'addOn', id: 'a' }])).toEqual(['b']);
  });
});
