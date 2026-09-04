import { AlertTriangle } from 'lucide-react';
import {
  useEffect,
  useState,
} from 'react';

import { Dialog } from '../../ui/Dialog';
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
import { CustomDesignImageManager } from './CustomDesignImageManager';
import { CustomDesignReadinessPanel } from './CustomDesignReadinessPanel';
import type {
  CustomDesignAccessibilityUpdate,
  CustomDesignInternalPageOption,
  CustomDesignOwnerAssetMap,
  CustomDesignReadinessIssue,
  CustomDesignUploadStatus,
} from './ui-types';

const EMPTY_INTERNAL_TARGETS: readonly CustomDesignInternalPageOption[] = [];
const EMPTY_READINESS_ISSUES: readonly CustomDesignReadinessIssue[] = [];

const CONTACT_ACTION_TYPES: readonly CustomDesignActionType[] = [
  'directions',
  'instagram',
  'website',
  'call',
  'text',
  'email',
  'internal',
];

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
        {likelyTextHeavy
          ? (
              <div className="custom-design-owner-inline-warning">
                <AlertTriangle aria-hidden="true" size={18} />
                <p>Text inside an image cannot be selected, translated, or read reliably by assistive technology. Add an accessible text version for important information.</p>
              </div>
            )
          : null}
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
  if (cta.type === 'none') {
    return 'none';
  }
  if (cta.type === 'book_now') {
    return 'book';
  }
  return CONTACT_ACTION_TYPES.includes(cta.action.type) ? 'contact' : 'custom';
};

const ctaPlacementValue = (cta: CustomDesignNativeCta): string => {
  if (cta.type === 'none' || cta.placement.type === 'after_all') {
    return 'after_all';
  }
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
    if (!safeLabel) {
      return;
    }
    const parsedPlacement = ctaPlacementFromValue(placement);
    if (kind === 'book') {
      onSave({ type: 'book_now', label: safeLabel, placement: parsedPlacement });
      return;
    }
    if (!action || !actionValid) {
      return;
    }
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
      {kind !== 'none'
        ? (
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
                    <option key={image.id} value={image.id}>
                      After page
                      {index + 1}
                    </option>
                  ))}
                  <option value="after_all">After all pages</option>
                </select>
              </label>
            </>
          )
        : null}
      {kind === 'contact' || kind === 'custom'
        ? (
            <ActionEditor
              key={`${baseline}:${kind}`}
              action={action}
              allowedTypes={allowedTypes}
              internalTargets={internalTargets}
              onChange={setAction}
              onValidityChange={setActionValid}
            />
          )
        : null}
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
  imageOrderDraft?: readonly string[];
  internalTargets?: readonly CustomDesignInternalPageOption[];
  onAddImages: (files: readonly File[]) => void;
  onCommitImageOrder: (orderedImageItemIds: readonly string[]) => void;
  onImageOrderDraftChange?: (orderedImageItemIds: readonly string[]) => void;
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
  imageOrderDraft,
  internalTargets = EMPTY_INTERNAL_TARGETS,
  onAddImages,
  onCommitImageOrder,
  onImageOrderDraftChange,
  onEditAreas,
  onRemoveImage,
  onReplaceImage,
  onUpdateAccessibility,
  onUpdateBackground,
  onUpdateCta,
  onUpdateDisplay,
  onUpdateGap,
  readinessIssues = EMPTY_READINESS_ISSUES,
  settings,
  uploadStatus,
}: CustomDesignOwnerEditorProps) {
  const backgroundKey = settings.background.mode === 'custom'
    ? `custom:${settings.background.color}`
    : settings.background.mode;
  const [accessibilityImageId, setAccessibilityImageId] = useState<string | null>(null);
  const [customColor, setCustomColor] = useState(() =>
    settings.background.mode === 'custom' ? settings.background.color : '#FFF8F5');

  useEffect(() => {
    if (settings.background.mode === 'custom') {
      setCustomColor(settings.background.color);
    }
  }, [backgroundKey]);

  const accessibilityImage = accessibilityImageId
    ? settings.images.find(image => image.id === accessibilityImageId) ?? null
    : null;

  const applyCustomColor = () => {
    const normalized = normalizeCustomDesignHexColor(customColor);
    if (normalized) {
      onUpdateBackground({ mode: 'custom', color: normalized });
    }
  };

  return (
    <div className="custom-design-owner-editor">
      <CustomDesignReadinessPanel issues={readinessIssues} showReady />
      <CustomDesignImageManager
        assets={assets}
        imageOrderDraft={imageOrderDraft}
        images={settings.images}
        onAddImages={onAddImages}
        onCommitImageOrder={onCommitImageOrder}
        onEditAreas={onEditAreas}
        onImageOrderDraftChange={onImageOrderDraftChange}
        onOpenAccessibility={setAccessibilityImageId}
        onRemoveImage={onRemoveImage}
        onReplaceImage={onReplaceImage}
        uploadStatus={uploadStatus}
      />

      <section className="custom-design-owner-settings-group">
        <h3>Display</h3>
        <div className="custom-design-owner-choice-grid">
          {([
            ['poster', 'Poster', 'Full width on phones and centred on larger screens.'],
            ['contained', 'Contained', 'Keeps comfortable page margins around your design.'],
            ['full_width', 'Full width', 'Fills the full customer-site width from edge to edge.'],
          ] as const).map(([value, label, description]) => (
            <label key={value}>
              <input
                checked={settings.displayMode === value}
                name="custom-design-display"
                type="radio"
                value={value}
                onChange={() => onUpdateDisplay(value)}
              />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
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
              value="site"
              onChange={() => onUpdateBackground({ mode: 'site' })}
            />
            <span>Use Site Styles</span>
          </label>
          <label>
            <input
              checked={settings.background.mode === 'transparent'}
              name="custom-design-background"
              type="radio"
              value="transparent"
              onChange={() => onUpdateBackground({ mode: 'transparent' })}
            />
            <span>Transparent</span>
          </label>
          <label>
            <input
              checked={settings.background.mode === 'custom'}
              name="custom-design-background"
              type="radio"
              value="custom"
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

      {accessibilityImage
        ? (
            <AccessibilityDialog
              key={accessibilityImage.id}
              image={accessibilityImage}
              onCancel={() => setAccessibilityImageId(null)}
              onSave={(update) => {
                onUpdateAccessibility(accessibilityImage.id, update);
                setAccessibilityImageId(null);
              }}
            />
          )
        : null}
    </div>
  );
}
