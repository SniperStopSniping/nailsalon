export type MenuService = {
  id: string;
  name: string;
  /** The context endpoint returns canonical menu order; null sort orders sort last server-side. */
  sortOrder: number | null;
};

export type MenuOrderIntent = {
  sourceName: string;
  targetName: string;
  placement: 'before' | 'after';
};

export type ResolvedMenuOrder = MenuOrderIntent & {
  sourceId: string;
  targetId: string;
  orderedIds: string[];
};

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function stripOptionalQuotes(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === '\'') && trimmed.at(-1) === quote) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Intentionally narrow, deterministic grammar for the dark-launch assistant.
 * It never guesses a service from partial text: callers must show selection
 * controls when a service name cannot be resolved exactly.
 */
export function parseMenuOrderIntent(input: string): MenuOrderIntent | null {
  const trimmed = input.trim();
  if (!trimmed.toLocaleLowerCase().startsWith('move ')) {
    return null;
  }
  const remaining = trimmed.slice('move '.length);
  const beforeIndex = remaining.toLocaleLowerCase().indexOf(' before ');
  const afterIndex = remaining.toLocaleLowerCase().indexOf(' after ');
  const placement = beforeIndex >= 0 ? 'before' : afterIndex >= 0 ? 'after' : null;
  const markerIndex = placement === 'before' ? beforeIndex : afterIndex;
  if (!placement || markerIndex < 0) {
    return null;
  }
  const markerLength = placement.length + 2;

  const sourceName = stripOptionalQuotes(remaining.slice(0, markerIndex));
  const targetName = stripOptionalQuotes(remaining.slice(markerIndex + markerLength));
  if (!sourceName || !targetName) {
    return null;
  }

  return {
    sourceName,
    targetName,
    placement,
  };
}

function exactMatches(services: readonly MenuService[], name: string): MenuService[] {
  const normalized = normalizedName(name);
  return services.filter(service => normalizedName(service.name) === normalized);
}

export function buildResolvedMenuOrder(
  services: readonly MenuService[],
  intent: MenuOrderIntent,
  selected?: { sourceId?: string; targetId?: string },
): ResolvedMenuOrder | null {
  const source = selected?.sourceId
    ? services.find(service => service.id === selected.sourceId)
    : exactMatches(services, intent.sourceName).at(0);
  const target = selected?.targetId
    ? services.find(service => service.id === selected.targetId)
    : exactMatches(services, intent.targetName).at(0);

  if (!source || !target || source.id === target.id) {
    return null;
  }

  // Do not sort client-side. The server provides canonical menu order and
  // null sort orders are intentionally last; JavaScript numeric coercion
  // would incorrectly move those null entries to the beginning.
  const ordered = services.filter(service => service.id !== source.id);
  const targetIndex = ordered.findIndex(service => service.id === target.id);
  if (targetIndex < 0) {
    return null;
  }
  ordered.splice(targetIndex + (intent.placement === 'after' ? 1 : 0), 0, source);

  return {
    ...intent,
    sourceId: source.id,
    targetId: target.id,
    orderedIds: ordered.map(service => service.id),
  };
}

export function requiresNamedSelection(
  services: readonly MenuService[],
  intent: MenuOrderIntent,
): boolean {
  return exactMatches(services, intent.sourceName).length !== 1
    || exactMatches(services, intent.targetName).length !== 1;
}
