import './custom-design.css';

import { CUSTOM_DESIGN_POSTER_MAX_WIDTH_PX } from '../model/constants';
import { hasRenderableCustomDesignContent } from '../model/settings';
import type { CustomDesignSettings } from '../model/types';
import { CustomDesignImageStack } from './CustomDesignImageStack';
import type {
  CustomDesignScrollPositionReader,
  CustomDesignSectionStyle,
  ResolveCustomDesignAction,
  ResolveCustomDesignAsset,
} from './view-types';

const CUSTOM_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

type CustomDesignRendererProps = {
  accessibleSectionLabel?: string;
  contentMaxWidth?: string;
  getScrollPosition?: CustomDesignScrollPositionReader;
  missingAssetFallback?: 'none' | 'placeholder';
  onAssetRenderError?: (assetId: string, imageItemId: string) => void;
  posterMaxWidth?: string;
  resolveAction: ResolveCustomDesignAction;
  resolveAsset: ResolveCustomDesignAsset;
  settings: CustomDesignSettings;
};

export function CustomDesignRenderer({
  accessibleSectionLabel,
  contentMaxWidth = '1120px',
  getScrollPosition,
  missingAssetFallback = 'none',
  onAssetRenderError,
  posterMaxWidth = `${CUSTOM_DESIGN_POSTER_MAX_WIDTH_PX}px`,
  resolveAction,
  resolveAsset,
  settings,
}: CustomDesignRendererProps) {
  const images = settings.images.map(image => ({
    asset: resolveAsset(image.assetId, image),
    image,
  }));
  const assetsById = new Map(images.map(entry => [entry.image.assetId, entry.asset]));
  const hasRenderableImage = hasRenderableCustomDesignContent(
    settings,
    (assetId) => {
      const asset = assetsById.get(assetId);
      return asset?.status === 'ready' || asset?.status === 'loading';
    },
  ) || (missingAssetFallback === 'placeholder' && images.length > 0);

  if (!hasRenderableImage) {
    return null;
  }

  const customColor = settings.background.mode === 'custom'
    && CUSTOM_COLOR_PATTERN.test(settings.background.color)
    ? settings.background.color
    : undefined;
  const backgroundMode = settings.background.mode === 'custom' && !customColor
    ? 'site'
    : settings.background.mode;
  const style: CustomDesignSectionStyle = {
    '--custom-design-content-max-width': contentMaxWidth,
    '--custom-design-poster-max-width': posterMaxWidth,
  };
  if (customColor) {
    style['--custom-design-background'] = customColor;
  }
  const sectionLabel = accessibleSectionLabel?.trim() || undefined;

  return (
    <section
      aria-label={sectionLabel}
      className="custom-design-customer-section"
      data-background-mode={backgroundMode}
      data-display-mode={settings.displayMode}
      data-gap={settings.gap}
      data-testid="custom-design-customer-renderer"
      style={style}
    >
      <CustomDesignImageStack
        cta={settings.cta}
        getScrollPosition={getScrollPosition}
        images={images}
        missingAssetFallback={missingAssetFallback}
        onAssetRenderError={onAssetRenderError}
        resolveAction={resolveAction}
      />
    </section>
  );
}
