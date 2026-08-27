import type { CSSProperties } from 'react';

import type {
  CustomDesignImageItem,
  CustomDesignInteractiveArea,
} from '../model/types';
import { SemanticAction } from './SemanticAction';
import type {
  CustomDesignScrollPositionReader,
  ResolveCustomDesignAction,
} from './view-types';

const geometryStyle = (
  area: CustomDesignInteractiveArea,
): CSSProperties => ({
  height: `${area.geometry.height}%`,
  left: `${area.geometry.x}%`,
  top: `${area.geometry.y}%`,
  width: `${area.geometry.width}%`,
});

type SemanticClickableAreaProps = {
  area: CustomDesignInteractiveArea;
  getScrollPosition?: CustomDesignScrollPositionReader;
  image: CustomDesignImageItem;
  resolveAction: ResolveCustomDesignAction;
};

export function SemanticClickableArea({
  area,
  getScrollPosition,
  image,
  resolveAction,
}: SemanticClickableAreaProps) {
  if (
    area.validationStatus !== 'valid'
    || area.reviewStatus !== 'approved'
    || !area.labelConfirmed
    || !area.accessibleLabel.trim()
  ) {
    return null;
  }

  const resolution = resolveAction(area.action, {
    area,
    image,
    type: 'area',
  });

  return (
    <SemanticAction
      accessibleLabel={area.accessibleLabel}
      className="custom-design-area-link"
      getScrollPosition={getScrollPosition}
      resolution={resolution}
      style={geometryStyle(area)}
      testId={`custom-design-area-${area.id}`}
    />
  );
}
