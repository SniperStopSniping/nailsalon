import { Fragment, type ReactNode } from 'react';

import type { SectionId } from '@/libs/bookingPageConfig';
import type { SalonContent } from '@/libs/salonContent';
import { resolveVisibleSectionOrder } from '@/libs/sectionRegistry';

/**
 * Thin rendering wrapper (Luster UI/UX plan rev 3, section 4A.B / PR 4 BUILD
 * step 4) that iterates a resolved `sectionOrder` and, for each id that
 * survives `resolveVisibleSectionOrder(order, hiddenSections, content)`
 * (`@/libs/sectionRegistry` — registered, not hidden, and `canRender(content)`
 * passes), renders whatever the caller supplied for that id in `renderers` —
 * or nothing, if the caller did not supply one. This component is
 * `resolveVisibleSectionOrder`'s one production caller and the single choke
 * point every section's visibility (owner draft preview or public live) goes
 * through — never a second, competing visibility check.
 *
 * `hiddenSections` defaults to empty (today's pre-hidden-sections behaviour,
 * unchanged) so every existing caller that has not threaded a resolved
 * `bookingPage.{draft,live}.hiddenSections` through yet keeps working
 * exactly as before.
 *
 * This is otherwise deliberately dumb: it owns ordering and omission only,
 * never how a section looks. A caller with no renderer for a given id (e.g.
 * Quick Book, which folds `featuredServices`/`policies`/`socialLinks`/
 * `bookingCta` into a single opaque `serviceMenu` block rather than giving
 * each its own renderer — see `BookServiceClient.tsx`) simply sees that id
 * skipped, which is exactly "expressed as a section order, not a new
 * component": the order still governs what COULD render, without forcing
 * every consumer to split its markup along section boundaries before it is
 * ready to. Content embedded inline inside a shared block like that is NOT
 * governed by this component at all — see `BookServiceClient.tsx`'s own
 * `showFeaturedCarousel`/`showPolicyCard`/`showSocialLinks` presentation
 * flags, which are the hidden-state choke point for that embedded content.
 */

export type SectionRenderers = Partial<Record<SectionId, () => ReactNode>>;

export type SectionOrderRendererProps = {
  order: readonly SectionId[];
  /** Resolved `bookingPage.{draft,live}.hiddenSections`. Defaults to none hidden. */
  hiddenSections?: readonly SectionId[];
  content: SalonContent;
  renderers: SectionRenderers;
};

const NO_HIDDEN_SECTIONS: readonly SectionId[] = [];

export function SectionOrderRenderer({
  order,
  hiddenSections = NO_HIDDEN_SECTIONS,
  content,
  renderers,
}: SectionOrderRendererProps) {
  const visibleIds = resolveVisibleSectionOrder(order, hiddenSections, content);

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
