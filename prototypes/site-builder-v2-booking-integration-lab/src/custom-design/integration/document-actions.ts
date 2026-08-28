import type {
  PageDocument,
  SectionInstance,
  SiteBuilderDocument,
} from '../../model/types';
import type { ResolveCustomDesignAction } from '../components/view-types';
import { resolveCustomDesignAction } from '../model/actions';
import type {
  CustomDesignAction,
  CustomDesignActionResolution,
  CustomDesignResolvedAction,
} from '../model/types';

export type CustomDesignDocumentNavigationTarget = {
  kind: 'booking' | 'internal';
  pageId: string;
  sectionId?: string;
  relationship: 'cross_page' | 'same_page';
};

export type CustomDesignDocumentResolvedAction = CustomDesignResolvedAction & {
  documentTarget?: CustomDesignDocumentNavigationTarget;
};

export type CustomDesignDocumentActionResolution =
  | CustomDesignDocumentResolvedAction
  | Exclude<CustomDesignActionResolution, CustomDesignResolvedAction>;

export type CustomDesignDocumentActionContext = {
  activePageId?: string;
  document: SiteBuilderDocument;
};

type LocatedSection = {
  page: PageDocument;
  section: SectionInstance;
};

const locateCanonicalBooking = (
  document: SiteBuilderDocument,
): LocatedSection | null => {
  const locations = document.pages.flatMap((page) =>
    page.sections.flatMap((section) =>
      section.sectionType === 'booking' ? [{ page, section }] : [],
    ),
  );
  const location = locations.length === 1 ? locations[0] : undefined;
  return location?.page.visible && location.section.visible ? location : null;
};

const locateInternalTarget = (
  document: SiteBuilderDocument,
  pageId: string,
  sectionId?: string,
): { page: PageDocument; section?: SectionInstance } | null => {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (!page?.visible) return null;
  if (!sectionId) return { page };

  const section = page.sections.find((candidate) => candidate.id === sectionId);
  if (section?.sectionType === 'custom_design' && section.settings.images.length === 0) {
    return null;
  }
  return section?.visible ? { page, section } : null;
};

const createDocumentTargetHref = (
  pageId: string,
  sectionId?: string,
): string => {
  const parameters = new URLSearchParams({ page: pageId });
  if (sectionId) parameters.set('section', sectionId);
  return `/#${parameters.toString()}`;
};

const withDocumentTarget = (
  resolution: CustomDesignActionResolution,
  documentTarget: CustomDesignDocumentNavigationTarget,
): CustomDesignDocumentActionResolution =>
  resolution.status === 'resolved'
    ? { ...resolution, documentTarget }
    : resolution;

const relationshipFor = (
  activePageId: string | undefined,
  targetPageId: string,
): CustomDesignDocumentNavigationTarget['relationship'] =>
  activePageId === targetPageId ? 'same_page' : 'cross_page';

/**
 * Resolves structured Custom Design actions against the current validated site
 * document. Document navigation stays ID-based; the href is a safe semantic
 * fallback while Preview can use documentTarget for same-page scrolling or
 * cross-page navigation followed by scrolling.
 */
export const resolveCustomDesignDocumentAction = (
  action: CustomDesignAction,
  context: CustomDesignDocumentActionContext,
): CustomDesignDocumentActionResolution => {
  if (action.type === 'start_booking') {
    const location = locateCanonicalBooking(context.document);
    if (!location) {
      return resolveCustomDesignAction(action);
    }
    const resolution = resolveCustomDesignAction(action, {
      bookingHref: createDocumentTargetHref(location.page.id, location.section.id),
    });
    return withDocumentTarget(resolution, {
      kind: 'booking',
      pageId: location.page.id,
      sectionId: location.section.id,
      relationship: relationshipFor(context.activePageId, location.page.id),
    });
  }

  if (action.type === 'internal') {
    const target = locateInternalTarget(
      context.document,
      action.destination.pageId,
      action.destination.sectionId,
    );
    const resolution = resolveCustomDesignAction(action, {
      resolveInternalHref: (pageId, sectionId) => {
        if (!target || pageId !== target.page.id) return null;
        if (sectionId !== target.section?.id) return null;
        return createDocumentTargetHref(pageId, sectionId);
      },
    });
    if (!target) return resolution;

    return withDocumentTarget(resolution, {
      kind: 'internal',
      pageId: target.page.id,
      ...(target.section ? { sectionId: target.section.id } : {}),
      relationship: relationshipFor(context.activePageId, target.page.id),
    });
  }

  return resolveCustomDesignAction(action);
};

export const createCustomDesignDocumentActionResolver = (
  context: CustomDesignDocumentActionContext,
): ((action: CustomDesignAction) => CustomDesignDocumentActionResolution) =>
  (action) => resolveCustomDesignDocumentAction(action, context);

/**
 * Keeps document navigation inside the customer-preview host. The underlying
 * resolver remains the source of truth for target validity and safe fallback
 * URLs; preview hosts only decide how to reveal an already validated target.
 */
export const createHostedCustomDesignActionResolver = (
  context: CustomDesignDocumentActionContext,
  onDocumentTarget: (target: CustomDesignDocumentNavigationTarget) => void,
): ResolveCustomDesignAction => (action, source) => {
  const effectiveAction = action
    ?? (source.type === 'cta' && source.cta.type === 'book_now'
      ? { type: 'start_booking' as const }
      : null);
  if (!effectiveAction) {
    return { reason: 'invalid_destination', status: 'unresolved' };
  }
  const resolution = resolveCustomDesignDocumentAction(effectiveAction, context);
  if (resolution.status !== 'resolved' || !resolution.documentTarget) {
    return resolution;
  }
  return {
    status: 'button',
    onActivate: (event) => {
      event.preventDefault();
      onDocumentTarget(resolution.documentTarget!);
    },
  };
};
