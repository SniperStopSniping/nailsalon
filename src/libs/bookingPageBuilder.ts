import type {
  BookingPageConfigSide,
  BookingPageLayout,
  SectionId,
} from '@/libs/bookingPageConfig';
import {
  getAllowedSectionVariants,
  getSectionPresentationPlacement,
  isSectionVariantAllowedForLayout,
  resolveRenderableLayout,
  SECTION_PRESENTATION_CONTRACT,
  SECTION_PRESENTATION_SECTION_IDS,
} from '@/libs/sectionPresentation';
import { SECTION_REGISTRY } from '@/libs/sectionRegistry';

/**
 * Client-safe, deterministic owner customization model.
 *
 * The builder changes presentation state only. It cannot receive or return
 * salon content, renderer callbacks, arbitrary markup, style packs, or token
 * overrides. The same operations are accepted by the authenticated server
 * route, so a future automation surface cannot bypass the human UI's safety
 * contract.
 */

export type BookingPagePresentationState = Pick<
  BookingPageConfigSide,
  'layout' | 'sectionOrder' | 'sectionVariants' | 'hiddenSections'
>;

export type BookingPagePresentationPatch = {
  sectionOrder?: SectionId[];
  sectionVariants?: BookingPageConfigSide['sectionVariants'];
  hiddenSections?: SectionId[];
};

export type BookingPageBuilderOperation =
  | { type: 'set_visibility'; sectionId: SectionId; visible: boolean }
  | {
    type: 'move_section';
    sectionId: SectionId;
    targetSectionId: SectionId;
    direction: 'up' | 'down';
  }
  | { type: 'set_variant'; sectionId: SectionId; variant: string | null }
  | { type: 'reset_section'; sectionId: SectionId }
  | { type: 'reset_all' };

export type BookingPageBuilderErrorCode =
  | 'SECTION_NOT_CONFIGURABLE'
  | 'SECTION_NOT_REORDERABLE'
  | 'SECTION_NOT_IN_ORDER'
  | 'MOVE_OUT_OF_BOUNDS'
  | 'VARIANT_NOT_ALLOWED';

export type BookingPageBuilderResult =
  | { ok: true; patch: BookingPagePresentationPatch }
  | { ok: false; code: BookingPageBuilderErrorCode };

const QUICK_BOOK_STARTING_ORDER = [
  'salonProfile',
  'serviceMenu',
  'featuredServices',
  'policies',
  'socialLinks',
  'bookingCta',
] as const satisfies readonly SectionId[];

const EDITORIAL_STARTING_ORDER = [
  'salonProfile',
  'featuredServices',
  'technicianProfile',
  'portfolio',
  'reviews',
  'serviceMenu',
  'hoursLocation',
  'policies',
  'socialLinks',
  'bookingCta',
] as const satisfies readonly SectionId[];

export const BOOKING_PAGE_BUILDER_SECTION_LABELS = {
  salonProfile: 'Salon profile',
  technicianProfile: 'Technician profile',
  featuredServices: 'Featured services',
  serviceMenu: 'Services',
  whatsIncluded: 'What\'s included',
  technicianList: 'Technician list',
  portfolio: 'Portfolio',
  reviews: 'Reviews',
  hoursLocation: 'Hours & location',
  policies: 'Policies',
  socialLinks: 'Social links',
  bookingCta: 'Booking access',
} as const satisfies Record<SectionId, string>;

export const BOOKING_PAGE_BUILDER_VARIANT_LABELS = {
  compact: 'Compact',
  hero_image: 'Hero image',
  full: 'Full',
  cards: 'Cards',
  carousel: 'Carousel',
  signature: 'Signature',
  list: 'List',
  grouped_categories: 'Grouped categories',
  location_cards: 'Location cards',
  card: 'Card',
  inline: 'Inline',
  icons: 'Icons',
  labeled: 'Labeled',
  sticky: 'Sticky',
} as const satisfies Record<string, string>;

/** The shipped accessibility semantics tied to the real reorder operation. */
export const BOOKING_PAGE_BUILDER_REORDER_CONTRACT = {
  operation: 'move_section',
  keyboardControl: 'native-button',
  persistedOrderDrivesDomOrder: true,
} as const;

export const BOOKING_PAGE_BUILDER_UIQI_CAPABILITIES = {
  builderReorder: BOOKING_PAGE_BUILDER_REORDER_CONTRACT.operation === 'move_section',
  builderKeyboardReorder:
    BOOKING_PAGE_BUILDER_REORDER_CONTRACT.keyboardControl === 'native-button',
  builderDomVisualOrder:
    BOOKING_PAGE_BUILDER_REORDER_CONTRACT.persistedOrderDrivesDomOrder,
} as const;

type MutableBuilderState = {
  sectionOrder: SectionId[];
  sectionVariants: BookingPageConfigSide['sectionVariants'];
  hiddenSections: SectionId[];
};

function cloneVariantOverrides(
  variants: BookingPageConfigSide['sectionVariants'],
): BookingPageConfigSide['sectionVariants'] {
  const result: BookingPageConfigSide['sectionVariants'] = {};
  for (const sectionId of SECTION_PRESENTATION_SECTION_IDS) {
    const variant = variants[sectionId];
    if (typeof variant === 'string' && variant.trim() !== '') {
      result[sectionId] = variant;
    }
  }
  return result;
}

function cloneState(state: BookingPagePresentationState): MutableBuilderState {
  return {
    sectionOrder: [...state.sectionOrder],
    // Reads deliberately preserve legacy/future strings for known sections.
    // A builder operation may replace or clear its target, but it must not
    // normalize unrelated stored presentation state as a side effect.
    sectionVariants: cloneVariantOverrides(state.sectionVariants),
    hiddenSections: [...state.hiddenSections],
  };
}

export function resolveBookingPageStartingPresentation(
  layout: BookingPageLayout | string | null | undefined,
): MutableBuilderState {
  const renderableLayout = resolveRenderableLayout(layout);

  return {
    sectionOrder: renderableLayout === 'editorial'
      ? [...EDITORIAL_STARTING_ORDER]
      : [...QUICK_BOOK_STARTING_ORDER],
    sectionVariants: {},
    hiddenSections: [],
  };
}

export function getBookingPageBuilderSectionDefinition(
  sectionId: SectionId,
  layout: BookingPageLayout | string | null | undefined,
) {
  const registryEntry = SECTION_REGISTRY[sectionId];
  const placement = getSectionPresentationPlacement(sectionId, layout);
  const allowedVariants = getAllowedSectionVariants(sectionId, layout);
  const supported = SECTION_PRESENTATION_CONTRACT[sectionId].variants.length > 0
    && placement !== 'unsupported';

  return {
    id: sectionId,
    label: BOOKING_PAGE_BUILDER_SECTION_LABELS[sectionId],
    ownerConfigurable: registryEntry.ownerConfigurable,
    protected: !registryEntry.ownerConfigurable,
    supported,
    placement,
    reorderable: registryEntry.ownerConfigurable && supported && placement === 'flow',
    allowedVariants,
  } as const;
}

export function listBookingPageBuilderSections(
  layout: BookingPageLayout | string | null | undefined,
) {
  return SECTION_PRESENTATION_SECTION_IDS.map(sectionId => (
    getBookingPageBuilderSectionDefinition(sectionId, layout)
  ));
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameRecord(
  left: Readonly<Partial<Record<SectionId, string>>>,
  right: Readonly<Partial<Record<SectionId, string>>>,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)] as SectionId[]);

  return [...keys].every(key => left[key] === right[key]);
}

export function isBookingPagePresentationCustomized(
  state: BookingPagePresentationState,
  inherited = resolveBookingPageStartingPresentation(state.layout),
): boolean {
  return !sameValues(state.sectionOrder, inherited.sectionOrder)
    || !sameValues(state.hiddenSections, inherited.hiddenSections)
    || !sameRecord(state.sectionVariants, inherited.sectionVariants);
}

export function isBookingPageSectionCustomized(
  state: BookingPagePresentationState,
  sectionId: SectionId,
  inherited = resolveBookingPageStartingPresentation(state.layout),
): boolean {
  return state.sectionOrder.indexOf(sectionId) !== inherited.sectionOrder.indexOf(sectionId)
    || state.hiddenSections.includes(sectionId) !== inherited.hiddenSections.includes(sectionId)
    || state.sectionVariants[sectionId] !== inherited.sectionVariants[sectionId];
}

function insertAtInheritedPosition(
  order: SectionId[],
  sectionId: SectionId,
  inheritedOrder: readonly SectionId[],
): SectionId[] {
  const inheritedIndex = inheritedOrder.indexOf(sectionId);
  if (inheritedIndex === -1) {
    return order;
  }

  const following = inheritedOrder
    .slice(inheritedIndex + 1)
    .find(candidate => order.includes(candidate));
  if (following) {
    const index = order.indexOf(following);
    return [...order.slice(0, index), sectionId, ...order.slice(index)];
  }

  const preceding = inheritedOrder
    .slice(0, inheritedIndex)
    .toReversed()
    .find(candidate => order.includes(candidate));
  if (preceding) {
    const index = order.indexOf(preceding) + 1;
    return [...order.slice(0, index), sectionId, ...order.slice(index)];
  }

  return [...order, sectionId];
}

export function applyBookingPageBuilderOperation(
  current: BookingPagePresentationState,
  operation: BookingPageBuilderOperation,
  inherited = resolveBookingPageStartingPresentation(current.layout),
): BookingPageBuilderResult {
  if (operation.type === 'reset_all') {
    return {
      ok: true,
      patch: {
        sectionOrder: [...inherited.sectionOrder],
        sectionVariants: { ...inherited.sectionVariants },
        hiddenSections: [...inherited.hiddenSections],
      },
    };
  }

  const definition = getBookingPageBuilderSectionDefinition(operation.sectionId, current.layout);
  const next = cloneState(current);

  if (operation.type === 'set_visibility') {
    if (!definition.ownerConfigurable || !definition.supported) {
      return { ok: false, code: 'SECTION_NOT_CONFIGURABLE' };
    }

    const hidden = new Set(next.hiddenSections);
    if (operation.visible) {
      hidden.delete(operation.sectionId);
      if (!next.sectionOrder.includes(operation.sectionId)) {
        const bookingAccessIndex = next.sectionOrder.indexOf('bookingCta');
        const insertAt = bookingAccessIndex === -1 ? next.sectionOrder.length : bookingAccessIndex;
        next.sectionOrder.splice(insertAt, 0, operation.sectionId);
      }
    } else {
      hidden.add(operation.sectionId);
    }
    next.hiddenSections = [...hidden];
    const patch: BookingPagePresentationPatch = {};
    if (!sameValues(next.sectionOrder, current.sectionOrder)) {
      patch.sectionOrder = next.sectionOrder;
    }
    if (!sameValues(next.hiddenSections, current.hiddenSections)) {
      patch.hiddenSections = next.hiddenSections;
    }
    return {
      ok: true,
      patch,
    };
  }

  if (operation.type === 'move_section') {
    const targetDefinition = getBookingPageBuilderSectionDefinition(
      operation.targetSectionId,
      current.layout,
    );
    if (!definition.reorderable || !targetDefinition.reorderable) {
      return { ok: false, code: 'SECTION_NOT_REORDERABLE' };
    }
    if (!next.sectionOrder.includes(operation.sectionId)
      || !next.sectionOrder.includes(operation.targetSectionId)
      || next.hiddenSections.includes(operation.sectionId)
      || next.hiddenSections.includes(operation.targetSectionId)) {
      return { ok: false, code: 'SECTION_NOT_IN_ORDER' };
    }

    const currentIndex = next.sectionOrder.indexOf(operation.sectionId);
    const targetIndex = next.sectionOrder.indexOf(operation.targetSectionId);
    const targetIsInRequestedDirection = operation.direction === 'up'
      ? targetIndex < currentIndex
      : targetIndex > currentIndex;
    if (!targetIsInRequestedDirection) {
      return { ok: false, code: 'MOVE_OUT_OF_BOUNDS' };
    }

    next.sectionOrder.splice(currentIndex, 1);
    const targetIndexAfterRemoval = next.sectionOrder.indexOf(operation.targetSectionId);
    const insertionIndex = operation.direction === 'up'
      ? targetIndexAfterRemoval
      : targetIndexAfterRemoval + 1;
    next.sectionOrder.splice(insertionIndex, 0, operation.sectionId);
    return {
      ok: true,
      patch: {
        sectionOrder: next.sectionOrder,
      },
    };
  }

  if (operation.type === 'set_variant') {
    if (operation.variant !== null && !isSectionVariantAllowedForLayout(
      operation.sectionId,
      operation.variant,
      current.layout,
    )) {
      return { ok: false, code: 'VARIANT_NOT_ALLOWED' };
    }
    if (operation.variant === null) {
      delete next.sectionVariants[operation.sectionId];
    } else {
      (next.sectionVariants as Partial<Record<SectionId, string>>)[operation.sectionId]
        = operation.variant;
    }
    return { ok: true, patch: { sectionVariants: next.sectionVariants } };
  }

  const inheritedOrder = inherited.sectionOrder;
  const orderWithoutSection = next.sectionOrder.filter(sectionId => sectionId !== operation.sectionId);
  next.sectionOrder = inheritedOrder.includes(operation.sectionId)
    ? insertAtInheritedPosition(orderWithoutSection, operation.sectionId, inheritedOrder)
    : orderWithoutSection;

  const inheritedHidden = inherited.hiddenSections.includes(operation.sectionId);
  const hidden = new Set(next.hiddenSections);
  if (inheritedHidden) {
    hidden.add(operation.sectionId);
  } else {
    hidden.delete(operation.sectionId);
  }
  next.hiddenSections = [...hidden];
  const inheritedVariant = inherited.sectionVariants[operation.sectionId];
  if (inheritedVariant === undefined) {
    delete next.sectionVariants[operation.sectionId];
  } else {
    next.sectionVariants[operation.sectionId] = inheritedVariant;
  }

  const patch: BookingPagePresentationPatch = {};
  if (!sameValues(next.sectionOrder, current.sectionOrder)) {
    patch.sectionOrder = next.sectionOrder;
  }
  if (!sameValues(next.hiddenSections, current.hiddenSections)) {
    patch.hiddenSections = next.hiddenSections;
  }
  if (!sameRecord(next.sectionVariants, current.sectionVariants)) {
    patch.sectionVariants = next.sectionVariants;
  }

  return { ok: true, patch };
}

export function getBookingPageBuilderVariantLabel(variant: string): string {
  return (BOOKING_PAGE_BUILDER_VARIANT_LABELS as Readonly<Record<string, string>>)[variant]
    ?? variant.replaceAll('_', ' ');
}
