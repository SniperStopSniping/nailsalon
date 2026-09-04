import {
  CANONICAL_SALON,
  CANONICAL_SERVICES,
  CATEGORY_DEFINITIONS,
  deepFreeze,
  MOCK_ADD_ONS,
} from './data';
import type {
  BookingSelection,
  BookingSessionState,
  ImageFixture,
  MenuSize,
  MockAddOn,
  MockMenuFixture,
  MockPrice,
  MockService,
  SelectionPriceSummary,
  SelectionSummary,
  ServiceCategory,
} from './types';

export const EMPTY_BOOKING_SELECTION: BookingSelection = deepFreeze({
  serviceId: null,
  addOnIds: [],
});

export const EMPTY_BOOKING_SESSION: BookingSessionState = deepFreeze({
  selection: EMPTY_BOOKING_SELECTION,
  query: '',
  activeCategory: 'all',
  detailServiceId: null,
  draftAddOnIds: [],
  handoffOpen: false,
});

export function createEmptyBookingSession(): BookingSessionState {
  return {
    selection: { serviceId: null, addOnIds: [] },
    query: '',
    activeCategory: 'all',
    detailServiceId: null,
    draftAddOnIds: [],
    handoffOpen: false,
  };
}

/** Preserve committed customer intent while clearing layout-specific discovery UI. */
export function normalizeSessionForLayoutChange(
  session: BookingSessionState,
): BookingSessionState {
  return {
    ...session,
    query: '',
    activeCategory: 'all',
    detailServiceId: null,
    draftAddOnIds: [],
    handoffOpen: false,
  };
}

const CATEGORY_LABELS = new Map(
  CATEGORY_DEFINITIONS.map(category => [category.id, category.label]),
);

const STRESS_CATEGORY_TOTALS = {
  manicure: 30,
  builder_gel: 20,
  gel_x: 18,
  pedicure: 16,
  nail_art: 10,
  combos: 1,
  add_ons: 5,
} as const satisfies Record<ServiceCategory, number>;

const fixtureCache = new Map<string, MockMenuFixture>();

function createStressServices(): readonly MockService[] {
  const services: MockService[] = [];

  for (const category of CATEGORY_DEFINITIONS) {
    const templates = CANONICAL_SERVICES.filter(service => service.category === category.id);
    const total = STRESS_CATEGORY_TOTALS[category.id];

    for (let index = 0; index < total; index += 1) {
      const template = templates[index % templates.length];
      if (!template) {
        throw new Error(`Missing stress fixture template for ${category.id}.`);
      }

      const ordinal = index + 1;
      const variation = Math.floor(index / templates.length) + 1;
      const isVeryLongName = category.id === 'manicure' && ordinal === total;
      const isVeryLongDescription = category.id === 'builder_gel' && ordinal === total;
      const isMissingDescription = category.id === 'combos';

      services.push({
        ...template,
        id: `stress-${category.id}-${String(ordinal).padStart(3, '0')}`,
        name: isVeryLongName
          ? 'The Complete Structured Manicure with Precision Cuticle Care, Extended Shape Consultation and Bespoke Multi-Finish Nail Art'
          : variation === 1
            ? template.name
            : `${template.name} · Studio variation ${String(variation).padStart(2, '0')}`,
        shortDescription: isMissingDescription ? null : template.shortDescription,
        longDescription: isMissingDescription
          ? null
          : isVeryLongDescription
            ? `${template.longDescription ?? ''} This deliberately long fixture copy tests narrow layouts, high zoom, constrained cards and line wrapping without hiding duration, price or the booking action. It remains readable and must never force horizontal overflow, even when several descriptive clauses continue beyond the usual menu length.`
            : template.longDescription,
        compatibleAddOnIds: [...template.compatibleAddOnIds],
      });
    }
  }

  return deepFreeze(services);
}

const STRESS_SERVICES = createStressServices();

function applyImageFixture(
  services: readonly MockService[],
  imageFixture: ImageFixture,
): readonly MockService[] {
  if (imageFixture === 'image_rich') {
    return services;
  }

  return deepFreeze(services.map((service, index) => ({
    ...service,
    image: imageFixture === 'partial_images' && index % 2 === 0
      ? service.image
      : null,
    compatibleAddOnIds: [...service.compatibleAddOnIds],
  })));
}

export function createMenuFixture(options: {
  imageFixture?: ImageFixture;
  menuSize?: MenuSize;
} = {}): MockMenuFixture {
  const imageFixture = options.imageFixture ?? 'image_rich';
  const menuSize = options.menuSize ?? 'canonical';
  const cacheKey = `${menuSize}:${imageFixture}`;
  const cached = fixtureCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const baseServices = menuSize === 'stress_100'
    ? STRESS_SERVICES
    : CANONICAL_SERVICES;
  const fixture = deepFreeze<MockMenuFixture>({
    salon: CANONICAL_SALON,
    categories: CATEGORY_DEFINITIONS,
    services: applyImageFixture(baseServices, imageFixture),
    addOns: MOCK_ADD_ONS,
    imageFixture,
    menuSize,
  });

  fixtureCache.set(cacheKey, fixture);
  return fixture;
}

export type ServiceFilter = {
  readonly query?: string;
  readonly category?: ServiceCategory | 'all';
};

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-US')
    .trim();
}

export function filterServices(
  services: readonly MockService[],
  filter: ServiceFilter,
): readonly MockService[] {
  const category = filter.category ?? 'all';
  const query = normalizeSearchText(filter.query ?? '');

  return services.filter((service) => {
    if (category !== 'all' && service.category !== category) {
      return false;
    }

    if (!query) {
      return true;
    }

    const searchableText = normalizeSearchText([
      service.name,
      CATEGORY_LABELS.get(service.category) ?? service.category,
      service.shortDescription ?? '',
      service.longDescription ?? '',
    ].join(' '));

    return searchableText.includes(query);
  });
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatPrice(price: MockPrice): string {
  switch (price.behavior) {
    case 'fixed':
      return formatMoney(price.amountCents);
    case 'starts_at':
      return `From ${formatMoney(price.amountCents)}`;
    case 'range':
      return `${formatMoney(price.minCents)}–${formatMoney(price.maxCents)}`;
    case 'varies':
      return 'Price varies';
    case 'free':
      return 'Free';
  }
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const hourLabel = `${hours} hr`;
  return remainingMinutes === 0
    ? hourLabel
    : `${hourLabel} ${remainingMinutes} min`;
}

export function summarizePrice(
  price: MockPrice,
  knownAddOnPriceCents: number,
): SelectionPriceSummary {
  switch (price.behavior) {
    case 'fixed': {
      const total = price.amountCents + knownAddOnPriceCents;
      return {
        behavior: price.behavior,
        label: formatMoney(total),
        knownAddOnPriceCents,
        minTotalCents: total,
        maxTotalCents: total,
      };
    }
    case 'starts_at': {
      const total = price.amountCents + knownAddOnPriceCents;
      return {
        behavior: price.behavior,
        label: `From ${formatMoney(total)}`,
        knownAddOnPriceCents,
        minTotalCents: total,
        maxTotalCents: null,
      };
    }
    case 'range': {
      const minTotal = price.minCents + knownAddOnPriceCents;
      const maxTotal = price.maxCents + knownAddOnPriceCents;
      return {
        behavior: price.behavior,
        label: `${formatMoney(minTotal)}–${formatMoney(maxTotal)}`,
        knownAddOnPriceCents,
        minTotalCents: minTotal,
        maxTotalCents: maxTotal,
      };
    }
    case 'varies':
      return {
        behavior: price.behavior,
        label: knownAddOnPriceCents > 0
          ? `Price varies + ${formatMoney(knownAddOnPriceCents)} add-ons`
          : 'Price varies',
        knownAddOnPriceCents,
        minTotalCents: null,
        maxTotalCents: null,
      };
    case 'free':
      return {
        behavior: price.behavior,
        label: knownAddOnPriceCents > 0 ? formatMoney(knownAddOnPriceCents) : 'Free',
        knownAddOnPriceCents,
        minTotalCents: knownAddOnPriceCents,
        maxTotalCents: knownAddOnPriceCents,
      };
  }
}

export function normalizeBookingSelection(
  selection: BookingSelection,
  services: readonly MockService[] = CANONICAL_SERVICES,
  addOns: readonly MockAddOn[] = MOCK_ADD_ONS,
): BookingSelection {
  const service = services.find(candidate => candidate.id === selection.serviceId);
  if (!service) {
    return { serviceId: null, addOnIds: [] };
  }

  const knownAddOnIds = new Set(addOns.map(addOn => addOn.id));
  const compatibleAddOnIds = new Set(service.compatibleAddOnIds);
  const selectedAddOnIds = [...new Set(selection.addOnIds)]
    .filter(addOnId => knownAddOnIds.has(addOnId) && compatibleAddOnIds.has(addOnId));

  return { serviceId: service.id, addOnIds: selectedAddOnIds };
}

export function selectService(serviceId: string | null): BookingSelection {
  return serviceId
    ? { serviceId, addOnIds: [] }
    : { serviceId: null, addOnIds: [] };
}

export function toggleSelectionAddOn(
  selection: BookingSelection,
  addOnId: string,
  services: readonly MockService[] = CANONICAL_SERVICES,
  addOns: readonly MockAddOn[] = MOCK_ADD_ONS,
): BookingSelection {
  const normalized = normalizeBookingSelection(selection, services, addOns);
  if (!normalized.serviceId) {
    return normalized;
  }

  const service = services.find(candidate => candidate.id === normalized.serviceId);
  const addOnExists = addOns.some(addOn => addOn.id === addOnId);
  if (!service || !addOnExists || !service.compatibleAddOnIds.includes(addOnId)) {
    return normalized;
  }

  const nextAddOnIds = normalized.addOnIds.includes(addOnId)
    ? normalized.addOnIds.filter(selectedId => selectedId !== addOnId)
    : [...normalized.addOnIds, addOnId];

  return { serviceId: normalized.serviceId, addOnIds: nextAddOnIds };
}

export function summarizeSelection(
  selection: BookingSelection,
  services: readonly MockService[] = CANONICAL_SERVICES,
  addOns: readonly MockAddOn[] = MOCK_ADD_ONS,
): SelectionSummary | null {
  const normalized = normalizeBookingSelection(selection, services, addOns);
  const service = services.find(candidate => candidate.id === normalized.serviceId);
  if (!service) {
    return null;
  }

  const selectedAddOns = normalized.addOnIds
    .map(addOnId => addOns.find(addOn => addOn.id === addOnId))
    .filter((addOn): addOn is MockAddOn => Boolean(addOn));
  const knownAddOnPriceCents = selectedAddOns.reduce(
    (total, addOn) => total + addOn.priceCents,
    0,
  );
  const totalDurationMinutes = selectedAddOns.reduce(
    (total, addOn) => total + addOn.durationMinutes,
    service.durationMinutes,
  );

  return {
    service,
    addOns: selectedAddOns,
    totalDurationMinutes,
    durationLabel: formatDuration(totalDurationMinutes),
    price: summarizePrice(service.price, knownAddOnPriceCents),
  };
}
