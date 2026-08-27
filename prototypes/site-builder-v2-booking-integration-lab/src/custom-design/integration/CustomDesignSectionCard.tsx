import { ImagePlus } from 'lucide-react';
import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
} from 'react';

import { CustomDesignRenderer } from '../components/CustomDesignRenderer';
import type {
  CustomDesignScrollPositionReader,
  ResolveCustomDesignAction,
  ResolveCustomDesignAsset,
} from '../components/view-types';
import type { CustomDesignSettings } from '../model/types';
import { CustomDesignReadinessPanel } from './CustomDesignReadinessPanel';
import { getCustomDesignOwnerIdentity } from './owner-identity';
import type {
  CustomDesignOwnerAssetMap,
  CustomDesignReadinessIssue,
  CustomDesignUploadStatus,
} from './ui-types';

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp';

type CustomDesignUploadPromptProps = {
  compact?: boolean;
  disabled?: boolean;
  onChooseImages: (files: readonly File[]) => void;
  status?: CustomDesignUploadStatus;
};

export function CustomDesignUploadPrompt({
  compact = false,
  disabled = false,
  onChooseImages,
  status,
}: CustomDesignUploadPromptProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length > 0) onChooseImages(files);
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = [...event.dataTransfer.files];
    if (files.length > 0) onChooseImages(files);
  };

  return (
    <div
      className="custom-design-owner-upload"
      data-compact={compact ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (
          !(event.relatedTarget instanceof Node)
          || !event.currentTarget.contains(event.relatedTarget)
        ) {
          setDragging(false);
        }
      }}
      onDragOver={event => event.preventDefault()}
      onDrop={drop}
    >
      <ImagePlus aria-hidden="true" size={compact ? 22 : 28} />
      <div>
        <h3>{compact ? 'Add more pages' : 'Upload your design'}</h3>
        {!compact ? (
          <p>Add one image or several pages from Canva, Adobe Express, Picsart, or your designer.</p>
        ) : null}
      </div>
      <label className="primary-button custom-design-owner-file-button" htmlFor={inputId}>
        {status?.pending ? 'Adding images…' : compact ? 'Choose more images' : 'Choose images'}
        <input
          accept={ACCEPTED_IMAGE_TYPES}
          className="visually-hidden"
          disabled={disabled || status?.pending}
          id={inputId}
          multiple
          type="file"
          onChange={choose}
        />
      </label>
      <p className="custom-design-owner-helper">PNG, JPG, or WebP</p>
      {!compact ? (
        <p className="custom-design-owner-helper">
          Your design will be full width on phones and centred on larger screens by default.
        </p>
      ) : null}
      <p className="custom-design-owner-drop-helper">Or drag files here on desktop.</p>
      {status?.message ? <p role="status">{status.message}</p> : null}
      {status?.failures?.length ? (
        <ul className="custom-design-owner-errors" role="status">
          {status.failures.map((failure, index) => (
            <li key={`${failure.fileName}:${index}`}>
              <strong>{failure.fileName}:</strong> {failure.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type CustomDesignCustomerPreviewProps = {
  accessibleSectionLabel?: string;
  assets: CustomDesignOwnerAssetMap;
  contentMaxWidth?: string;
  getScrollPosition?: CustomDesignScrollPositionReader;
  onAssetRenderError?: (assetId: string, imageItemId: string) => void;
  resolveAction: ResolveCustomDesignAction;
  settings: CustomDesignSettings;
};

const createAssetResolver = (
  assets: CustomDesignOwnerAssetMap,
): ResolveCustomDesignAsset => (assetId) => {
  const asset = assets[assetId];
  if (!asset || asset.status === 'loading') return { status: 'loading' };
  if (asset.status === 'ready') return { status: 'ready', url: asset.url };
  return {
    status: 'missing',
    ...(asset.reason ? { reason: asset.reason } : {}),
  };
};

export function CustomDesignCustomerPreview({
  accessibleSectionLabel,
  assets,
  contentMaxWidth,
  getScrollPosition,
  onAssetRenderError,
  resolveAction,
  settings,
}: CustomDesignCustomerPreviewProps) {
  return (
    <CustomDesignRenderer
      accessibleSectionLabel={accessibleSectionLabel}
      contentMaxWidth={contentMaxWidth}
      getScrollPosition={getScrollPosition}
      missingAssetFallback="none"
      onAssetRenderError={onAssetRenderError}
      resolveAction={resolveAction}
      resolveAsset={createAssetResolver(assets)}
      settings={settings}
    />
  );
}

type CustomDesignSectionCardProps = {
  assets: CustomDesignOwnerAssetMap;
  getScrollPosition?: CustomDesignScrollPositionReader;
  onAssetRenderError?: (assetId: string, imageItemId: string) => void;
  onChooseImages: (files: readonly File[]) => void;
  onEdit: () => void;
  onMove: () => void;
  onRemove: () => void;
  onReplaceImage: (imageItemId: string, file: File) => void;
  onSelect: () => void;
  onToggleVisible: () => void;
  order: number;
  readinessIssues?: readonly CustomDesignReadinessIssue[];
  resolveAction: ResolveCustomDesignAction;
  sectionId: string;
  selected: boolean;
  settings: CustomDesignSettings;
  uploadStatus?: CustomDesignUploadStatus;
  visible: boolean;
};

export function CustomDesignSectionCard({
  assets,
  getScrollPosition,
  onAssetRenderError,
  onChooseImages,
  onEdit,
  onMove,
  onRemove,
  onReplaceImage,
  onSelect,
  onToggleVisible,
  order,
  readinessIssues = [],
  resolveAction,
  sectionId,
  selected,
  settings,
  uploadStatus,
  visible,
}: CustomDesignSectionCardProps) {
  const identity = getCustomDesignOwnerIdentity(settings);
  const replacementInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const missingImages = settings.images.filter((image) => {
    const asset = assets[image.assetId];
    return asset?.status === 'missing' || asset?.status === 'error';
  });
  const resolveOwnerCanvasAction: ResolveCustomDesignAction = (action, source) => {
    if (source.type === 'area') {
      return { status: 'unresolved', reason: 'invalid_destination' };
    }
    const resolution = resolveAction(action, source);
    return resolution.status === 'unresolved'
      ? resolution
      : {
          status: 'button',
          onActivate: event => event.preventDefault(),
        };
  };

  const selectCard = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, label, select, textarea')) return;
    onSelect();
  };

  return (
    <article
      aria-label={`Section ${order}: Custom Design`}
      className={`section-card section-card--custom-design section-card--final-hybrid${selected ? ' is-selected' : ''}${visible ? '' : ' is-hidden'}`}
      data-section-instance-id={sectionId}
      data-section-id={sectionId}
      data-section-type="custom_design"
      data-selected={selected ? 'true' : 'false'}
      role="listitem"
      onClick={selectCard}
    >
      <header className="custom-design-owner-card-header">
        <button
          aria-pressed={selected}
          className="section-card__select-surface"
          type="button"
          onClick={onSelect}
        >
          <span className="section-card__topline">
            <span className="section-card__identity">
              <span className="section-card__number" aria-hidden="true">CD</span>
              <span>
                <strong className="section-card__title">Custom Design</strong>
                <span className="section-card__description">{identity.longDescription}</span>
              </span>
            </span>
            <span className="section-card__badges">
              {!visible ? <span className="hidden-badge">Hidden</span> : null}
              {readinessIssues.length ? <span className="size-badge">Needs attention</span> : null}
            </span>
          </span>
        </button>
      </header>

      {settings.images.length === 0 ? (
        <CustomDesignUploadPrompt
          disabled={uploadStatus?.pending}
          onChooseImages={onChooseImages}
          status={uploadStatus}
        />
      ) : (
        <>
          <div className="custom-design-owner-canvas-preview">
            <CustomDesignCustomerPreview
              accessibleSectionLabel="Custom Design owner preview"
              assets={assets}
              getScrollPosition={getScrollPosition}
              onAssetRenderError={onAssetRenderError}
              resolveAction={resolveOwnerCanvasAction}
              settings={settings}
            />
          </div>
          {missingImages.length > 0 ? (
            <div className="custom-design-owner-missing-list">
              {missingImages.map(image => (
                <section
                  className="custom-design-owner-missing-recovery"
                  key={image.id}
                >
                  <div>
                    <strong>This design file isn’t available in this browser.</strong>
                    <p>Replace it to restore the design. Your labels, links, and settings are still saved.</p>
                    <p>{image.fileName} · {image.width} × {image.height}px · {image.interactiveAreas.length} link {image.interactiveAreas.length === 1 ? 'area' : 'areas'}</p>
                  </div>
                  <button type="button" onClick={() => replacementInputs.current[image.id]?.click()}>
                    Replace image
                  </button>
                  <input
                    ref={(element) => {
                      replacementInputs.current[image.id] = element;
                    }}
                    accept={ACCEPTED_IMAGE_TYPES}
                    className="visually-hidden"
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) onReplaceImage(image.id, file);
                    }}
                  />
                </section>
              ))}
            </div>
          ) : null}
          <CustomDesignReadinessPanel issues={readinessIssues} />
        </>
      )}
    </article>
  );
}
