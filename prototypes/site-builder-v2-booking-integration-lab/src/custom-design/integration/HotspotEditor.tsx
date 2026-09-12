import { AlertTriangle, ArrowDown, ArrowUp, Link2, Plus, Trash2 } from 'lucide-react';
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Dialog } from '../../ui/Dialog';
import { HotspotOverlay } from '../components/HotspotOverlay';
import { parseCustomDesignAction } from '../model/actions';
import { CUSTOM_DESIGN_MAX_AREAS_PER_IMAGE } from '../model/constants';
import {
  canonicalizeNormalizedRect,
  type CustomDesignResizeHandle,
  isNearFullImageArea,
  moveNormalizedRect,
  rectanglesHaveInteriorOverlap,
  renderedAreaNeedsTargetWarning,
  resizeNormalizedRect,
  validateNormalizedRect,
} from '../model/geometry';
import { createCustomDesignIdFactory } from '../model/ids';
import { approveInteractiveAreaReview } from '../model/replacement';
import type {
  CustomDesignAction,
  CustomDesignImageItem,
  CustomDesignInteractiveArea,
  CustomDesignNormalizedRect,
} from '../model/types';
import { ActionEditor } from './ActionEditor';
import type {
  CustomDesignInternalPageOption,
  CustomDesignOwnerAssetState,
} from './ui-types';

const EMPTY_INTERNAL_TARGETS: readonly CustomDesignInternalPageOption[] = [];

const actionLabel = (action: CustomDesignAction): string => {
  switch (action.type) {
    case 'instagram': return `Instagram @${action.destination.username}`;
    case 'call': return `Call ${action.destination.phoneNumber}`;
    case 'text': return `Text ${action.destination.phoneNumber}`;
    case 'email': return `Email ${action.destination.email}`;
    case 'start_booking': return 'Book appointment';
    case 'directions': return 'Get directions';
    case 'internal': return 'Open page or section';
    case 'website':
    case 'custom_url': return 'Visit website';
  }
};

// A 320px customer viewport retains roughly 280px for site content after the
// frozen Preview gutters. Warn against that primary mobile experience even
// when the owner is editing a much larger desktop rendition.
const CUSTOM_DESIGN_PHONE_CONTENT_WIDTH_PX = 280;

const phoneRenderedImageSize = (
  image: CustomDesignImageItem,
): { height: number; width: number } => ({
  height: CUSTOM_DESIGN_PHONE_CONTENT_WIDTH_PX / image.aspectRatio,
  width: CUSTOM_DESIGN_PHONE_CONTENT_WIDTH_PX,
});

const cloneAreas = (
  areas: readonly CustomDesignInteractiveArea[],
): CustomDesignInteractiveArea[] => areas.map(area => ({
  ...area,
  action: structuredClone(area.action),
  geometry: { ...area.geometry },
}));

const hasOverlap = (
  areas: readonly CustomDesignInteractiveArea[],
  areaId: string,
  geometry: CustomDesignNormalizedRect,
): boolean => areas.some(area =>
  area.id !== areaId && rectanglesHaveInteriorOverlap(area.geometry, geometry));

const areaHasStaticProblem = (
  area: CustomDesignInteractiveArea,
  areas: readonly CustomDesignInteractiveArea[],
  invalidActionIds: ReadonlySet<string>,
): boolean =>
  validateNormalizedRect(area.geometry).length > 0
  || isNearFullImageArea(area.geometry)
  || hasOverlap(areas, area.id, area.geometry)
  || !area.accessibleLabel.trim()
  || !area.labelConfirmed
  || invalidActionIds.has(area.id)
  || !parseCustomDesignAction(area.action);

const withValidationStatuses = (
  areas: readonly CustomDesignInteractiveArea[],
  invalidActionIds: ReadonlySet<string>,
): CustomDesignInteractiveArea[] => areas.map(area => ({
  ...area,
  validationStatus: areaHasStaticProblem(area, areas, invalidActionIds)
    ? 'invalid'
    : 'valid',
}));

const areaIssueMessages = (
  areas: readonly CustomDesignInteractiveArea[],
  invalidActionIds: ReadonlySet<string>,
): string[] => {
  const issues: string[] = [];
  for (const area of areas) {
    const areaName = area.accessibleLabel.trim() || `Area ${area.semanticOrder + 1}`;
    if (validateNormalizedRect(area.geometry).length > 0) {
      issues.push(`${areaName} has invalid geometry.`);
    }
    if (isNearFullImageArea(area.geometry)) {
      issues.push(`${areaName} cannot cover nearly the whole image.`);
    }
    const conflicts = areas.filter(candidate => (
      candidate.id !== area.id
      && rectanglesHaveInteriorOverlap(area.geometry, candidate.geometry)
      && candidate.semanticOrder > area.semanticOrder
    ));
    for (const conflict of conflicts) {
      const conflictName = conflict.accessibleLabel.trim()
        || `Area ${conflict.semanticOrder + 1}`;
      issues.push(`${areaName} overlaps ${conflictName}. Move or resize one area.`);
    }
    if (!area.accessibleLabel.trim() || !area.labelConfirmed) {
      issues.push('Confirm an accessible label for every link area.');
    }
    if (invalidActionIds.has(area.id) || !parseCustomDesignAction(area.action)) {
      issues.push(`${areaName} needs a complete, safe action.`);
    }
    if (area.reviewStatus === 'needs_review') {
      issues.push(`${area.accessibleLabel || 'A link area'} still needs its position reviewed.`);
    }
  }
  return [...new Set(issues)];
};

const reorderAreas = (
  areas: readonly CustomDesignInteractiveArea[],
  areaId: string,
  direction: -1 | 1,
): CustomDesignInteractiveArea[] => {
  const ordered = [...areas].sort((left, right) =>
    left.semanticOrder - right.semanticOrder);
  const from = ordered.findIndex(area => area.id === areaId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ordered.length) {
    return [...areas];
  }
  const [moved] = ordered.splice(from, 1);
  if (!moved) {
    return [...areas];
  }
  ordered.splice(to, 0, moved);
  return ordered.map((area, index) => ({ ...area, semanticOrder: index }));
};

type PointerSession = {
  areaId: string;
  baseGeometry: CustomDesignNormalizedRect;
  handle?: CustomDesignResizeHandle;
  pointerId: number;
  startX: number;
  startY: number;
};

type HotspotEditorProps = {
  asset: CustomDesignOwnerAssetState;
  createAreaId?: () => string;
  image: CustomDesignImageItem | null;
  internalTargets?: readonly CustomDesignInternalPageOption[];
  onCancel: () => void;
  onCommit: (
    imageItemId: string,
    areas: readonly CustomDesignInteractiveArea[],
  ) => void;
  open: boolean;
};

export function HotspotEditor({
  asset,
  createAreaId,
  image,
  internalTargets = EMPTY_INTERNAL_TARGETS,
  onCancel,
  onCommit,
  open,
}: HotspotEditorProps) {
  const idFactory = useRef(createCustomDesignIdFactory()).current;
  const [areas, setAreas] = useState<CustomDesignInteractiveArea[]>(() =>
    cloneAreas(image?.interactiveAreas ?? []));
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(() =>
    image?.interactiveAreas[0]?.id ?? null);
  const [invalidActionIds, setInvalidActionIds] = useState<Set<string>>(() => new Set());
  const [renderedSize, setRenderedSize] = useState({ height: 0, width: 0 });
  const [interactionWarning, setInteractionWarning] = useState('');
  const [addingLink, setAddingLink] = useState(() => !image?.interactiveAreas.length);
  const [placingLink, setPlacingLink] = useState(false);
  const [newAction, setNewAction] = useState<CustomDesignAction | null>({ type: 'start_booking' });
  const [zoomed, setZoomed] = useState(false);
  const [preciseControls, setPreciseControls] = useState(false);
  const areasRef = useRef(areas);
  areasRef.current = areas;
  const imageElementRef = useRef<HTMLImageElement>(null);
  const pointerCleanupRef = useRef<(() => void) | null>(null);
  const baselineKey = `${open ? 'open' : 'closed'}:${image?.id ?? ''}:${image?.assetId ?? ''}`;

  useEffect(() => {
    if (!open) {
      return;
    }
    setAreas(cloneAreas(image?.interactiveAreas ?? []));
    setSelectedAreaId(image?.interactiveAreas[0]?.id ?? null);
    setInvalidActionIds(new Set());
    setInteractionWarning('');
    setAddingLink(!image?.interactiveAreas.length);
    setPlacingLink(false);
    setNewAction({ type: 'start_booking' });
    setZoomed(false);
    setPreciseControls(false);
  }, [baselineKey]);

  useEffect(() => () => pointerCleanupRef.current?.(), []);

  useEffect(() => {
    const element = imageElementRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setRenderedSize({ height: rect.height, width: rect.width });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [addingLink, asset.status, image?.assetId, open, placingLink]);

  const selectedArea = areas.find(area => area.id === selectedAreaId) ?? null;
  const issues = useMemo(
    () => areaIssueMessages(areas, invalidActionIds),
    [areas, invalidActionIds],
  );
  const displayAreas = useMemo(
    () => withValidationStatuses(areas, invalidActionIds),
    [areas, invalidActionIds],
  );

  const updateArea = (
    areaId: string,
    updater: (area: CustomDesignInteractiveArea) => CustomDesignInteractiveArea,
  ) => setAreas(current => current.map(area =>
    area.id === areaId ? updater(area) : area));

  const tryGeometry = (
    areaId: string,
    geometry: CustomDesignNormalizedRect,
  ) => {
    const canonical = canonicalizeNormalizedRect(geometry).rect;
    const overlaps = hasOverlap(areasRef.current, areaId, canonical);
    const nextAreas = areasRef.current.map(area =>
      area.id === areaId ? { ...area, geometry: canonical } : area);
    areasRef.current = nextAreas;
    setAreas(nextAreas);
    if (isNearFullImageArea(canonical)) {
      setInteractionWarning('A link area cannot cover nearly the whole image.');
      return;
    }
    if (overlaps) {
      setInteractionWarning('Clickable areas cannot overlap. Move or resize this area again.');
      return;
    }
    setInteractionWarning('');
  };

  const startPointerSession = (
    areaId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
    handle?: CustomDesignResizeHandle,
  ) => {
    if (event.button !== 0) {
      return;
    }
    const area = areas.find(candidate => candidate.id === areaId);
    if (!area) {
      return;
    }
    event.preventDefault();
    setSelectedAreaId(areaId);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointerCleanupRef.current?.();
    const owner = event.currentTarget;
    const session: PointerSession = {
      areaId,
      baseGeometry: { ...area.geometry },
      ...(handle ? { handle } : {}),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== session.pointerId) {
        return;
      }
      const delta = {
        x: pointerEvent.clientX - session.startX,
        y: pointerEvent.clientY - session.startY,
      };
      const result = session.handle
        ? resizeNormalizedRect(
          session.baseGeometry,
          session.handle,
          delta,
          renderedSize,
        )
        : moveNormalizedRect(session.baseGeometry, delta, renderedSize);
      tryGeometry(session.areaId, result.rect);
    };
    function cleanup() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (owner.hasPointerCapture?.(session.pointerId)) {
        owner.releasePointerCapture?.(session.pointerId);
      }
      if (pointerCleanupRef.current === cleanup) {
        pointerCleanupRef.current = null;
      }
    }
    function end(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId === session.pointerId) {
        cleanup();
      }
    }
    pointerCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const placeArea = (centerX: number, centerY: number) => {
    if (!newAction || areas.length >= CUSTOM_DESIGN_MAX_AREAS_PER_IMAGE) {
      return;
    }
    const width = 40;
    const height = Math.min(12, 44 / Math.max(renderedSize.height, 1) * 100);
    const geometry = canonicalizeNormalizedRect({
      x: Math.max(0, Math.min(100 - width, centerX - width / 2)),
      y: Math.max(0, Math.min(100 - height, centerY - height / 2)),
      width,
      height,
    }).rect;
    const id = createAreaId?.() ?? idFactory('area');
    const area: CustomDesignInteractiveArea = {
      id,
      accessibleLabel: actionLabel(newAction).slice(0, 200),
      action: newAction,
      appearance: 'button',
      geometry: { ...geometry },
      labelConfirmed: true,
      reviewStatus: 'approved',
      semanticOrder: areas.length,
      validationStatus: 'valid',
    };
    setAreas(current => [...current, area]);
    setSelectedAreaId(id);
    setPlacingLink(false);
    setAddingLink(false);
    setInteractionWarning('Drag the button into place. Adjust its corners to fit your printed text or icon.');
  };

  const changeSelectedAction = (action: CustomDesignAction | null) => {
    if (!selectedArea) {
      return;
    }
    setInvalidActionIds((current) => {
      const next = new Set(current);
      if (action) {
        next.delete(selectedArea.id);
      } else {
        next.add(selectedArea.id);
      }
      return next;
    });
    if (action) {
      updateArea(selectedArea.id, area => ({ ...area, action }));
    }
  };

  const commit = () => {
    if (!image || addingLink || placingLink || issues.length > 0) {
      return;
    }
    const committed = withValidationStatuses(areas, invalidActionIds)
      .sort((left, right) => left.semanticOrder - right.semanticOrder)
      .map((area, semanticOrder) => ({
        ...area,
        geometry: canonicalizeNormalizedRect(area.geometry).rect,
        semanticOrder,
      }));
    onCommit(image.id, committed);
  };

  const readyAssetUrl = asset.status === 'ready' ? asset.url : null;

  return (
    <Dialog
      description="Make the text and icons in your artwork clickable. Your design stays visible inside each button."
      initialFocusSelector="[data-hotspot-add]:not(:disabled)"
      onClose={onCancel}
      open={open}
      title="Link areas"
      variant="sheet"
    >
      <div className="custom-design-owner-hotspot-session">
        <div className="custom-design-owner-hotspot-toolbar">
          <p aria-live="polite">
            {areas.length}
            {' '}
            of
            {' '}
            {CUSTOM_DESIGN_MAX_AREAS_PER_IMAGE}
            {' '}
            areas
          </p>
          <button
            className="primary-button"
            data-hotspot-add
            disabled={addingLink || !readyAssetUrl || areas.length >= CUSTOM_DESIGN_MAX_AREAS_PER_IMAGE}
            type="button"
            onClick={() => {
              setAddingLink(true);
              setPlacingLink(false);
              setInteractionWarning('');
              setNewAction({ type: 'start_booking' });
            }}
          >
            <Plus aria-hidden="true" size={18} />
            {' '}
            Add link
          </button>
        </div>

        {addingLink && !placingLink
          ? (
              <section className="custom-design-owner-hotspot-details">
                <h3>What should this button do?</h3>
                <ActionEditor
                  key="new-link"
                  action={newAction}
                  internalTargets={internalTargets}
                  onChange={setNewAction}
                  typePicker="buttons"
                />
                <p>Next, put the button around the matching text or icon in your design.</p>
                <button className="primary-button" disabled={!newAction || asset.status !== 'ready'} type="button" onClick={() => setPlacingLink(true)}>
                  Place button on design
                </button>
                <button type="button" onClick={() => setAddingLink(false)}>Cancel new link</button>
              </section>
            )
          : null}

        {(!addingLink || placingLink) && readyAssetUrl && image
          ? (
              <div className="custom-design-owner-placement-bar">
                <p role="status">{placingLink ? 'Tap the text or icon you want to make clickable.' : 'Drag to move. Use the corners to resize.'}</p>
                <button aria-pressed={zoomed} type="button" onClick={() => setZoomed(current => !current)}>{zoomed ? 'Fit design' : 'Zoom in'}</button>
                {!placingLink ? <button aria-pressed={preciseControls} type="button" onClick={() => setPreciseControls(current => !current)}>More resize controls</button> : null}
                {placingLink ? <button type="button" onClick={() => placeArea(50, 50)}>Place in centre</button> : null}
              </div>
            )
          : null}

        {addingLink && !placingLink
          ? null
          : readyAssetUrl && image
            ? (
                <div className="custom-design-owner-hotspot-stage-wrap" data-zoomed={zoomed ? 'true' : 'false'}>
                  <div className="custom-design-owner-hotspot-stage" data-placing={placingLink ? 'true' : 'false'}>
                    <img
                      ref={imageElementRef}
                      alt="Design being edited"
                      height={image.height}
                      src={readyAssetUrl}
                      width={image.width}
                      onLoad={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setRenderedSize({ height: rect.height, width: rect.width });
                      }}
                    />
                    {placingLink
                      ? (
                          <button
                            aria-label="Place button here"
                            className="custom-design-owner-placement-surface"
                            type="button"
                            onClick={(event) => {
                              const rect = imageElementRef.current?.getBoundingClientRect();
                              if (!rect?.width || !rect.height) {
                                return;
                              }
                              // Native keyboard activation places centrally; pointers
                              // use the actual artwork coordinates at the current zoom.
                              placeArea(
                                event.detail === 0 ? 50 : ((event.clientX - rect.left) / rect.width) * 100,
                                event.detail === 0 ? 50 : ((event.clientY - rect.top) / rect.height) * 100,
                              );
                            }}
                          />
                        )
                      : null}
                    <HotspotOverlay
                      areas={displayAreas}
                      compact={!preciseControls}
                      renderedHeight={renderedSize.height}
                      renderedWidth={renderedSize.width}
                      selectedAreaId={!placingLink ? selectedAreaId ?? undefined : undefined}
                      onKeyboardMove={(areaId, delta) => {
                        const area = areas.find(candidate => candidate.id === areaId);
                        if (area) {
                          tryGeometry(areaId, moveNormalizedRect(
                            area.geometry,
                            delta,
                            renderedSize,
                          ).rect);
                        }
                      }}
                      onKeyboardResize={(areaId, handle, delta) => {
                        const area = areas.find(candidate => candidate.id === areaId);
                        if (area) {
                          tryGeometry(areaId, resizeNormalizedRect(
                            area.geometry,
                            handle,
                            delta,
                            renderedSize,
                          ).rect);
                        }
                      }}
                      onMoveStart={(areaId, event) => startPointerSession(areaId, event)}
                      onResizeStart={(areaId, handle, event) =>
                        startPointerSession(areaId, event, handle)}
                      onSelect={setSelectedAreaId}
                    />
                  </div>
                </div>
              )
            : (
                <div className="custom-design-owner-missing-recovery">
                  <strong>This design file isn’t available in this browser.</strong>
                  <p>Replace it before editing link positions. Your existing labels and actions remain saved.</p>
                </div>
              )}

        {interactionWarning
          ? (
              <p className="custom-design-owner-inline-warning" role="status">
                <AlertTriangle aria-hidden="true" size={18} />
                {' '}
                {interactionWarning}
              </p>
            )
          : null}

        {!addingLink && selectedArea
          ? (
              <section className="custom-design-owner-hotspot-details">
                <div className="custom-design-owner-section-heading">
                  <div>
                    <h3>Edit link area</h3>
                    <p>
                      Area
                      {selectedArea.semanticOrder + 1}
                      {' '}
                      of
                      {areas.length}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const remaining = areas.filter(area => area.id !== selectedArea.id)
                        .sort((left, right) => left.semanticOrder - right.semanticOrder)
                        .map((area, index) => ({ ...area, semanticOrder: index }));
                      setAreas(remaining);
                      setSelectedAreaId(remaining[0]?.id ?? null);
                      setInvalidActionIds((current) => {
                        const next = new Set(current);
                        next.delete(selectedArea.id);
                        return next;
                      });
                    }}
                  >
                    <Trash2 aria-hidden="true" size={17} />
                    {' '}
                    Remove area
                  </button>
                </div>
                <label>
                  Accessible label
                  <input
                    maxLength={200}
                    value={selectedArea.accessibleLabel}
                    onChange={event => updateArea(selectedArea.id, area => ({
                      ...area,
                      accessibleLabel: event.target.value,
                      labelConfirmed: false,
                    }))}
                  />
                </label>
                <label className="custom-design-owner-check">
                  <input
                    checked={selectedArea.appearance === 'button'}
                    type="checkbox"
                    onChange={event => updateArea(selectedArea.id, area => ({
                      ...area,
                      appearance: event.target.checked ? 'button' : undefined,
                    }))}
                  />
                  Show as a raised button
                </label>
                <label className="custom-design-owner-check">
                  <input
                    checked={selectedArea.labelConfirmed}
                    disabled={!selectedArea.accessibleLabel.trim()}
                    type="checkbox"
                    onChange={event => updateArea(selectedArea.id, area => ({
                      ...area,
                      labelConfirmed: event.target.checked,
                    }))}
                  />
                  I confirm this label explains the action
                </label>
                <ActionEditor
                  key={selectedArea.id}
                  action={selectedArea.action}
                  internalTargets={internalTargets}
                  onChange={changeSelectedAction}
                />
                <div className="custom-design-owner-area-order" role="group" aria-label="Link area reading order">
                  <span>
                    Reading order:
                    {selectedArea.semanticOrder + 1}
                  </span>
                  <button
                    aria-label="Move link area earlier"
                    disabled={selectedArea.semanticOrder === 0}
                    type="button"
                    onClick={() => setAreas(current => reorderAreas(current, selectedArea.id, -1))}
                  >
                    <ArrowUp aria-hidden="true" size={17} />
                    {' '}
                    Earlier
                  </button>
                  <button
                    aria-label="Move link area later"
                    disabled={selectedArea.semanticOrder === areas.length - 1}
                    type="button"
                    onClick={() => setAreas(current => reorderAreas(current, selectedArea.id, 1))}
                  >
                    <ArrowDown aria-hidden="true" size={17} />
                    {' '}
                    Later
                  </button>
                </div>
                {selectedArea.reviewStatus === 'needs_review'
                  ? (
                      <div className="custom-design-owner-review-card">
                        <AlertTriangle aria-hidden="true" size={18} />
                        <div>
                          <strong>Review link positions</strong>
                          <p>This image has different proportions. Check the clickable areas before publishing.</p>
                          <button
                            type="button"
                            onClick={() => updateArea(selectedArea.id, approveInteractiveAreaReview)}
                          >
                            Approve this position
                          </button>
                        </div>
                      </div>
                    )
                  : null}
                {renderedSize.width > 0 && (
                  renderedAreaNeedsTargetWarning(selectedArea.geometry, renderedSize)
                  || (image && renderedAreaNeedsTargetWarning(
                    selectedArea.geometry,
                    phoneRenderedImageSize(image),
                  ))
                )
                  ? (
                      <p className="custom-design-owner-inline-warning" role="status">
                        <AlertTriangle aria-hidden="true" size={18} />
                        This link may be difficult to tap on phones. Enlarge it or add a native Luster button.
                      </p>
                    )
                  : null}
              </section>
            )
          : !addingLink
              ? (
                  <div className="custom-design-owner-hotspot-empty">
                    <Link2 aria-hidden="true" size={22} />
                    <p>Add a link to make part of your design clickable.</p>
                  </div>
                )
              : null}

        {issues.length > 0
          ? (
              <div className="custom-design-owner-errors" role="status">
                <strong>Finish these link areas</strong>
                <ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
              </div>
            )
          : null}

        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button
            className="primary-button"
            disabled={!image || !readyAssetUrl || addingLink || placingLink || issues.length > 0}
            type="button"
            onClick={commit}
          >
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}
