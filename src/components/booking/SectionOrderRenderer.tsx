import { Fragment, type ReactNode } from 'react';

import type { SectionId } from '@/libs/bookingPageConfig';
import type { SectionDecisionPlan } from '@/libs/sectionRegistry';

/**
 * Layout-preserving renderer for stored section order. Production callers
 * pass the already-resolved canonical decision plan; this component does not
 * reinterpret hidden state or content readiness.
 */

export type SectionRenderers = Partial<Record<SectionId, () => ReactNode>>;

export type SectionOrderRendererProps = {
  order: readonly SectionId[];
  plan: SectionDecisionPlan;
  renderers: SectionRenderers;
};

export function SectionOrderRenderer({
  order,
  plan,
  renderers,
}: SectionOrderRendererProps) {
  const visibleIds = order.filter(id => plan.decisions[id].publicOutcome !== 'omit');

  return (
    <>
      {visibleIds.map((id) => {
        const render = renderers[id];
        if (!render) {
          return null;
        }

        return <Fragment key={id}>{render()}</Fragment>;
      })}
    </>
  );
}
