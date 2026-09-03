import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import { CUSTOM_DESIGN_MIN_TOUCH_TARGET_PX } from '../model/constants';
import {
  type CustomDesignResizeHandle,
  renderedAreaNeedsTargetWarning,
} from '../model/geometry';
import type { CustomDesignInteractiveArea } from '../model/types';

const RESIZE_HANDLES: readonly CustomDesignResizeHandle[] = [
  'north_west',
  'north',
  'north_east',
  'east',
  'south_east',
  'south',
  'south_west',
  'west',
];

const EXPLICIT_RESIZE_STEP_PX = 12;

const handleLabel = (handle: CustomDesignResizeHandle): string =>
  handle.replace('_', ' ');

type HotspotAreaStyle = CSSProperties & {
  '--custom-design-owner-area-height': string;
  '--custom-design-owner-area-width': string;
  '--custom-design-owner-popover-max-width': string;
};

const rectangleStyle = (
  area: CustomDesignInteractiveArea,
  renderedArea: { height: number; width: number },
  popoverMaximumWidth: number,
): HotspotAreaStyle => ({
  '--custom-design-owner-area-height': `${renderedArea.height}px`,
  '--custom-design-owner-area-width': `${renderedArea.width}px`,
  '--custom-design-owner-popover-max-width': `${popoverMaximumWidth}px`,
  'height': `${area.geometry.height}%`,
  'left': `${area.geometry.x}%`,
  'top': `${area.geometry.y}%`,
  'width': `${area.geometry.width}%`,
});

const keyboardDelta = (
  event: ReactKeyboardEvent<HTMLButtonElement>,
): { x: number; y: number } | null => {
  const step = event.shiftKey ? 5 : 1;
  switch (event.key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 };
    case 'ArrowRight':
      return { x: step, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -step };
    case 'ArrowDown':
      return { x: 0, y: step };
    default:
      return null;
  }
};

type HotspotOverlayProps = {
  areas: readonly CustomDesignInteractiveArea[];
  renderedHeight: number;
  renderedWidth: number;
  selectedAreaId?: string;
  onKeyboardMove?: (
    areaId: string,
    delta: { x: number; y: number },
  ) => void;
  onKeyboardResize?: (
    areaId: string,
    handle: CustomDesignResizeHandle,
    delta: { x: number; y: number },
  ) => void;
  onMoveStart?: (
    areaId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onResizeStart?: (
    areaId: string,
    handle: CustomDesignResizeHandle,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onSelect?: (areaId: string) => void;
};

export function HotspotOverlay({
  areas,
  onKeyboardMove,
  onKeyboardResize,
  onMoveStart,
  onResizeStart,
  onSelect,
  renderedHeight,
  renderedWidth,
  selectedAreaId,
}: HotspotOverlayProps) {
  return (
    <div
      aria-label="Clickable area editor"
      className="custom-design-hotspot-editor"
      data-testid="custom-design-hotspot-editor"
      role="group"
    >
      {[...areas]
        .sort((left, right) => left.semanticOrder - right.semanticOrder)
        .map((area) => {
          const areaLeft = renderedWidth * area.geometry.x / 100;
          const areaTop = renderedHeight * area.geometry.y / 100;
          const renderedArea = {
            height: renderedHeight * area.geometry.height / 100,
            width: renderedWidth * area.geometry.width / 100,
          };
          const areaRight = areaLeft + renderedArea.width;
          const areaBottom = areaTop + renderedArea.height;
          const inlineSpaceRight = renderedWidth - areaLeft;
          const inlineSpaceLeft = areaRight;
          const nearRightEdge = renderedWidth - areaRight < 260;
          const nearTopEdge = areaTop < 40;
          const nearBottomEdge = renderedHeight - areaBottom < 80;
          const popoverMaximumWidth = Math.max(
            1,
            Math.min(
              260,
              renderedWidth,
              nearRightEdge ? inlineSpaceLeft : inlineSpaceRight,
            ),
          );
          const targetTooSmall = renderedAreaNeedsTargetWarning(
            area.geometry,
            { height: renderedHeight, width: renderedWidth },
          );
          const warningId = `custom-design-target-warning-${area.id}`;
          const selected = selectedAreaId === area.id;
          const horizontalResizeHandle: CustomDesignResizeHandle = nearRightEdge
            ? 'west'
            : 'east';
          const verticalResizeHandle: CustomDesignResizeHandle = nearBottomEdge
            ? 'north'
            : 'south';

          const handleKeyboardMove = (
            event: ReactKeyboardEvent<HTMLButtonElement>,
          ) => {
            const delta = keyboardDelta(event);
            if (!delta) {
              return;
            }
            event.preventDefault();
            onKeyboardMove?.(area.id, delta);
          };

          return (
            <div
              aria-label={`Clickable area: ${area.accessibleLabel}`}
              className="custom-design-hotspot-editor__area"
              data-review-status={area.reviewStatus}
              data-selected={selected ? 'true' : 'false'}
              data-edge-bottom={nearBottomEdge ? 'true' : 'false'}
              data-edge-right={nearRightEdge ? 'true' : 'false'}
              data-edge-top={nearTopEdge ? 'true' : 'false'}
              data-narrow-inline={renderedArea.width < 56 ? 'true' : 'false'}
              data-short-block={renderedArea.height < 56 ? 'true' : 'false'}
              data-target-warning={targetTooSmall ? 'true' : 'false'}
              data-validation-status={area.validationStatus}
              key={area.id}
              role="group"
              style={rectangleStyle(
                area,
                renderedArea,
                popoverMaximumWidth,
              )}
            >
              <button
                aria-describedby={targetTooSmall ? warningId : undefined}
                aria-label={`Move clickable area: ${area.accessibleLabel}`}
                className="custom-design-hotspot-editor__move"
                type="button"
                onFocus={() => onSelect?.(area.id)}
                onKeyDown={handleKeyboardMove}
                onPointerDown={event => onMoveStart?.(area.id, event)}
              >
                <span>{area.accessibleLabel}</span>
              </button>
              {selected
                ? RESIZE_HANDLES.map(handle => (
                  <button
                    aria-label={`Resize ${area.accessibleLabel} from ${handleLabel(handle)}`}
                    className="custom-design-hotspot-editor__resize"
                    data-handle-inset="true"
                    data-hit-target-max-size="44"
                    data-resize-handle={handle}
                    data-visual-size="14"
                    key={handle}
                    type="button"
                    onFocus={() => onSelect?.(area.id)}
                    onKeyDown={(event) => {
                      const delta = keyboardDelta(event);
                      if (!delta) {
                        return;
                      }
                      event.preventDefault();
                      onKeyboardResize?.(area.id, handle, delta);
                    }}
                    onPointerDown={event => onResizeStart?.(area.id, handle, event)}
                  />
                ))
                : null}
              {selected && onKeyboardResize
                ? (
                    <div
                      aria-label={`Resize clickable area: ${area.accessibleLabel}`}
                      className="custom-design-hotspot-editor__resize-pad"
                      data-testid={`custom-design-resize-pad-${area.id}`}
                      role="group"
                    >
                      <button
                        aria-label={`Make ${area.accessibleLabel} wider`}
                        data-min-target-size="44"
                        data-resize-step-pixels={EXPLICIT_RESIZE_STEP_PX}
                        type="button"
                        onClick={() => onKeyboardResize(
                          area.id,
                          horizontalResizeHandle,
                          {
                            x: nearRightEdge
                              ? -EXPLICIT_RESIZE_STEP_PX
                              : EXPLICIT_RESIZE_STEP_PX,
                            y: 0,
                          },
                        )}
                      >
                        Wider
                      </button>
                      <button
                        aria-label={`Make ${area.accessibleLabel} narrower`}
                        data-min-target-size="44"
                        data-resize-step-pixels={EXPLICIT_RESIZE_STEP_PX}
                        type="button"
                        onClick={() => onKeyboardResize(
                          area.id,
                          horizontalResizeHandle,
                          {
                            x: nearRightEdge
                              ? EXPLICIT_RESIZE_STEP_PX
                              : -EXPLICIT_RESIZE_STEP_PX,
                            y: 0,
                          },
                        )}
                      >
                        Narrower
                      </button>
                      <button
                        aria-label={`Make ${area.accessibleLabel} taller`}
                        data-min-target-size="44"
                        data-resize-step-pixels={EXPLICIT_RESIZE_STEP_PX}
                        type="button"
                        onClick={() => onKeyboardResize(
                          area.id,
                          verticalResizeHandle,
                          {
                            x: 0,
                            y: nearBottomEdge
                              ? -EXPLICIT_RESIZE_STEP_PX
                              : EXPLICIT_RESIZE_STEP_PX,
                          },
                        )}
                      >
                        Taller
                      </button>
                      <button
                        aria-label={`Make ${area.accessibleLabel} shorter`}
                        data-min-target-size="44"
                        data-resize-step-pixels={EXPLICIT_RESIZE_STEP_PX}
                        type="button"
                        onClick={() => onKeyboardResize(
                          area.id,
                          verticalResizeHandle,
                          {
                            x: 0,
                            y: nearBottomEdge
                              ? EXPLICIT_RESIZE_STEP_PX
                              : -EXPLICIT_RESIZE_STEP_PX,
                          },
                        )}
                      >
                        Shorter
                      </button>
                    </div>
                  )
                : null}
              {targetTooSmall
                ? (
                    <span
                      className="custom-design-hotspot-editor__warning"
                      id={warningId}
                      role="status"
                    >
                      Smaller than
                      {' '}
                      {CUSTOM_DESIGN_MIN_TOUCH_TARGET_PX}
                      {' '}
                      ×
                      {' '}
                      {CUSTOM_DESIGN_MIN_TOUCH_TARGET_PX}
                      px. Enlarge this area or add a native Luster button.
                    </span>
                  )
                : null}
            </div>
          );
        })}
    </div>
  );
}
