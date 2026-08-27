import type { CustomDesignImageItem } from '../model/types';
import { OwnerMissingAsset } from './MissingAsset';
import type { CustomDesignResolvedAsset } from './view-types';

type OwnerThumbnailProps = {
  asset: CustomDesignResolvedAsset;
  image: CustomDesignImageItem;
  pageNumber: number;
  onReplace: () => void;
};

export function OwnerThumbnail({
  asset,
  image,
  onReplace,
  pageNumber,
}: OwnerThumbnailProps) {
  if (asset.status === 'missing') {
    return (
      <OwnerMissingAsset
        fileName={image.fileName}
        reason={asset.reason}
        onReplace={onReplace}
      />
    );
  }

  return (
    <figure
      className="custom-design-owner-thumbnail"
      data-testid={`custom-design-thumbnail-${image.id}`}
    >
      <img
        alt=""
        height={image.height}
        loading="lazy"
        src={asset.url}
        width={image.width}
      />
      <figcaption>
        <strong>Page {pageNumber}</strong>
        <span>{image.fileName}</span>
        <span>{image.width} × {image.height}px</span>
      </figcaption>
      <button type="button" onClick={onReplace}>Replace</button>
    </figure>
  );
}
