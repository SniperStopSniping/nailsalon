import type {
  CustomDesignAssetUrlPair,
} from '../custom-design/integration/CustomDesignAssetProvider';
import type {
  CustomDesignInternalPageOption,
  CustomDesignOwnerAssetMap,
} from '../custom-design/integration/ui-types';
import type { SiteBuilderDocument } from '../model';

export const toCustomDesignOwnerAssetMap = (
  assets: ReadonlyMap<string, CustomDesignAssetUrlPair>,
): CustomDesignOwnerAssetMap => {
  const result: Record<string, CustomDesignOwnerAssetMap[string]> = {};

  for (const [assetId, pair] of assets) {
    if (pair.original.status === 'ready') {
      result[assetId] = {
        status: 'ready',
        url: pair.original.url,
        ...(pair.thumbnail.status === 'ready'
          ? { thumbnailUrl: pair.thumbnail.url }
          : {}),
      };
      continue;
    }

    if (pair.original.status === 'loading') {
      result[assetId] = { status: 'loading' };
      continue;
    }

    if (pair.original.status === 'missing') {
      result[assetId] = {
        status: 'missing',
        reason: 'This design file is not available in this browser.',
      };
      continue;
    }

    result[assetId] = {
      status: 'error',
      reason: pair.original.error.message,
    };
  }

  return result;
};

export const getCustomDesignInternalTargets = (
  document: SiteBuilderDocument,
): CustomDesignInternalPageOption[] => document.pages.map((page) => ({
  id: page.id,
  label: page.name,
  sections: page.sections.map((section) => ({
    id: section.id,
    label: section.label,
    visible: section.visible,
  })),
  visible: page.visible,
}));
