import { compareIds } from '@/libs/catalogDomain';

/**
 * Luster L1 PR3 — deterministic graph validation over `include`-with-
 * `autoAdd` edges.
 *
 * PURE and BROWSER-COMPATIBLE. This module knows nothing about `catalog_rule`
 * rows, `params` shapes, or rule types — it operates on a minimal edge list
 * that `catalogResolverCore.ts` derives from `include` rules whose
 * `params.autoAdd` is true. Keeping the graph algorithm decoupled from rule
 * semantics is what lets it be tested (and trusted) on its own.
 *
 * `requires`/`exclude`/`mutually_exclusive` do not participate in this graph:
 * `requires` is validation, not a bundling edge (see the Owner ruling in
 * `catalogDomain.ts`), and `exclude`/`mutually_exclusive` are symmetric
 * conflicts, not directed edges a cycle detector would even apply to.
 */

/** A node in the auto-add graph is either "selecting this SERVICE" or "having this ADD-ON selected". */
export type CatalogAutoAddNode = {
  kind: 'service' | 'addOn';
  id: string;
};

/** One directed edge: selecting `from` auto-adds the add-on `toAddOnId`. */
export type CatalogAutoAddEdge = {
  from: CatalogAutoAddNode;
  toAddOnId: string;
};

function nodeKey(node: CatalogAutoAddNode): string {
  return `${node.kind}:${node.id}`;
}

function addOnNodeKey(addOnId: string): string {
  return nodeKey({ kind: 'addOn', id: addOnId });
}

function compareNodeKeys(a: string, b: string): number {
  return compareIds(a, b);
}

/**
 * Deterministically sorted adjacency: for every source node, the add-on ids
 * it auto-adds, in ascending id order. Building this once means the DFS
 * below always explores edges in the same order regardless of how the
 * caller's edge array was ordered.
 */
function buildAdjacency(edges: CatalogAutoAddEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    const key = nodeKey(edge.from);
    const list = adjacency.get(key) ?? [];
    list.push(edge.toAddOnId);
    adjacency.set(key, list);
  }

  for (const list of adjacency.values()) {
    list.sort(compareIds);
  }

  return adjacency;
}

/**
 * Detects a cycle in the auto-add graph and returns the cyclic path as an
 * ordered list of node keys (`"service:svc1"` / `"addOn:addon1"`), or `null`
 * when the graph is acyclic. Deterministic: node visitation order is the
 * sorted set of source node keys, and edges from a given node are always
 * explored in ascending add-on-id order — the same input always yields the
 * same reported cycle, regardless of the array order the caller built the
 * edges in.
 */
export function detectAutoAddCycle(edges: CatalogAutoAddEdge[]): string[] | null {
  const adjacency = buildAdjacency(edges);
  const startNodes = [...adjacency.keys()].sort(compareNodeKeys);

  const state = new Map<string, 'visiting' | 'done'>();
  const pathStack: string[] = [];

  const visit = (key: string): string[] | null => {
    const status = state.get(key);
    if (status === 'done') {
      return null;
    }
    if (status === 'visiting') {
      const cycleStart = pathStack.indexOf(key);
      return pathStack.slice(cycleStart).concat(key);
    }

    state.set(key, 'visiting');
    pathStack.push(key);

    const nextAddOnIds = adjacency.get(key) ?? [];
    for (const addOnId of nextAddOnIds) {
      const nextKey = addOnNodeKey(addOnId);
      const cycle = visit(nextKey);
      if (cycle) {
        return cycle;
      }
    }

    pathStack.pop();
    state.set(key, 'done');
    return null;
  };

  for (const start of startNodes) {
    const cycle = visit(start);
    if (cycle) {
      return cycle;
    }
  }

  return null;
}

/**
 * Deterministic auto-add expansion order reachable from one root selection
 * (a service, plus whichever add-ons are already selected). Breadth-first,
 * with each wave's newly-discovered add-on ids sorted before being appended
 * — so two callers who reach the same closure via a different traversal
 * still get the identical order. Assumes the graph is already known to be
 * acyclic (callers run `detectAutoAddCycle` first); a defensive iteration
 * cap prevents a runaway loop if that assumption is ever violated.
 */
export function expandAutoAddClosure(
  edges: CatalogAutoAddEdge[],
  roots: CatalogAutoAddNode[],
): string[] {
  const adjacency = buildAdjacency(edges);
  const discovered = new Set<string>();
  const order: string[] = [];

  let frontier = roots.map(nodeKey);
  const maxWaves = adjacency.size + 1;

  for (let wave = 0; wave < maxWaves && frontier.length > 0; wave++) {
    const nextAddOnIds = new Set<string>();

    for (const key of frontier) {
      for (const addOnId of adjacency.get(key) ?? []) {
        if (!discovered.has(addOnId)) {
          nextAddOnIds.add(addOnId);
        }
      }
    }

    const sortedNext = [...nextAddOnIds].sort(compareIds);
    for (const addOnId of sortedNext) {
      discovered.add(addOnId);
      order.push(addOnId);
    }

    frontier = sortedNext.map(addOnNodeKey);
  }

  return order;
}
