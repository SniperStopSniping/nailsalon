import { Fragment, type ReactNode } from 'react';

import type { SectionId } from '@/libs/bookingPageConfig';
import type {
  SectionPresentationPlan,
  SectionVariantId,
} from '@/libs/sectionPresentation';
import type { SectionDecisionPlan } from '@/libs/sectionRegistry';

/** Pixel-producing owner-content sections implemented by the Stage 4 spine. */
const PIXEL_SECTION_IDS = [
  'salonProfile',
  'technicianProfile',
  'featuredServices',
  'serviceMenu',
  'hoursLocation',
  'policies',
  'socialLinks',
] as const satisfies readonly SectionId[];

export type PixelSectionId = typeof PIXEL_SECTION_IDS[number];
type SlotRenderer = (sectionId: PixelSectionId) => ReactNode;

export type SectionVariantRenderContext<
  S extends PixelSectionId,
  V extends SectionVariantId<S>,
> = {
  sectionId: S;
  variant: V;
  renderSlot: SlotRenderer;
};

export type SectionVariantRenderers = {
  [S in PixelSectionId]: {
    [V in SectionVariantId<S>]: (
      context: SectionVariantRenderContext<S, V>,
    ) => ReactNode;
  };
};

export type SectionOrderRendererProps = {
  /** Stage 2 is the only order/readiness/visibility authority. */
  plan: SectionDecisionPlan;
  /** Stage 4 controls presentation only for decisions Stage 2 admitted. */
  presentation: SectionPresentationPlan;
  /** One exhaustive, section-compatible renderer registry. */
  renderers: SectionVariantRenderers;
};

const PIXEL_SECTION_SET: ReadonlySet<SectionId> = new Set(PIXEL_SECTION_IDS);

function isPixelSectionId(sectionId: SectionId): sectionId is PixelSectionId {
  return PIXEL_SECTION_SET.has(sectionId);
}

/**
 * Canonical owner-content rendering root.
 *
 * There is intentionally no raw `order` or `hiddenSections` prop. The Stage
 * 2 plan has already made those decisions. Legacy embedded placements use
 * this same dispatcher through `renderSlot`, so they cannot resurrect an
 * omitted section or create a second layout renderer.
 */
export function SectionOrderRenderer({
  plan,
  presentation,
  renderers,
}: SectionOrderRendererProps) {
  const admittedIds = new Set(plan.orderedIds);
  const expectedPixelIds = plan.orderedIds.filter(isPixelSectionId);
  const renderedIds = new Set<PixelSectionId>();

  const renderAdmittedSection = (
    sectionId: PixelSectionId,
    host: PixelSectionId | null,
  ): ReactNode => {
    if (!admittedIds.has(sectionId)) {
      return null;
    }

    const placement = presentation.placements[sectionId];
    const placementMatches = host === null
      ? placement === 'flow'
      : placement === 'serviceMenuSlot' && host === 'serviceMenu';
    if (!placementMatches) {
      return null;
    }
    if (renderedIds.has(sectionId)) {
      throw new Error(`Section ${sectionId} was dispatched more than once.`);
    }

    const variant = presentation.variants[sectionId];
    if (!variant) {
      throw new Error(`Admitted section ${sectionId} has no safe presentation variant.`);
    }
    const sectionRenderers = renderers[sectionId] as Record<string, (
      context: SectionVariantRenderContext<PixelSectionId, never>,
    ) => ReactNode>;
    const render = sectionRenderers[variant];
    if (!render) {
      throw new Error(`No ${sectionId} renderer is registered for variant ${variant}.`);
    }

    renderedIds.add(sectionId);
    const node = render({
      sectionId,
      variant: variant as never,
      renderSlot: slotId => renderAdmittedSection(slotId, sectionId),
    });
    if (node === null || node === undefined || typeof node === 'boolean') {
      throw new Error(`Admitted section ${sectionId}:${variant} rendered no durable output.`);
    }
    return <Fragment key={sectionId}>{node}</Fragment>;
  };

  const output = plan.orderedIds.flatMap((sectionId) => {
    if (!isPixelSectionId(sectionId) || presentation.placements[sectionId] !== 'flow') {
      return [];
    }
    return [renderAdmittedSection(sectionId, null)];
  });

  const missing = expectedPixelIds.filter(sectionId => !renderedIds.has(sectionId));
  if (missing.length > 0) {
    throw new Error(`Canonical renderer did not dispatch admitted sections: ${missing.join(', ')}.`);
  }

  return <>{output}</>;
}
