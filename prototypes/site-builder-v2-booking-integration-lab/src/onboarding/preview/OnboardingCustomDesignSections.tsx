import { useMemo, useState } from 'react';

import type { ResolveCustomDesignAction } from '../../custom-design/components/view-types';
import { useCustomDesignAssetMap } from '../../custom-design/integration/CustomDesignAssetProvider';
import { CustomDesignCustomerPreview } from '../../custom-design/integration/CustomDesignSectionCard';
import {
  createHostedCustomDesignActionResolver,
  type CustomDesignDocumentNavigationTarget,
} from '../../custom-design/integration/document-actions';
import type { CustomDesignOwnerAssetMap } from '../../custom-design/integration/ui-types';
import {
  hasCustomDesignArtwork,
  hasRenderableCustomDesignContent,
} from '../../custom-design/model/settings';
import type { CustomDesignSectionInstance, SiteBuilderDocument } from '../../model';
import { toCustomDesignOwnerAssetMap } from '../../ui/custom-design-adapters';

export type OnboardingCustomDesignSectionsProps = {
  document: SiteBuilderDocument | null;
  onDocumentTarget: (target: CustomDesignDocumentNavigationTarget) => void;
  pageId?: string;
  sectionIds?: readonly string[];
};

type LocatedSection = {
  pageId: string;
  section: CustomDesignSectionInstance;
};

export function OnboardingCustomDesignSections({
  document,
  onDocumentTarget,
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
    if (!page.visible || (pageId && page.id !== pageId)) {
      return [];
    }
    return [...page.sections]
      .sort((left, right) => left.order - right.order)
      .flatMap(section => (
        section.sectionType === 'custom_design'
        && section.visible
        && hasCustomDesignArtwork(section.settings)
        && (!requestedIds || requestedIds.has(section.id))
          ? [{ pageId: page.id, section }]
          : []
      ));
  }) ?? [], [document, pageId, requestedIds]);
  const assetIds = useMemo(() => sections.flatMap(({ section }) =>
    section.settings.images.map(image => image.assetId)), [sections]);
  const assetPairs = useCustomDesignAssetMap(assetIds);
  const assets = useMemo<CustomDesignOwnerAssetMap>(() => {
    const resolved = toCustomDesignOwnerAssetMap(assetPairs);
    if (renderErrorAssetIds.size === 0) {
      return resolved;
    }
    return Object.fromEntries(Object.entries(resolved).map(([assetId, asset]) => [
      assetId,
      renderErrorAssetIds.has(assetId)
        ? { reason: 'This design file could not be displayed.', status: 'error' as const }
        : asset,
    ]));
  }, [assetPairs, renderErrorAssetIds]);
  const renderableSections = useMemo(() => sections.filter(({ section }) => (
    hasRenderableCustomDesignContent(section.settings, (assetId) => {
      const status = assets[assetId]?.status;
      return status === 'loading' || status === 'ready';
    })
  )), [assets, sections]);
  const actionResolvers = useMemo<Map<string, ResolveCustomDesignAction>>(() => (
    document
      ? new Map(renderableSections.map(({ pageId: activePageId }) => [
        activePageId,
        createHostedCustomDesignActionResolver(
          { activePageId, document },
          onDocumentTarget,
        ),
      ] as const))
      : new Map()
  ), [document, onDocumentTarget, renderableSections]);

  if (!document || renderableSections.length === 0) {
    return null;
  }

  return (
    <>
      {renderableSections.map(({ pageId: sectionPageId, section }) => (
        <div
          data-content-key="custom_design"
          data-content-owner={section.id}
          data-onboarding-custom-design-section={section.id}
          data-onboarding-custom-design-mode={section.settings.displayMode}
          data-section-id={section.id}
          data-section-type="custom_design"
          key={section.id}
        >
          <CustomDesignCustomerPreview
            accessibleSectionLabel={section.label}
            assets={assets}
            contentMaxWidth="calc(100% - clamp(32px, 10cqw, 112px))"
            onAssetRenderError={(assetId) => {
              setRenderErrorAssetIds(current => new Set(current).add(assetId));
            }}
            resolveAction={actionResolvers.get(sectionPageId)!}
            settings={section.settings}
          />
        </div>
      ))}
    </>
  );
}
