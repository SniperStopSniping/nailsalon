import { getTemplateByKey } from '../../../../../../src/libs/serviceTemplateCatalog';
import { CANONICAL_SERVICES, CATEGORY_DEFINITIONS, MOCK_ADD_ONS } from '../../../booking/data';
import { formatDuration, formatPrice } from '../../../booking/helpers';
import { ADD_ON_PRODUCTION_MAPPINGS } from '../contracts/service-menu-production-mapping';
import type {
  ServiceMenuItem,
  ServiceMenuOwnerOverride,
  ServiceMenuPort,
  ServiceMenuSelectionDraft,
} from '../contracts/service-menu';

const KNOWN_SERVICE_IDS = new Set(CANONICAL_SERVICES.map(({ id }) => id));
const KNOWN_ADD_ON_IDS = new Set(MOCK_ADD_ONS.map(({ id }) => id));
const CATEGORY_LABELS = new Map(
  CATEGORY_DEFINITIONS.map(({ id, label }) => [id, label]),
);

const LIBRARY_SERVICES = Object.freeze(CANONICAL_SERVICES.map((service) => Object.freeze({
  categoryId: service.category,
  categoryLabel: CATEGORY_LABELS.get(service.category) ?? service.category,
  durationLabel: formatDuration(service.durationMinutes),
  id: service.id,
  ...(service.image ? { imageAlt: service.image.alt, imageSrc: service.image.src } : {}),
  itemKind: 'service' as const,
  name: service.name,
  popular: service.featured,
  priceLabel: formatPrice(service.price),
} satisfies ServiceMenuItem)));

const ADD_ON_CATEGORY_LABELS: Record<string, string> = {
  nail_art: 'Nail art',
  pedicure_addon: 'Care & spa',
  removal: 'Removal',
  repair: 'Repair',
};

const LIBRARY_ADD_ONS = Object.freeze(MOCK_ADD_ONS.map((addOn) => {
  const mapping = ADD_ON_PRODUCTION_MAPPINGS.find(item => item.labServiceId === addOn.id);
  const template = mapping ? getTemplateByKey(mapping.productionCanonicalId) : undefined;
  const categoryId = template?.addOnCategory ?? 'nail_art';
  return Object.freeze({
    categoryId,
    categoryLabel: ADD_ON_CATEGORY_LABELS[categoryId] ?? categoryId,
    durationLabel: formatDuration(addOn.durationMinutes),
    id: addOn.id,
    itemKind: 'add_on' as const,
    name: addOn.name,
    popular: !addOn.id.startsWith('addon-template-') || template?.popularityRank !== undefined,
    priceLabel: (addOn.id.startsWith('addon-template-') ? template?.priceDisplayText : null)
      ?? formatPrice({ amountCents: addOn.priceCents, behavior: 'fixed' }),
  } satisfies ServiceMenuItem);
}));

const DEFAULT_SELECTED_SERVICE_IDS = Object.freeze(
  CANONICAL_SERVICES.filter(({ featured }) => featured).map(({ id }) => id),
);
const DEFAULT_SELECTED_ADD_ON_IDS = Object.freeze([
  'addon-french',
  'addon-chrome',
  'addon-simple-art',
  'addon-detailed-art',
]);

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
  const requestedAddOnIds = new Set(
    draft.selectedAddOnIds ?? DEFAULT_SELECTED_ADD_ON_IDS,
  );
  const selectedAddOnIds = MOCK_ADD_ONS
    .filter(({ id }) => requestedAddOnIds.has(id))
    .map(({ id }) => id);
  return {
    ownerOverridesByServiceId: normalizeOverrides(
      draft.ownerOverridesByServiceId,
      new Set(selectedServiceIds),
    ),
    reviewed: draft.reviewed === true,
    selectedAddOnIds,
    selectedServiceIds,
  };
};

export const createServiceTemplateMenuPort = (): ServiceMenuPort => ({
  implementation: 'product-template-library',
  createDefaultSelection: () => ({
    ownerOverridesByServiceId: {},
    reviewed: false,
    selectedAddOnIds: [...DEFAULT_SELECTED_ADD_ON_IDS],
    selectedServiceIds: [...DEFAULT_SELECTED_SERVICE_IDS],
  }),
  getCategories: () => CATEGORY_DEFINITIONS,
  getLibraryAddOns: () => LIBRARY_ADD_ONS,
  getLibraryServices: () => LIBRARY_SERVICES,
  getSelectedAddOns: (draft) => {
    const selectedIds = new Set(normalizeSelection(draft).selectedAddOnIds ?? []);
    return LIBRARY_ADD_ONS.filter(({ id }) => selectedIds.has(id));
  },
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
      selectedAddOnIds: normalized.selectedAddOnIds,
      selectedServiceIds: [...selectedIds],
    });
  },
  setAddOnSelected: (draft, addOnId, selected) => {
    const normalized = normalizeSelection(draft);
    if (!KNOWN_ADD_ON_IDS.has(addOnId)) return normalized;
    const selectedIds = new Set(normalized.selectedAddOnIds ?? []);
    if (selected) selectedIds.add(addOnId);
    else selectedIds.delete(addOnId);
    return normalizeSelection({
      ownerOverridesByServiceId: normalized.ownerOverridesByServiceId,
      reviewed: false,
      selectedAddOnIds: [...selectedIds],
      selectedServiceIds: normalized.selectedServiceIds,
    });
  },
});
