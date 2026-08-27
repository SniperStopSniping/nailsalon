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
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';

import { Dialog } from '../../ui/Dialog';
import {
  CUSTOM_DESIGN_MAX_IMAGES,
} from '../model/constants';
import { normalizeCustomDesignHexColor } from '../model/settings';
import type {
  CustomDesignAction,
  CustomDesignBackground,
  CustomDesignCtaPlacement,
  CustomDesignDisplayMode,
  CustomDesignGap,
  CustomDesignImageItem,
  CustomDesignNativeCta,
  CustomDesignSettings,
} from '../model/types';
import {
  ActionEditor,
  type CustomDesignActionType,
} from './ActionEditor';
import { CustomDesignReadinessPanel } from './CustomDesignReadinessPanel';
import { CustomDesignUploadPrompt } from './CustomDesignSectionCard';
import { getCustomDesignImageAccessibilityStatus } from './owner-identity';
import type {
  CustomDesignAccessibilityUpdate,
  CustomDesignInternalPageOption,
  CustomDesignOwnerAssetMap,
  CustomDesignReadinessIssue,
  CustomDesignUploadStatus,
} from './ui-types';

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp';
const CONTACT_ACTION_TYPES: readonly CustomDesignActionType[] = [
  'directions',
  'instagram',
  'website',
  'call',
  'text',
  'email',
  'internal',
];

type SortableImageRowProps = {
  assetMap: CustomDesignOwnerAssetMap;
  image: CustomDesignImageItem;
  index: number;
  onAccessibility: () => void;
  onLinkAreas: () => void;
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
        <button type="button" onClick={onAccessibility}>Accessibility</button>
        <button type="button" onClick={onLinkAreas}>
          <Link2 aria-hidden="true" size={16} /> Link areas
        </button>
        <button type="button" onClick={onRemove}>
          <Trash2 aria-hidden="true" size={16} /> Remove
        </button>
      </div>
    </li>
  );
}

type AccessibilityDialogProps = {
  image: CustomDesignImageItem;
  onCancel: () => void;
  onSave: (update: CustomDesignAccessibilityUpdate) => void;
};

function AccessibilityDialog({ image, onCancel, onSave }: AccessibilityDialogProps) {
  const [decorative, setDecorative] = useState(image.decorative);
  const [altText, setAltText] = useState(image.altText);
  const [accessibleSummary, setAccessibleSummary] = useState(
    image.accessibleSummary ?? '',
  );
  const likelyTextHeavy = image.height / image.width >= 2;

  return (
    <Dialog
      description={`Page ${image.fileName}`}
      onClose={onCancel}
      open
      title="Accessibility"
      variant="sheet"
    >
      <div className="custom-design-owner-accessibility">
        {likelyTextHeavy ? (
          <div className="custom-design-owner-inline-warning">
            <AlertTriangle aria-hidden="true" size={18} />
            <p>Text inside an image cannot be selected, translated, or read reliably by assistive technology. Add an accessible text version for important information.</p>
          </div>
        ) : null}
        <label className="custom-design-owner-check">
          <input
            checked={decorative}
            type="checkbox"
            onChange={event => setDecorative(event.target.checked)}
          />
          Decorative image
        </label>
        <p className="custom-design-owner-helper">
          Decorative images use empty alt text. Link areas still need their own accessible labels.
        </p>
        <label>
          Alt text
          <textarea
            disabled={decorative}
            maxLength={500}
            rows={3}
            value={altText}
            onChange={event => setAltText(event.target.value)}
          />
        </label>
        <p className="custom-design-owner-helper">Describe the image’s purpose, not every visual detail.</p>
        <label>
          Accessible text version
          <textarea
            maxLength={5_000}
            rows={7}
            value={accessibleSummary}
            onChange={event => setAccessibleSummary(event.target.value)}
          />
        </label>
        <p className="custom-design-owner-helper">
          Add a text version of important policies, contact details, or instructions shown inside the image.
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button
            className="primary-button"
            type="button"
            onClick={() => onSave({
              accessibleSummary: accessibleSummary.trim() || undefined,
              altText: decorative ? '' : altText.trim(),
              decorative,
            })}
          >
            Save accessibility
          </button>
        </div>
      </div>
    </Dialog>
  );
}

type CtaKind = 'none' | 'book' | 'contact' | 'custom';

const ctaKind = (cta: CustomDesignNativeCta): CtaKind => {
  if (cta.type === 'none') return 'none';
  if (cta.type === 'book_now') return 'book';
  return CONTACT_ACTION_TYPES.includes(cta.action.type) ? 'contact' : 'custom';
};

const ctaPlacementValue = (cta: CustomDesignNativeCta): string => {
  if (cta.type === 'none' || cta.placement.type === 'after_all') return 'after_all';
  return cta.placement.imageItemId;
};

const ctaPlacementFromValue = (value: string): CustomDesignCtaPlacement =>
  value === 'after_all'
    ? { type: 'after_all' }
    : { type: 'after_image', imageItemId: value };

type NativeCtaEditorProps = {
  cta: CustomDesignNativeCta;
  images: readonly CustomDesignImageItem[];
  internalTargets: readonly CustomDesignInternalPageOption[];
  onSave: (cta: CustomDesignNativeCta) => void;
};

function NativeCtaEditor({ cta, images, internalTargets, onSave }: NativeCtaEditorProps) {
  const baseline = JSON.stringify(cta);
  const [kind, setKind] = useState<CtaKind>(() => ctaKind(cta));
  const [label, setLabel] = useState(() => cta.type === 'none' ? '' : cta.label);
  const [placement, setPlacement] = useState(() => ctaPlacementValue(cta));
  const [action, setAction] = useState<CustomDesignAction | null>(() =>
    cta.type === 'custom' ? cta.action : null);
  const [actionValid, setActionValid] = useState(() => cta.type !== 'custom' || Boolean(cta.action));

  const save = () => {
    if (kind === 'none') {
      onSave({ type: 'none' });
      return;
    }
    const safeLabel = label.trim();
    if (!safeLabel) return;
    const parsedPlacement = ctaPlacementFromValue(placement);
    if (kind === 'book') {
      onSave({ type: 'book_now', label: safeLabel, placement: parsedPlacement });
      return;
    }
    if (!action || !actionValid) return;
    onSave({
      type: 'custom',
      action,
      label: safeLabel,
      placement: parsedPlacement,
    });
  };

  const allowedTypes = kind === 'contact' ? CONTACT_ACTION_TYPES : undefined;

  return (
    <section className="custom-design-owner-settings-group">
      <h3>Native Luster button</h3>
      <p>Add one real, accessible action between pages or after the design.</p>
      <label>
        Button type
        <select
          value={kind}
          onChange={(event) => {
            const next = event.target.value as CtaKind;
            setKind(next);
            setLabel(next === 'book' ? 'Book now' : label);
            setAction(next === 'book' || next === 'none' ? null : action);
            setActionValid(
              next === 'book'
              || next === 'none'
              || (next === 'custom' && action !== null)
              || (
                next === 'contact'
                && action !== null
                && CONTACT_ACTION_TYPES.includes(action.type)
              ),
            );
          }}
        >
          <option value="none">None</option>
          <option value="book">Book now</option>
          <option value="contact">Contact / action</option>
          <option value="custom">Custom action</option>
        </select>
      </label>
      {kind !== 'none' ? (
        <>
          <label>
            Button label
            <input
              maxLength={80}
              value={label}
              onChange={event => setLabel(event.target.value)}
            />
          </label>
          <label>
            Placement
            <select value={placement} onChange={event => setPlacement(event.target.value)}>
              {images.map((image, index) => (
                <option key={image.id} value={image.id}>After page {index + 1}</option>
              ))}
              <option value="after_all">After all pages</option>
            </select>
          </label>
        </>
      ) : null}
      {kind === 'contact' || kind === 'custom' ? (
        <ActionEditor
          key={`${baseline}:${kind}`}
          action={action}
          allowedTypes={allowedTypes}
          internalTargets={internalTargets}
          onChange={setAction}
          onValidityChange={setActionValid}
        />
      ) : null}
      <button
        className="primary-button"
        disabled={kind !== 'none' && (!label.trim() || ((kind === 'contact' || kind === 'custom') && (!action || !actionValid)))}
        type="button"
        onClick={save}
      >
        Save button
      </button>
    </section>
  );
}

type CustomDesignOwnerEditorProps = {
  assets: CustomDesignOwnerAssetMap;
  internalTargets?: readonly CustomDesignInternalPageOption[];
  onAddImages: (files: readonly File[]) => void;
  onCommitImageOrder: (orderedImageItemIds: readonly string[]) => void;
  onEditAreas: (imageItemId: string) => void;
  onRemoveImage: (imageItemId: string) => void;
  onReplaceImage: (imageItemId: string, file: File) => void;
  onUpdateAccessibility: (
    imageItemId: string,
    update: CustomDesignAccessibilityUpdate,
  ) => void;
  onUpdateBackground: (background: CustomDesignBackground) => void;
  onUpdateCta: (cta: CustomDesignNativeCta) => void;
  onUpdateDisplay: (displayMode: CustomDesignDisplayMode) => void;
  onUpdateGap: (gap: CustomDesignGap) => void;
  readinessIssues?: readonly CustomDesignReadinessIssue[];
  settings: CustomDesignSettings;
  uploadStatus?: CustomDesignUploadStatus;
};

export function CustomDesignOwnerEditor({
  assets,
  internalTargets = [],
  onAddImages,
  onCommitImageOrder,
  onEditAreas,
  onRemoveImage,
  onReplaceImage,
  onUpdateAccessibility,
  onUpdateBackground,
  onUpdateCta,
  onUpdateDisplay,
  onUpdateGap,
  readinessIssues = [],
  settings,
  uploadStatus,
}: CustomDesignOwnerEditorProps) {
  const canonicalOrder = settings.images.map(image => image.id).join('|');
  const backgroundKey = settings.background.mode === 'custom'
    ? `custom:${settings.background.color}`
    : settings.background.mode;
  const [draftOrder, setDraftOrder] = useState(() => settings.images.map(image => image.id));
  const [orderDirty, setOrderDirty] = useState(false);
  const [accessibilityImageId, setAccessibilityImageId] = useState<string | null>(null);
  const [customColor, setCustomColor] = useState(() =>
    settings.background.mode === 'custom' ? settings.background.color : '#FFF8F5');
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    setDraftOrder(settings.images.map(image => image.id));
    setOrderDirty(false);
  }, [canonicalOrder]);

  useEffect(() => {
    if (settings.background.mode === 'custom') {
      setCustomColor(settings.background.color);
    }
  }, [backgroundKey]);

  const imagesById = useMemo(
    () => new Map(settings.images.map(image => [image.id, image])),
    [settings.images],
  );
  const orderedImages = draftOrder
    .map(id => imagesById.get(id))
    .filter((image): image is CustomDesignImageItem => Boolean(image));
  const accessibilityImage = accessibilityImageId
    ? imagesById.get(accessibilityImageId) ?? null
    : null;

  const moveImage = (id: string, direction: -1 | 1) => {
    const from = draftOrder.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= draftOrder.length) return;
    setDraftOrder(arrayMove(draftOrder, from, to));
    setOrderDirty(true);
  };

  const dragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const from = draftOrder.indexOf(String(event.active.id));
    const to = draftOrder.indexOf(String(event.over.id));
    if (from < 0 || to < 0) return;
    setDraftOrder(arrayMove(draftOrder, from, to));
    setOrderDirty(true);
  };

  const applyCustomColor = () => {
    const normalized = normalizeCustomDesignHexColor(customColor);
    if (normalized) onUpdateBackground({ mode: 'custom', color: normalized });
  };

  return (
    <div className="custom-design-owner-editor">
      <CustomDesignReadinessPanel issues={readinessIssues} showReady />
      <section className="custom-design-owner-settings-group">
        <div className="custom-design-owner-section-heading">
          <div>
            <h3>Images</h3>
            <p>{settings.images.length} of {CUSTOM_DESIGN_MAX_IMAGES} pages</p>
          </div>
        </div>
        {settings.images.length === 0 ? (
          <CustomDesignUploadPrompt
            disabled={uploadStatus?.pending}
            onChooseImages={onAddImages}
            status={uploadStatus}
          />
        ) : (
          <>
            <DndContext
              collisionDetection={closestCenter}
              sensors={sensors}
              onDragEnd={dragEnd}
            >
              <SortableContext items={draftOrder} strategy={verticalListSortingStrategy}>
                <ol className="custom-design-owner-image-list">
                  {orderedImages.map((image, index) => (
                    <SortableImageRow
                      assetMap={assets}
                      image={image}
                      index={index}
                      key={image.id}
                      total={orderedImages.length}
                      onAccessibility={() => setAccessibilityImageId(image.id)}
                      onLinkAreas={() => onEditAreas(image.id)}
                      onMove={direction => moveImage(image.id, direction)}
                      onRemove={() => onRemoveImage(image.id)}
                      onReplace={file => onReplaceImage(image.id, file)}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
            {orderedImages.some((image) => (
              image.height / image.width >= 2
              && !image.accessibleSummary?.trim()
            )) ? (
              <div className="custom-design-owner-inline-warning">
                <AlertTriangle aria-hidden="true" size={18} />
                <p>Text inside an image cannot be selected, translated, or read reliably by assistive technology. Add an accessible text version for important information.</p>
              </div>
            ) : null}
            {orderDirty ? (
              <div className="custom-design-owner-order-actions" role="group" aria-label="Image order changes">
                <button
                  type="button"
                  onClick={() => {
                    setDraftOrder(settings.images.map(image => image.id));
                    setOrderDirty(false);
                  }}
                >
                  Cancel order
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    onCommitImageOrder(draftOrder);
                    setOrderDirty(false);
                  }}
                >
                  Save order
                </button>
              </div>
            ) : null}
            {settings.images.length < CUSTOM_DESIGN_MAX_IMAGES ? (
              <CustomDesignUploadPrompt
                compact
                disabled={uploadStatus?.pending}
                onChooseImages={onAddImages}
                status={uploadStatus}
              />
            ) : null}
          </>
        )}
      </section>

      <section className="custom-design-owner-settings-group">
        <h3>Display</h3>
        <div className="custom-design-owner-choice-grid">
          {([
            ['poster', 'Poster', 'Full width on phones and centred on larger screens.'],
            ['contained', 'Contained', 'Uses more of the page while keeping side margins.'],
            ['full_width', 'Full width', 'Fills the full section width.'],
          ] as const).map(([value, label, description]) => (
            <label key={value}>
              <input
                checked={settings.displayMode === value}
                name="custom-design-display"
                type="radio"
                value={value}
                onChange={() => onUpdateDisplay(value)}
              />
              <span><strong>{label}</strong><small>{description}</small></span>
            </label>
          ))}
        </div>
      </section>

      <section className="custom-design-owner-settings-group">
        <h3>Image spacing</h3>
        <div className="custom-design-owner-inline-choices">
          {([
            ['seamless', 'Seamless'],
            ['small', 'Small'],
            ['comfortable', 'Comfortable'],
          ] as const).map(([value, label]) => (
            <label key={value}>
              <input
                checked={settings.gap === value}
                name="custom-design-gap"
                type="radio"
                value={value}
                onChange={() => onUpdateGap(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="custom-design-owner-settings-group">
        <h3>Background</h3>
        <div className="custom-design-owner-inline-choices">
          <label>
            <input
              checked={settings.background.mode === 'site'}
              name="custom-design-background"
              type="radio"
              onChange={() => onUpdateBackground({ mode: 'site' })}
            />
            <span>Use Site Styles</span>
          </label>
          <label>
            <input
              checked={settings.background.mode === 'transparent'}
              name="custom-design-background"
              type="radio"
              onChange={() => onUpdateBackground({ mode: 'transparent' })}
            />
            <span>Transparent</span>
          </label>
          <label>
            <input
              checked={settings.background.mode === 'custom'}
              name="custom-design-background"
              type="radio"
              onChange={applyCustomColor}
            />
            <span>Custom colour</span>
          </label>
        </div>
        <div className="custom-design-owner-color-row">
          <input
            aria-label="Custom background colour"
            type="color"
            value={normalizeCustomDesignHexColor(customColor) ?? '#FFF8F5'}
            onChange={event => setCustomColor(event.target.value)}
          />
          <input
            aria-label="Custom background hex"
            inputMode="text"
            maxLength={7}
            placeholder="#FFF8F5"
            value={customColor}
            onChange={event => setCustomColor(event.target.value)}
          />
          <button disabled={!normalizeCustomDesignHexColor(customColor)} type="button" onClick={applyCustomColor}>Apply</button>
          <button type="button" onClick={() => onUpdateBackground({ mode: 'site' })}>Reset</button>
        </div>
      </section>

      <NativeCtaEditor
        key={JSON.stringify(settings.cta)}
        cta={settings.cta}
        images={settings.images}
        internalTargets={internalTargets}
        onSave={onUpdateCta}
      />

      {accessibilityImage ? (
        <AccessibilityDialog
          key={accessibilityImage.id}
          image={accessibilityImage}
          onCancel={() => setAccessibilityImageId(null)}
          onSave={(update) => {
            onUpdateAccessibility(accessibilityImage.id, update);
            setAccessibilityImageId(null);
          }}
        />
      ) : null}
    </div>
  );
}
