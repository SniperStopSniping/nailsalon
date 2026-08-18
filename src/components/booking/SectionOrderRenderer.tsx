import { Fragment, type ReactNode } from 'react';

import type { SectionId } from '@/libs/bookingPageConfig';
import type { SalonContent } from '@/libs/salonContent';
import { SECTION_REGISTRY } from '@/libs/sectionRegistry';

/**
 * Thin rendering wrapper (Luster UI/UX plan rev 3, section 4A.B / PR 4 BUILD
 * step 4) that iterates a resolved `sectionOrder` and, for each id whose
 * registry `canRender(content)` passes, renders whatever the caller supplied
 * for that id in `renderers` — or nothing, if the caller did not supply one.
 *
 * This is deliberately dumb: it owns ordering and omission only, never how a
 * section looks. A caller with no renderer for a given id (e.g. Quick Book,
 * which folds `featuredServices`/`policies`/`socialLinks`/`bookingCta` into
 * a single opaque `serviceMenu` block rather than giving each its own
 * renderer — see `BookServiceClient.tsx`) simply sees that id skipped, which
 * is exactly "expressed as a section order, not a new component": the order
 * still governs what COULD render, without forcing every consumer to split
 * its markup along section boundaries before it is ready to.
 */

export type SectionRenderers = Partial<Record<SectionId, () => ReactNode>>;

export type SectionOrderRendererProps = {
  order: readonly SectionId[];
  content: SalonContent;
  renderers: SectionRenderers;
};

export function SectionOrderRenderer({ order, content, renderers }: SectionOrderRendererProps) {
  return (
    <>
      {order.map((id) => {
        const entry = SECTION_REGISTRY[id];
        if (!entry || !entry.canRender(content)) {
          return null;
        }

        const render = renderers[id];
        if (!render) {
          return null;
        }

        return <Fragment key={id}>{render()}</Fragment>;
      })}
    </>
  );
}
