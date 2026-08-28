import { useMemo, useState } from 'react';

import type { ResolveCustomDesignAction } from '../../custom-design/components/view-types';
import { useCustomDesignAssetMap } from '../../custom-design/integration/CustomDesignAssetProvider';
import { CustomDesignCustomerPreview } from '../../custom-design/integration/CustomDesignSectionCard';
import { resolveCustomDesignDocumentAction } from '../../custom-design/integration/document-actions';
import type { CustomDesignOwnerAssetMap } from '../../custom-design/integration/ui-types';
import type { CustomDesignSectionInstance, SiteBuilderDocument } from '../../model';
import { toCustomDesignOwnerAssetMap } from '../../ui/custom-design-adapters';

export type OnboardingCustomDesignSectionsProps = {
  document: SiteBuilderDocument | null;
  pageId?: string;
  sectionIds?: readonly string[];
};

type LocatedSection = {
  pageId: string;
  section: CustomDesignSectionInstance;
};

const createOnboardingActionResolver = (
  document: SiteBuilderDocument,
  activePageId: string,
): ResolveCustomDesignAction => (action, source) => {
  const effectiveAction = action
    ?? (source.type === 'cta' && source.cta.type === 'book_now'
      ? { type: 'start_booking' }
      : null);
  return effectiveAction
    ? resolveCustomDesignDocumentAction(effectiveAction, {
        activePageId,
        document,
      })
    : { reason: 'invalid_destination', status: 'unresolved' };
};

export function OnboardingCustomDesignSections({
  document,
  pageId,
  sectionIds,
}: OnboardingCustomDesignSectionsProps) {
  const [renderErrorAssetIds, setRenderErrorAssetIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const requestedIds = useMemo(
    () => sectionIds ? new Set(sectionIds) : null,
    [sectionIds],
  );
  const sections = useMemo<LocatedSection[]>(() => document?.pages.flatMap((page) => {
    if (!page.visible || (pageId && page.id !== pageId)) return [];
    return [...page.sections]
      .sort((left, right) => left.order - right.order)
      .flatMap((section) => (
        section.sectionType === 'custom_design'
        && section.visible
        && section.settings.images.length > 0
        && (!requestedIds || requestedIds.has(section.id))
          ? [{ pageId: page.id, section }]
          : []
      ));
  }) ?? [], [document, pageId, requestedIds]);
  const assetIds = useMemo(() => sections.flatMap(({ section }) =>
    section.settings.images.map((image) => image.assetId)), [sections]);
  const assetPairs = useCustomDesignAssetMap(assetIds);
  const assets = useMemo<CustomDesignOwnerAssetMap>(() => {
    const resolved = toCustomDesignOwnerAssetMap(assetPairs);
    if (renderErrorAssetIds.size === 0) return resolved;
    return Object.fromEntries(Object.entries(resolved).map(([assetId, asset]) => [
      assetId,
      renderErrorAssetIds.has(assetId)
        ? { reason: 'This design file could not be displayed.', status: 'error' as const }
        : asset,
    ]));
  }, [assetPairs, renderErrorAssetIds]);

  if (!document || sections.length === 0) return null;

  return (
    <>
      {sections.map(({ pageId: sectionPageId, section }) => (
        <div
          data-onboarding-custom-design-section={section.id}
          data-section-id={section.id}
          data-section-type="custom_design"
          key={section.id}
        >
          <CustomDesignCustomerPreview
            accessibleSectionLabel={section.label}
            assets={assets}
            onAssetRenderError={(assetId) => {
              setRenderErrorAssetIds((current) => new Set(current).add(assetId));
            }}
            resolveAction={createOnboardingActionResolver(document, sectionPageId)}
            settings={section.settings}
          />
        </div>
      ))}
    </>
  );
}
