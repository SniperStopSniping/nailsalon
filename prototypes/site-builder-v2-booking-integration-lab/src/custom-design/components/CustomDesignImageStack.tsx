import type { CSSProperties } from 'react';

import type {
  CustomDesignImageItem,
  CustomDesignNativeCta,
} from '../model/types';
import { AccessibilitySummary } from './AccessibilitySummary';
import { CustomerImageFrame } from './CustomerImageFrame';
import { CustomerMissingAsset } from './MissingAsset';
import { NativeCta } from './NativeCta';
import type {
  CustomDesignResolvedAsset,
  CustomDesignScrollPositionReader,
  ResolveCustomDesignAction,
} from './view-types';

type ResolvedImage = {
  asset: CustomDesignResolvedAsset;
  image: CustomDesignImageItem;
};

type CustomDesignStackEntryStyle = CSSProperties & {
  '--custom-design-quality-width': string;
};

type CustomDesignLoadingAssetStyle = CSSProperties & {
  aspectRatio: string;
};

type CustomDesignImageStackProps = {
  cta: CustomDesignNativeCta;
  getScrollPosition?: CustomDesignScrollPositionReader;
  images: readonly ResolvedImage[];
  missingAssetFallback?: 'none' | 'placeholder';
  onAssetRenderError?: (assetId: string, imageItemId: string) => void;
  resolveAction: ResolveCustomDesignAction;
};

const hasCtaAfterImage = (
  cta: CustomDesignNativeCta,
  imageItemId: string,
): cta is Exclude<CustomDesignNativeCta, { type: 'none' }> =>
  cta.type !== 'none'
  && cta.placement.type === 'after_image'
  && cta.placement.imageItemId === imageItemId;

export function CustomDesignImageStack({
  cta,
  getScrollPosition,
  images,
  missingAssetFallback = 'none',
  onAssetRenderError,
  resolveAction,
}: CustomDesignImageStackProps) {
  const firstReadyImageId = images.find(entry => entry.asset.status === 'ready')
    ?.image.id;
  const placementImageId = cta.type !== 'none'
    && cta.placement.type === 'after_image'
    ? cta.placement.imageItemId
    : null;
  const placementImageExists = placementImageId !== null
    && images.some(entry => entry.image.id === placementImageId);
  const placeCtaAfterAll = cta.type !== 'none'
    && (cta.placement.type === 'after_all' || !placementImageExists);

  return (
    <div className="custom-design-image-stack">
      {images.map(({ asset, image }) => (
        <div
          className="custom-design-stack-entry"
          key={image.id}
          style={{
            '--custom-design-quality-width': `${Math.round(image.width * 1.5)}px`,
          } as CustomDesignStackEntryStyle}
        >
          {asset.status === 'ready'
            ? (
                <CustomerImageFrame
                  asset={asset}
                  getScrollPosition={getScrollPosition}
                  image={image}
                  isFirstReadyImage={firstReadyImageId === image.id}
                  key={`${image.id}:${image.assetId}:${asset.url}`}
                  missingAssetFallback={missingAssetFallback}
                  onAssetRenderError={onAssetRenderError}
                  resolveAction={resolveAction}
                />
              )
            : asset.status === 'loading'
              ? (
                  <div
                    aria-hidden="true"
                    className="custom-design-loading-asset"
                    data-testid="custom-design-customer-loading-asset"
                    style={{
                      aspectRatio: `${image.width} / ${image.height}`,
                    } as CustomDesignLoadingAssetStyle}
                  />
                )
              : (
                  <>
                    <CustomerMissingAsset fallback={missingAssetFallback} />
                    <AccessibilitySummary
                      fileName={image.fileName}
                      imageItemId={image.id}
                      summary={image.accessibleSummary}
                    />
                  </>
                )}
          {hasCtaAfterImage(cta, image.id)
            ? (
                <NativeCta
                  cta={cta}
                  getScrollPosition={getScrollPosition}
                  resolveAction={resolveAction}
                />
              )
            : null}
        </div>
      ))}
      {placeCtaAfterAll
        ? (
            <NativeCta
              cta={cta}
              getScrollPosition={getScrollPosition}
              resolveAction={resolveAction}
            />
          )
        : null}
    </div>
  );
}
