import { useRef, useState } from 'react';

import type { CustomDesignImageItem } from '../model/types';
import { AccessibilitySummary } from './AccessibilitySummary';
import { CustomerMissingAsset } from './MissingAsset';
import { SemanticClickableArea } from './SemanticClickableArea';
import type {
  CustomDesignResolvedAsset,
  CustomDesignScrollPositionReader,
  ResolveCustomDesignAction,
} from './view-types';

type ReadyAsset = Extract<CustomDesignResolvedAsset, { status: 'ready' }>;

type CustomerImageFrameProps = {
  asset: ReadyAsset;
  getScrollPosition?: CustomDesignScrollPositionReader;
  image: CustomDesignImageItem;
  isFirstReadyImage: boolean;
  missingAssetFallback: 'none' | 'placeholder';
  onAssetRenderError?: (assetId: string, imageItemId: string) => void;
  resolveAction: ResolveCustomDesignAction;
};

export function CustomerImageFrame({
  asset,
  getScrollPosition,
  image,
  isFirstReadyImage,
  missingAssetFallback,
  onAssetRenderError,
  resolveAction,
}: CustomerImageFrameProps) {
  const [renderState, setRenderState] = useState<'loading' | 'loaded' | 'error'>(
    'loading',
  );
  const errorReportedRef = useRef(false);

  if (renderState === 'error') {
    return (
      <>
        <CustomerMissingAsset fallback={missingAssetFallback} />
        <AccessibilitySummary
          fileName={image.fileName}
          imageItemId={image.id}
          summary={image.accessibleSummary}
        />
      </>
    );
  }

  return (
    <>
      <div
        className="custom-design-image-frame"
        data-image-item-id={image.id}
        data-image-render-state={renderState}
        style={{ aspectRatio: `${image.width} / ${image.height}` }}
      >
        <img
          alt={image.decorative ? '' : image.altText}
          className="custom-design-customer-image"
          data-media-id={image.assetId}
          data-media-role="custom_design"
          decoding="async"
          draggable={false}
          fetchPriority={isFirstReadyImage ? 'high' : 'auto'}
          height={image.height}
          loading={isFirstReadyImage ? 'eager' : 'lazy'}
          src={asset.url}
          width={image.width}
          onError={() => {
            setRenderState('error');
            if (!errorReportedRef.current) {
              errorReportedRef.current = true;
              onAssetRenderError?.(image.assetId, image.id);
            }
          }}
          onLoad={() => {
            setRenderState(current => current === 'error' ? current : 'loaded');
          }}
        />
        {renderState === 'loaded'
          ? (
              <div className="custom-design-area-layer">
                {[...image.interactiveAreas]
                  .sort((left, right) => left.semanticOrder - right.semanticOrder)
                  .map(area => (
                    <SemanticClickableArea
                      area={area}
                      getScrollPosition={getScrollPosition}
                      image={image}
                      key={area.id}
                      resolveAction={resolveAction}
                    />
                  ))}
              </div>
            )
          : null}
      </div>
      <AccessibilitySummary
        fileName={image.fileName}
        imageItemId={image.id}
        summary={image.accessibleSummary}
      />
    </>
  );
}
