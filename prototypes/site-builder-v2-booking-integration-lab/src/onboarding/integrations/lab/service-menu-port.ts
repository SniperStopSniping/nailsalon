import { CANONICAL_SERVICES, CATEGORY_DEFINITIONS } from '../../../booking/data';
import { formatDuration, formatPrice } from '../../../booking/helpers';
import type {
  ServiceMenuItem,
  ServiceMenuOwnerOverride,
  ServiceMenuPort,
  ServiceMenuSelectionDraft,
} from '../contracts/service-menu';

const KNOWN_SERVICE_IDS = new Set(CANONICAL_SERVICES.map(({ id }) => id));
const CATEGORY_LABELS = new Map(
  CATEGORY_DEFINITIONS.map(({ id, label }) => [id, label]),
);

const LIBRARY_SERVICES = Object.freeze(CANONICAL_SERVICES.map((service) => Object.freeze({
  categoryId: service.category,
  categoryLabel: CATEGORY_LABELS.get(service.category) ?? service.category,
  durationLabel: formatDuration(service.durationMinutes),
  id: service.id,
  name: service.name,
  popular: service.featured,
  priceLabel: formatPrice(service.price),
} satisfies ServiceMenuItem)));

const DEFAULT_SELECTED_SERVICE_IDS = Object.freeze(
  CANONICAL_SERVICES.filter(({ featured }) => featured).map(({ id }) => id),
);

const normalizeOverrides = (
  overrides: Record<string, ServiceMenuOwnerOverride>,
  selectedIds: ReadonlySet<string>,
): Record<string, ServiceMenuOwnerOverride> => Object.fromEntries(
  Object.entries(overrides).flatMap(([serviceId, override]) => {
    if (!selectedIds.has(serviceId) || !KNOWN_SERVICE_IDS.has(serviceId)) return [];
    const durationMinutes = Number.isInteger(override.durationMinutes)
      && (override.durationMinutes ?? 0) > 0
      ? override.durationMinutes
      : undefined;
    const priceCents = Number.isInteger(override.priceCents)
      && (override.priceCents ?? -1) >= 0
      ? override.priceCents
      : undefined;
    if (durationMinutes === undefined && priceCents === undefined) return [];
    return [[serviceId, {
      ...(durationMinutes === undefined ? {} : { durationMinutes }),
      ...(priceCents === undefined ? {} : { priceCents }),
    }]];
  }),
);

const normalizeSelection = (
  draft: ServiceMenuSelectionDraft,
): ServiceMenuSelectionDraft => {
  const requestedIds = new Set(draft.selectedServiceIds);
  const selectedServiceIds = CANONICAL_SERVICES
    .filter(({ id }) => requestedIds.has(id))
    .map(({ id }) => id);
  return {
    ownerOverridesByServiceId: normalizeOverrides(
      draft.ownerOverridesByServiceId,
      new Set(selectedServiceIds),
    ),
    reviewed: draft.reviewed === true,
    selectedServiceIds,
  };
};

export const createLabServiceMenuPort = (): ServiceMenuPort => ({
  implementation: 'lab-only',
  createDefaultSelection: () => ({
    ownerOverridesByServiceId: {},
    reviewed: false,
    selectedServiceIds: [...DEFAULT_SELECTED_SERVICE_IDS],
  }),
  getCategories: () => CATEGORY_DEFINITIONS,
  getLibraryServices: () => LIBRARY_SERVICES,
  getSelectedServices: (draft) => {
    const selectedIds = new Set(normalizeSelection(draft).selectedServiceIds);
    return LIBRARY_SERVICES.filter(({ id }) => selectedIds.has(id));
  },
  normalizeSelection,
  setServiceSelected: (draft, serviceId, selected) => {
    const normalized = normalizeSelection(draft);
    if (!KNOWN_SERVICE_IDS.has(serviceId)) return normalized;
    const selectedIds = new Set(normalized.selectedServiceIds);
    if (selected) selectedIds.add(serviceId);
    else selectedIds.delete(serviceId);
    return normalizeSelection({
      ownerOverridesByServiceId: normalized.ownerOverridesByServiceId,
      reviewed: false,
      selectedServiceIds: [...selectedIds],
    });
  },
});
