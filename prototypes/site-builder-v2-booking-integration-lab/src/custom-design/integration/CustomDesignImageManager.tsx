import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  GripVertical,
  Link2,
  Trash2,
} from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';

import { CUSTOM_DESIGN_MAX_IMAGES } from '../model/constants';
import type { CustomDesignImageItem } from '../model/types';
import { CustomDesignUploadPrompt } from './CustomDesignSectionCard';
import { getCustomDesignImageAccessibilityStatus } from './owner-identity';
import type {
  CustomDesignOwnerAssetMap,
  CustomDesignUploadStatus,
} from './ui-types';

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp';

type SortableImageRowProps = {
  assetMap: CustomDesignOwnerAssetMap;
  image: CustomDesignImageItem;
  index: number;
  onAccessibility?: () => void;
  onLinkAreas?: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onReplace: (file: File) => void;
  total: number;
};

function SortableImageRow({
  assetMap,
  image,
  index,
  onAccessibility,
  onLinkAreas,
  onMove,
  onRemove,
  onReplace,
  total,
}: SortableImageRowProps) {
  const inputId = useId();
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: image.id });
  const asset = assetMap[image.assetId];
  const accessibility = getCustomDesignImageAccessibilityStatus(image);
  const reviewCount = image.interactiveAreas.filter(area =>
    area.reviewStatus === 'needs_review').length;
  const previewUrl = asset?.status === 'ready'
    ? asset.thumbnailUrl ?? asset.url
    : null;
  const assetStatus = asset?.status === 'missing' || asset?.status === 'error'
    ? asset.reason ?? 'File unavailable · Replace this page'
    : asset?.status === 'loading'
      ? 'Loading preview'
      : 'Saved';

  return (
    <li
      ref={setNodeRef}
      className={`custom-design-owner-image-row${isDragging ? ' is-dragging' : ''}`}
      data-image-item-id={image.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="custom-design-owner-image-row__preview">
        {previewUrl ? (
          <img alt="" height={image.height} loading="lazy" src={previewUrl} width={image.width} />
        ) : (
          <span aria-label="Thumbnail unavailable" role="img">Page {index + 1}</span>
        )}
      </div>
      <div className="custom-design-owner-image-row__details">
        <strong>Page {index + 1}</strong>
        <span title={image.fileName}>{image.fileName}</span>
        <span>{image.width} × {image.height}px</span>
        <span>{assetStatus}</span>
        <span>{accessibility} · {image.interactiveAreas.length} link {image.interactiveAreas.length === 1 ? 'area' : 'areas'}</span>
        {reviewCount > 0 ? (
          <span className="custom-design-owner-review-label">
            <AlertTriangle aria-hidden="true" size={14} /> Review {reviewCount} link {reviewCount === 1 ? 'position' : 'positions'}
          </span>
        ) : null}
      </div>
      <div className="custom-design-owner-image-row__move" aria-label={`Reorder page ${index + 1}`}>
        <button
          aria-label={`Move page ${index + 1} up`}
          disabled={index === 0}
          type="button"
          onClick={() => onMove(-1)}
        >
          <ArrowUp aria-hidden="true" size={17} />
        </button>
        <button
          aria-label={`Move page ${index + 1} down`}
          disabled={index === total - 1}
          type="button"
          onClick={() => onMove(1)}
        >
          <ArrowDown aria-hidden="true" size={17} />
        </button>
        <button
          aria-label={`Drag page ${index + 1}. Use arrow keys after lifting with Space.`}
          className="custom-design-owner-drag-handle"
          type="button"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden="true" size={20} />
        </button>
      </div>
      <div className="custom-design-owner-image-row__actions">
        <label htmlFor={inputId}>
          Replace
          <input
            accept={ACCEPTED_IMAGE_TYPES}
            className="visually-hidden"
            id={inputId}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) onReplace(file);
            }}
          />
        </label>
        {onAccessibility ? <button type="button" onClick={onAccessibility}>Accessibility</button> : null}
        {onLinkAreas ? (
          <button type="button" onClick={onLinkAreas}>
            <Link2 aria-hidden="true" size={16} /> Link areas
          </button>
        ) : null}
        <button type="button" onClick={onRemove}>
          <Trash2 aria-hidden="true" size={16} /> Remove
        </button>
      </div>
    </li>
  );
}

export type CustomDesignImageManagerProps = {
  assets: CustomDesignOwnerAssetMap;
  imageOrderDraft?: readonly string[];
  images: readonly CustomDesignImageItem[];
  onAddImages: (files: readonly File[]) => void;
  onCommitImageOrder: (orderedImageItemIds: readonly string[]) => void;
  onEditAreas?: (imageItemId: string) => void;
  onImageOrderDraftChange?: (orderedImageItemIds: readonly string[]) => void;
  onOpenAccessibility?: (imageItemId: string) => void;
  onRemoveImage: (imageItemId: string) => void;
  onReplaceImage: (imageItemId: string, file: File) => void;
  uploadStatus?: CustomDesignUploadStatus;
};

/**
 * The one Custom Design image manager used by both the universal Builder and
 * onboarding's narrow Canva handoff. Asset storage and document mutations stay
 * with each caller's shared transaction controller.
 */
export function CustomDesignImageManager({
  assets,
  imageOrderDraft,
  images,
  onAddImages,
  onCommitImageOrder,
  onEditAreas,
  onImageOrderDraftChange,
  onOpenAccessibility,
  onRemoveImage,
  onReplaceImage,
  uploadStatus,
}: CustomDesignImageManagerProps) {
  const canonicalOrder = images.map(image => image.id).join('|');
  const [draftOrder, setDraftOrder] = useState(() => images.map(image => image.id));
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (imageOrderDraft === undefined) setDraftOrder(images.map(image => image.id));
  }, [canonicalOrder, imageOrderDraft]);

  const imagesById = useMemo(() => new Map(images.map(image => [image.id, image])), [images]);
  const activeDraftOrder = imageOrderDraft ?? draftOrder;
  const orderDirty = activeDraftOrder.length !== images.length
    || activeDraftOrder.some((id, index) => id !== images[index]?.id);
  const orderedImages = activeDraftOrder
    .map(id => imagesById.get(id))
    .filter((image): image is CustomDesignImageItem => Boolean(image));
  const updateDraftOrder = (next: readonly string[]) => {
    if (imageOrderDraft === undefined) setDraftOrder([...next]);
    onImageOrderDraftChange?.([...next]);
  };
  const moveImage = (id: string, direction: -1 | 1) => {
    const from = activeDraftOrder.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= activeDraftOrder.length) return;
    updateDraftOrder(arrayMove([...activeDraftOrder], from, to));
  };
  const dragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const from = activeDraftOrder.indexOf(String(event.active.id));
    const to = activeDraftOrder.indexOf(String(event.over.id));
    if (from < 0 || to < 0) return;
    updateDraftOrder(arrayMove([...activeDraftOrder], from, to));
  };

  return (
    <section className="custom-design-owner-settings-group">
      <div className="custom-design-owner-section-heading">
        <div>
          <h3>Images</h3>
          <p>{images.length} of {CUSTOM_DESIGN_MAX_IMAGES} pages</p>
        </div>
      </div>
      {images.length === 0 ? (
        <CustomDesignUploadPrompt
          disabled={uploadStatus?.pending}
          onChooseImages={onAddImages}
          status={uploadStatus}
        />
      ) : (
        <>
          <DndContext collisionDetection={closestCenter} sensors={sensors} onDragEnd={dragEnd}>
            <SortableContext items={[...activeDraftOrder]} strategy={verticalListSortingStrategy}>
              <ol className="custom-design-owner-image-list">
                {orderedImages.map((image, index) => (
                  <SortableImageRow
                    assetMap={assets}
                    image={image}
                    index={index}
                    key={image.id}
                    total={orderedImages.length}
                    onAccessibility={onOpenAccessibility
                      ? () => onOpenAccessibility(image.id)
                      : undefined}
                    onLinkAreas={onEditAreas ? () => onEditAreas(image.id) : undefined}
                    onMove={direction => moveImage(image.id, direction)}
                    onRemove={() => onRemoveImage(image.id)}
                    onReplace={file => onReplaceImage(image.id, file)}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
          {orderedImages.some((image) => (
            image.height / image.width >= 2 && !image.accessibleSummary?.trim()
          )) ? (
            <div className="custom-design-owner-inline-warning">
              <AlertTriangle aria-hidden="true" size={18} />
              <p>Text inside an image cannot be selected, translated, or read reliably by assistive technology. Add an accessible text version for important information.</p>
            </div>
          ) : null}
          {orderDirty ? (
            <div className="custom-design-owner-order-actions" role="group" aria-label="Image order changes">
              <button type="button" onClick={() => updateDraftOrder(images.map(image => image.id))}>
                Cancel order
              </button>
              <button className="primary-button" type="button" onClick={() => onCommitImageOrder(activeDraftOrder)}>
                Save order
              </button>
            </div>
          ) : null}
          {images.length < CUSTOM_DESIGN_MAX_IMAGES ? (
            <CustomDesignUploadPrompt
              compact
              disabled={uploadStatus?.pending}
              onChooseImages={onAddImages}
              status={uploadStatus}
            />
          ) : uploadStatus?.message ? (
            <div className="custom-design-owner-upload-feedback" role="status">
              <p>{uploadStatus.message}</p>
              {uploadStatus.failures?.length ? (
                <ul className="custom-design-owner-errors">
                  {uploadStatus.failures.map((failure, index) => (
                    <li key={`${failure.fileName}:${index}`}>
                      <strong>{failure.fileName}:</strong> {failure.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
