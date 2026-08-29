import { FileImage, Images, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import {
  useCustomDesignAssetMap,
  useCustomDesignAssetRepository,
  type CustomDesignAssetUrlPair,
} from '../../custom-design/integration/CustomDesignAssetProvider';
import { CustomDesignImageManager } from '../../custom-design/integration/CustomDesignImageManager';
import type {
  CustomDesignUploadFailure,
  CustomDesignUploadStatus,
} from '../../custom-design/integration/ui-types';
import { formatCustomDesignUploadSummary } from '../../custom-design/integration/upload-summary';
import type { CustomDesignSectionInstance, SiteBuilderDocument } from '../../model';
import { Dialog } from '../../ui/Dialog';
import { toCustomDesignOwnerAssetMap } from '../../ui/custom-design-adapters';
import {
  CANVA_UPLOADS_UNAVAILABLE_MESSAGE,
  locateOnboardingCustomDesign,
  type CanvaIntegrationController,
  type CanvaIntegrationResult,
  type CanvaManagerResult,
} from '../extras/useCanvaIntegration';
import {
  ONBOARDING_GALLERY_MAX_FILES,
  ONBOARDING_GALLERY_MAX_TOTAL_BYTES,
} from '../model/local-images';
import {
  onboardingMediaPort,
  resolveOnboardingImageUrl,
} from '../integrations/adapters/media';
import type {
  CanvaDisplayMode,
  CanvaPlacement,
  GalleryLayout,
  LocalImageReference,
  OnboardingLabState,
} from '../model/types';
import type { OnboardingStateUpdater } from '../screens/DesignScreens';

const MOCK_GALLERY_IMAGES: LocalImageReference[] = [
  { altText: 'Precision Russian manicure', fileName: 'russian-manicure.webp', id: 'gallery-mock-russian', mimeType: 'image/webp', previewUrl: '/manicure-russian-clean.webp', source: 'fixture' },
  { altText: 'Glossy nude gel manicure', fileName: 'nude-gel.webp', id: 'gallery-mock-nude', mimeType: 'image/webp', previewUrl: '/manicure-gel-nude.webp', source: 'fixture' },
  { altText: 'Pearl chrome manicure', fileName: 'pearl-chrome.webp', id: 'gallery-mock-pearl', mimeType: 'image/webp', previewUrl: '/manicure-pearl-chrome.webp', source: 'fixture' },
  { altText: 'French manicure', fileName: 'french.webp', id: 'gallery-mock-french', mimeType: 'image/webp', previewUrl: '/manicure-french.webp', source: 'fixture' },
];

type GalleryDialogProps = {
  onClose: () => void;
  onUpdate: OnboardingStateUpdater;
  open: boolean;
  state: OnboardingLabState;
};

export function GalleryDialog({ onClose, onUpdate, open, state }: GalleryDialogProps) {
  const inputId = useId();
  const repository = useCustomDesignAssetRepository();
  const [error, setError] = useState('');
  const [showAllFailures, setShowAllFailures] = useState(false);
  const [uploadFailures, setUploadFailures] = useState<CustomDesignUploadFailure[]>([]);
  const galleryAssetIds = useMemo(() => state.gallery.images.flatMap((image) =>
    image.storageId ? [image.storageId] : []), [state.gallery.images]);
  const galleryAssets = useCustomDesignAssetMap(galleryAssetIds);
  const missingGalleryImages = state.gallery.images.filter((image) => image.source === 'missing');
  const addUploads = async (files: readonly File[]) => {
    try {
      if (!repository) {
        throw new Error('Photo storage is unavailable in this browser.');
      }
      const upfrontFailures: CustomDesignUploadFailure[] = [];
      const acceptedForDecode: File[] = [];
      let acceptedBytes = 0;
      const existingUploads = state.gallery.source === 'uploads'
        ? state.gallery.images.filter((image) => image.source !== 'missing')
        : [];
      const remainingCapacity = Math.max(
        0,
        ONBOARDING_GALLERY_MAX_FILES - existingUploads.length,
      );
      for (const file of files) {
        if (acceptedForDecode.length >= remainingCapacity) {
          upfrontFailures.push({
            code: 'too_many_images',
            fileName: file.name,
            message: `Skipped because a Gallery can contain up to ${ONBOARDING_GALLERY_MAX_FILES} images.`,
          });
          continue;
        }
        if (acceptedBytes + file.size > ONBOARDING_GALLERY_MAX_TOTAL_BYTES) {
          upfrontFailures.push({
            code: 'selection_too_large',
            fileName: file.name,
            message: 'Skipped to keep the Gallery upload under 3 MB.',
          });
          continue;
        }
        acceptedForDecode.push(file);
        acceptedBytes += file.size;
      }
      const result = await onboardingMediaPort.storeBatch(
        repository,
        acceptedForDecode,
        'gallery',
      );
      const images = result.accepted;
      const failures = [
        ...upfrontFailures,
        ...result.failures,
      ];
      const rejected = failures.length;
      if (images.length > 0) {
        onUpdate((current) => ({
          ...current,
          gallery: {
            ...current.gallery,
            images: current.gallery.source === 'uploads'
              ? [
                  ...current.gallery.images.filter((image) => image.source !== 'missing'),
                  ...images,
                ]
              : images,
            source: 'uploads',
          },
        }));
      }
      setShowAllFailures(false);
      setUploadFailures(failures);
      if (rejected === 0) {
        setError('');
      } else if (images.length === 0) {
        setError(`No images were added. ${rejected} ${rejected === 1 ? 'image was' : 'images were'} skipped.`);
      } else {
        setError(`${images.length} ${images.length === 1 ? 'image was' : 'images were'} added and ${rejected} ${rejected === 1 ? 'was' : 'were'} skipped.`);
      }
    } catch (cause) {
      setShowAllFailures(false);
      setUploadFailures([]);
      setError(cause instanceof Error ? cause.message : 'The selected images could not be read.');
    }
  };
  const selectTemporaryExamples = async () => {
    const removedUploads = state.gallery.source === 'uploads'
      ? state.gallery.images.filter((image) => image.source === 'indexed_db' && image.storageId)
      : [];
    const cleanupIds = removedUploads.flatMap((image) => image.storageId ? [image.storageId] : []);
    onUpdate((current) => ({
      ...current,
      canva: {
        ...current.canva,
        ownedAssetIds: [...new Set([...current.canva.ownedAssetIds, ...cleanupIds])],
      },
      gallery: { ...current.gallery, images: MOCK_GALLERY_IMAGES, source: 'mock_luster' },
    }));
    setShowAllFailures(false);
    setUploadFailures([]);
    if (cleanupIds.length === 0) {
      setError('');
      return;
    }
    if (!repository) {
      setError('The example photos are selected. This browser will retry cleaning up the earlier uploads later.');
      return;
    }
    const cleanupErrors = await onboardingMediaPort.deleteOwned(repository, removedUploads);
    if (cleanupErrors.length > 0) {
      setError('The example photos are selected. This browser will retry cleaning up the earlier uploads later.');
      return;
    }
    const cleanedIds = new Set(cleanupIds);
    onUpdate((current) => ({
      ...current,
      canva: {
        ...current.canva,
        ownedAssetIds: current.canva.ownedAssetIds.filter((assetId) => !cleanedIds.has(assetId)),
      },
    }));
    setError('');
  };
  const canAdd = state.gallery.source !== null && (
    state.gallery.source === 'mock_luster'
    || state.gallery.images.some((image) => image.source !== 'missing')
  );
  const save = () => {
    if (!canAdd) {
      setError('Choose portfolio images or temporary example photos first.');
      return;
    }
    onUpdate((current) => ({
      ...current,
      recipe: { ...current.recipe, galleryEnabled: true },
    }));
    onClose();
  };

  return (
    <Dialog description="Choose the work and layout clients will see in your Gallery." onClose={onClose} open={open} title="Add Gallery" variant="bottom-sheet">
      <div className="onboarding-subflow">
        <Images aria-hidden="true" size={28} />
        <div className="onboarding-subflow-choice-grid">
          <button
            aria-pressed={state.gallery.source === 'mock_luster'}
            type="button"
            onClick={() => { void selectTemporaryExamples(); }}
          >
            <strong>Use temporary example photos</strong><small>Four sample nail photos for this setup preview</small>
          </button>
          <label htmlFor={inputId} className="onboarding-upload-choice">
            <strong>Upload portfolio photos</strong><small>PNG, JPG, or WebP</small>
          </label>
          <input
            accept="image/png,image/jpeg,image/webp"
            className="visually-hidden"
            id={inputId}
            multiple
            type="file"
            onChange={(event) => {
              void addUploads([...event.target.files ?? []]);
              event.target.value = '';
            }}
          />
        </div>
        {state.gallery.images.length > 0 ? (
          <div className="onboarding-upload-thumbnails">
            {state.gallery.images.map((image) => {
              const source = resolveOnboardingImageUrl(image, galleryAssets);
              return source
                ? <img alt={image.altText ?? ''} key={image.id} src={source} />
                : null;
            })}
          </div>
        ) : null}
        {missingGalleryImages.length > 0 ? (
          <div className="onboarding-inline-error" role="status">
            <p>{missingGalleryImages.length === 1
              ? 'One saved Gallery image is no longer available on this device. Select it again to restore it.'
              : `${missingGalleryImages.length} saved Gallery images are no longer available on this device. Select them again to restore them.`}</p>
            <ul>
              {missingGalleryImages.map((image) => <li key={image.id}>{image.fileName}</li>)}
            </ul>
          </div>
        ) : null}
        <fieldset className="onboarding-layout-choice"><legend>Gallery layout</legend>
          {(['grid', 'carousel', 'editorial'] as GalleryLayout[]).map((layout) => <label key={layout}><input checked={state.gallery.layout === layout} name="gallery-layout" type="radio" onChange={() => onUpdate((current) => ({ ...current, gallery: { ...current.gallery, layout } }))} /><span>{layout}</span></label>)}
        </fieldset>
        {error ? (
          <div className="onboarding-inline-error" role="alert">
            <p>{error}</p>
            {uploadFailures.length > 0 ? (
              <ul>
                {(showAllFailures ? uploadFailures : uploadFailures.slice(0, 4)).map((failure, index) => (
                  <li key={`${failure.fileName}:${index}`}>
                    <strong>{failure.fileName}:</strong> {failure.message}
                  </li>
                ))}
              </ul>
            ) : null}
            {uploadFailures.length > 4 ? (
              <button type="button" onClick={() => setShowAllFailures((current) => !current)}>
                {showAllFailures
                  ? 'Show fewer rejected files'
                  : `Show ${uploadFailures.length - 4} more rejected ${uploadFailures.length - 4 === 1 ? 'file' : 'files'}`}
              </button>
            ) : null}
          </div>
        ) : null}
        <footer className="onboarding-overlay-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          {state.recipe.galleryEnabled ? <button type="button" onClick={() => { onUpdate((current) => ({ ...current, recipe: { ...current.recipe, galleryEnabled: false } })); onClose(); }}>Remove Gallery</button> : null}
          <button className="is-primary" type="button" onClick={save}>Add Gallery</button>
        </footer>
      </div>
    </Dialog>
  );
}

type CanvaDialogProps = {
  available: boolean;
  controller?: CanvaIntegrationController;
  document?: SiteBuilderDocument | null;
  onAdd: (files: readonly File[], displayMode: CanvaDisplayMode, placement: CanvaPlacement) => Promise<CanvaIntegrationResult>;
  onClose: () => void;
  onUpdate?: OnboardingStateUpdater;
  open: boolean;
  state: OnboardingLabState;
};

const getReadyAssetUrl = (
  assets: CustomDesignAssetUrlPair | undefined,
): string | null => {
  if (assets?.thumbnail.status === 'ready') return assets.thumbnail.url;
  if (assets?.original.status === 'ready') return assets.original.url;
  return null;
};

function SavedCanvaPages({ images }: { images: readonly LocalImageReference[] }) {
  const assetIds = useMemo(() => images.flatMap((image) =>
    image.storageId ? [image.storageId] : []), [images]);
  const assets = useCustomDesignAssetMap(assetIds);

  return (
    <section aria-labelledby="saved-canva-pages-heading" className="onboarding-saved-canva-pages">
      <p id="saved-canva-pages-heading">Already added</p>
      <ul aria-label="Saved Canva pages" className="onboarding-file-list onboarding-file-list--visual">
        {images.map((image) => {
          const pair = image.storageId ? assets.get(image.storageId) : undefined;
          const url = getReadyAssetUrl(pair) ?? image.previewUrl ?? null;
          const loading = pair?.thumbnail.status === 'loading'
            || pair?.original.status === 'loading';
          return (
            <li key={image.id}>
              {url ? (
                <img alt="" src={url} />
              ) : (
                <span aria-hidden="true" className="onboarding-file-thumbnail-placeholder">
                  <FileImage size={20} />
                </span>
              )}
              <span>
                <strong>{image.fileName}</strong>
                <small>{loading ? 'Loading preview' : url ? 'Saved Canva page' : 'Preview unavailable'}</small>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const getOwnerUploadFailures = (
  result: CanvaIntegrationResult,
) => result.failures.map((failure) => ({
    ...(failure.code ? { code: failure.code } : {}),
    fileName: failure.fileName ?? 'Upload',
    message: failure.code === 'too_many_images'
      ? 'Skipped because the section is full.'
      : failure.message,
  }));

type CanvaFeedbackFailure = CustomDesignUploadFailure & {
  retryId: string;
};

type CanvaFeedbackStatus = Omit<CustomDesignUploadStatus, 'failures'> & {
  failures?: readonly CanvaFeedbackFailure[];
};

const getUploadStatus = (
  result: CanvaIntegrationResult,
): CustomDesignUploadStatus => {
  const failures = getOwnerUploadFailures(result);
  return {
    failures,
    message: formatCustomDesignUploadSummary(
      result.addedCount,
      failures.map((failure) => ({ code: failure.code ?? 'processing_failed' })),
    ),
    pending: false,
  };
};

const syncCanvaDraft = (
  onUpdate: OnboardingStateUpdater | undefined,
  section: CustomDesignSectionInstance | null,
  displayMode: CanvaDisplayMode,
  placement: CanvaPlacement,
): void => {
  if (!onUpdate) return;
  onUpdate((current) => ({
    ...current,
    canva: {
      ...current.canva,
      customDesignSectionId: section?.id ?? null,
      displayMode,
      errorMessage: '',
      images: section?.settings.images.map((image) => ({
        fileName: image.fileName,
        height: image.height,
        id: image.id,
        mimeType: image.mimeType,
        source: 'indexed_db' as const,
        storageId: image.assetId,
        width: image.width,
      })) ?? [],
      ownedAssetIds: [...new Set([
        ...current.canva.ownedAssetIds,
        ...(section?.settings.images.map((image) => image.assetId) ?? []),
      ])],
      placement,
      status: section && section.settings.images.length > 0 ? 'ready' : 'empty',
    },
    recipe: {
      ...current.recipe,
      canvaEnabled: Boolean(section && section.settings.images.length > 0),
    },
  }));
};

const persistUploadStatus = (
  onUpdate: OnboardingStateUpdater | undefined,
  addedCount: number,
  status: CanvaFeedbackStatus,
): void => {
  if (!onUpdate || !status.message) return;
  const failures = status.failures?.map(({ code, fileName, message }) => ({
    ...(code ? { code } : {}),
    fileName,
    message,
  })) ?? [];
  onUpdate((current) => ({
    ...current,
    canva: {
      ...current.canva,
      errorMessage: failures.length > 0 ? status.message ?? '' : '',
      status: addedCount > 0 ? 'ready' : current.canva.status,
      uploadResult: failures.length > 0
        ? {
            addedCount,
            failures,
            summary: status.message ?? '',
          }
        : null,
    },
  }));
};

type CanvaManagerProps = {
  controller: CanvaIntegrationController;
  imageOrderDraft: readonly string[];
  onImageOrderDraftChange: (ids: readonly string[]) => void;
  onOrderCommitted: (section: CustomDesignSectionInstance) => void;
  onRequestRemoveAll: () => void;
  onUpload: (files: readonly File[]) => void;
  onUpdate?: OnboardingStateUpdater;
  persistedPlacement: CanvaPlacement;
  section: CustomDesignSectionInstance;
  setPending: (pending: boolean) => void;
  setUploadStatus: (status: CustomDesignUploadStatus | undefined) => void;
  uploadPending: boolean;
};

function CanvaManager({
  controller,
  imageOrderDraft,
  onImageOrderDraftChange,
  onOrderCommitted,
  onRequestRemoveAll,
  onUpload,
  onUpdate,
  persistedPlacement,
  section,
  setPending,
  setUploadStatus,
  uploadPending,
}: CanvaManagerProps) {
  const assetIds = useMemo(
    () => section.settings.images.map(image => image.assetId),
    [section.settings.images],
  );
  const assetPairs = useCustomDesignAssetMap(assetIds);
  const assets = useMemo(
    () => toCustomDesignOwnerAssetMap(assetPairs),
    [assetPairs],
  );

  const applyManagerResult = (result: CanvaManagerResult) => {
    if (result.success) {
      setUploadStatus(result.cleanupWarnings?.length ? {
        failures: result.cleanupWarnings.map((warning) => ({
          ...(warning.code ? { code: warning.code } : {}),
          fileName: warning.fileName ?? 'Canva page',
          message: warning.message,
        })),
        message: 'Your change is saved. This browser still needs to clean up an earlier image copy.',
        pending: false,
      } : undefined);
      if (!result.section) return;
      syncCanvaDraft(
        onUpdate,
        result.section,
        result.section.settings.displayMode,
        persistedPlacement,
      );
      onOrderCommitted(result.section);
      return;
    }
    setUploadStatus({
      failures: result.failure ? [{
        fileName: result.failure.fileName ?? 'Canva page',
        message: result.failure.message,
      }] : [],
      message: result.failure?.message ?? 'The Canva design could not be changed.',
      pending: false,
    });
  };

  return (
    <CustomDesignImageManager
      assets={assets}
      imageOrderDraft={imageOrderDraft}
      images={section.settings.images}
      uploadStatus={uploadPending
        ? { pending: true, message: 'Checking and saving images…' }
        : undefined}
      onAddImages={onUpload}
      onCommitImageOrder={(ids) => {
        applyManagerResult(controller.reorderImages(section.id, ids));
      }}
      onImageOrderDraftChange={onImageOrderDraftChange}
      onRemoveImage={(imageId) => {
        if (section.settings.images.length === 1) {
          onRequestRemoveAll();
          return;
        }
        setPending(true);
        void controller.removeImage(section.id, imageId).then((result) => {
          applyManagerResult(result);
          setPending(false);
        });
      }}
      onReplaceImage={(imageId, file) => {
        setPending(true);
        setUploadStatus({ pending: true, message: `Replacing ${file.name}…` });
        void controller.replaceImage(section.id, imageId, file).then((result) => {
          applyManagerResult(result);
          setPending(false);
        });
      }}
    />
  );
}

function CanvaUploadResultPanel({
  onDismiss,
  onRetry,
  retryFiles,
  status,
}: {
  onDismiss: () => void;
  onRetry: (retryId: string, file: File) => void;
  retryFiles: ReadonlyMap<string, File>;
  status: CanvaFeedbackStatus;
}) {
  if (status.pending || !status.message) return null;
  return (
    <section aria-label="Canva upload result" className="custom-design-owner-upload-feedback" role="status">
      <p>{status.message}</p>
      {status.failures?.length ? (
        <ul className="custom-design-owner-errors">
          {status.failures.map((failure, index) => {
            const retryFile = retryFiles.get(failure.retryId);
            return (
              <li key={failure.retryId}>
                <strong>{failure.fileName}:</strong> {failure.message}
                {retryFile ? (
                  <button type="button" onClick={() => onRetry(failure.retryId, retryFile)}>Try again</button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <button type="button" onClick={onDismiss}>Dismiss upload result</button>
    </section>
  );
}

function SelectedCanvaPage({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const [dimensions, setDimensions] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [url, setUrl] = useState('');

  useEffect(() => {
    setDimensions(null);
    setPreviewFailed(false);
    if (typeof URL.createObjectURL !== 'function') {
      setUrl('');
      setPreviewFailed(true);
      return undefined;
    }

    let nextUrl = '';
    try {
      nextUrl = URL.createObjectURL(file);
      setUrl(nextUrl);
    } catch {
      setUrl('');
      setPreviewFailed(true);
      return undefined;
    }
    return () => {
      if (typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(nextUrl);
      }
    };
  }, [file]);

  const status = dimensions
    ? `${dimensions} · Ready to add`
    : previewFailed
      ? 'Preview unavailable · Checked when added'
      : 'Preparing preview';

  return (
    <li>
      {url && !previewFailed ? (
        <img
          alt=""
          src={url}
          onError={() => setPreviewFailed(true)}
          onLoad={(event) => {
            const image = event.currentTarget;
            setDimensions(`${image.naturalWidth} × ${image.naturalHeight}px`);
          }}
        />
      ) : (
        <span aria-hidden="true" className="onboarding-file-thumbnail-placeholder">
          <FileImage size={20} />
        </span>
      )}
      <span><strong>{file.name}</strong><small>{status}</small></span>
      <button aria-label={`Remove ${file.name}`} type="button" onClick={onRemove}>
        Remove
      </button>
    </li>
  );
}

export function CanvaDialog({
  available,
  controller,
  document,
  onAdd,
  onClose,
  onUpdate,
  open,
  state,
}: CanvaDialogProps) {
  const inputId = useId();
  const [files, setFiles] = useState<File[]>([]);
  const [displayMode, setDisplayMode] = useState<CanvaDisplayMode>(state.canva.displayMode);
  const [placement, setPlacement] = useState<CanvaPlacement>(state.canva.placement);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [removeAllPending, setRemoveAllPending] = useState(false);
  const [orderDismissPending, setOrderDismissPending] = useState(false);
  const [imageOrderBaseline, setImageOrderBaseline] = useState<readonly string[]>([]);
  const [imageOrderDraft, setImageOrderDraft] = useState<readonly string[]>([]);
  const imageOrderBaselineRef = useRef<readonly string[]>([]);
  const imageOrderDraftRef = useRef<readonly string[]>([]);
  const wasOpenRef = useRef(false);
  const feedbackSequenceRef = useRef(0);
  const uploadAddedCountRef = useRef(state.canva.uploadResult?.addedCount ?? 0);
  const [retryFiles, setRetryFiles] = useState<ReadonlyMap<string, File>>(
    () => new Map(),
  );
  const retryFilesRef = useRef<ReadonlyMap<string, File>>(new Map());
  const [uploadStatus, setUploadStatusState] = useState<CanvaFeedbackStatus | undefined>(() => (
    state.canva.uploadResult
      ? {
          failures: state.canva.uploadResult.failures.map((failure, index) => ({
            ...failure,
            retryId: `persisted-${index}`,
          })),
          message: state.canva.uploadResult.summary,
          pending: false,
        }
      : undefined
  ));
  const uploadStatusRef = useRef<CanvaFeedbackStatus | undefined>(uploadStatus);
  const setUploadStatus = (status: CanvaFeedbackStatus | undefined) => {
    uploadStatusRef.current = status;
    setUploadStatusState(status);
  };
  const updateRetryFiles = (filesByRetryId: ReadonlyMap<string, File>) => {
    retryFilesRef.current = filesByRetryId;
    setRetryFiles(filesByRetryId);
  };
  const located = document && state.canva.customDesignSectionId
    ? locateOnboardingCustomDesign(document, state.canva.customDesignSectionId)
    : null;
  const section = located?.pageId ? located.section : null;

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setDisplayMode(section?.settings.displayMode ?? state.canva.displayMode);
    setPlacement(state.canva.placement);
    setError('');
    setRemoveAllPending(false);
    setOrderDismissPending(false);
    const canonicalOrder = section?.settings.images.map((image) => image.id) ?? [];
    imageOrderBaselineRef.current = canonicalOrder;
    imageOrderDraftRef.current = canonicalOrder;
    setImageOrderBaseline(canonicalOrder);
    setImageOrderDraft(canonicalOrder);
    uploadAddedCountRef.current = state.canva.uploadResult?.addedCount ?? 0;
    updateRetryFiles(new Map());
    setUploadStatus(state.canva.uploadResult
      ? {
          failures: state.canva.uploadResult.failures.map((failure, index) => ({
            ...failure,
            retryId: `persisted-${index}`,
          })),
          message: state.canva.uploadResult.summary,
          pending: false,
        }
      : undefined);
  }, [open, section?.id, state.canva.displayMode, state.canva.placement, state.canva.uploadResult]);

  const canonicalImageOrder = useMemo(
    () => section?.settings.images.map((image) => image.id) ?? [],
    [section?.settings.images],
  );
  useEffect(() => {
    if (!open || !wasOpenRef.current) return;
    const baseline = imageOrderBaselineRef.current;
    if (
      baseline.length === canonicalImageOrder.length
      && baseline.every((id, index) => id === canonicalImageOrder[index])
    ) return;
    const draft = imageOrderDraftRef.current;
    const wasDirty = draft.length !== baseline.length
      || draft.some((id, index) => id !== baseline[index]);
    const canonicalIds = new Set(canonicalImageOrder);
    const survivingDraft = draft.filter((id) => canonicalIds.has(id));
    const survivingIds = new Set(survivingDraft);
    const addedIds = canonicalImageOrder.filter((id) => !survivingIds.has(id));
    const nextDraft = wasDirty
      ? [...survivingDraft, ...addedIds]
      : canonicalImageOrder;
    imageOrderBaselineRef.current = canonicalImageOrder;
    imageOrderDraftRef.current = nextDraft;
    setImageOrderBaseline(canonicalImageOrder);
    setImageOrderDraft(nextDraft);
  }, [canonicalImageOrder, open]);

  const imageOrderDirty = imageOrderDraft.length !== imageOrderBaseline.length
    || imageOrderDraft.some((id, index) => id !== imageOrderBaseline[index]);
  const updateImageOrderDraft = (ids: readonly string[]) => {
    const next = [...ids];
    imageOrderDraftRef.current = next;
    setImageOrderDraft(next);
  };
  const acceptCommittedOrder = (nextSection: CustomDesignSectionInstance) => {
    const committedOrder = nextSection.settings.images.map((image) => image.id);
    imageOrderBaselineRef.current = committedOrder;
    imageOrderDraftRef.current = committedOrder;
    setImageOrderBaseline(committedOrder);
    setImageOrderDraft(committedOrder);
  };
  const requestClose = () => {
    if (imageOrderDirty) {
      setOrderDismissPending(true);
      return;
    }
    onClose();
  };
  const discardOrderAndClose = () => {
    imageOrderDraftRef.current = imageOrderBaseline;
    setImageOrderDraft(imageOrderBaseline);
    setOrderDismissPending(false);
    onClose();
  };
  const saveOrder = (): boolean => {
    if (!section || !controller || !imageOrderDirty) return true;
    const result = controller.reorderImages(section.id, imageOrderDraft);
    if (!result.success || !result.section) {
      setError(result.failure?.message ?? 'The Canva page order could not be saved.');
      return false;
    }
    syncCanvaDraft(
      onUpdate,
      result.section,
      result.section.settings.displayMode,
      state.canva.placement,
    );
    acceptCommittedOrder(result.section);
    return true;
  };
  const saveOrderAndClose = () => {
    if (!saveOrder()) return;
    setOrderDismissPending(false);
    onClose();
  };

  const runUpload = async (
    selectedFiles: readonly File[],
    closeWhenCommitted = false,
    retriedFailureId?: string,
  ) => {
    const previousStatus = uploadStatusRef.current;
    const previousFailures = previousStatus?.pending
      ? []
      : [...previousStatus?.failures ?? []];
    const retainedFailures = retriedFailureId
      ? previousFailures.filter((failure) => failure.retryId !== retriedFailureId)
      : previousFailures;
    const retainedRetryFiles = new Map(retryFilesRef.current);
    if (retriedFailureId) retainedRetryFiles.delete(retriedFailureId);
    setPending(true);
    setUploadStatus({ pending: true, message: 'Checking and saving images…' });
    setError('');
    try {
      const result = await onAdd(selectedFiles, displayMode, placement);
      const nextStatus = getUploadStatus(result);
      const claimedFileIndexes = new Set<number>();
      const newFailures: CanvaFeedbackFailure[] = (nextStatus.failures ?? []).map(
        (failure, failureIndex) => {
          const sourceFailure = result.failures[failureIndex];
          const indexedFile = sourceFailure?.index === undefined
            ? undefined
            : selectedFiles[sourceFailure.index];
          const fallbackIndex = selectedFiles.findIndex((file, index) => (
            !claimedFileIndexes.has(index) && file.name === failure.fileName
          ));
          const fileIndex = indexedFile
            ? sourceFailure?.index ?? -1
            : fallbackIndex >= 0
              ? fallbackIndex
              : selectedFiles.length === 1
                ? 0
                : -1;
          if (fileIndex >= 0) claimedFileIndexes.add(fileIndex);
          const retryId = `upload-${feedbackSequenceRef.current += 1}`;
          const retryFile = fileIndex >= 0 ? selectedFiles[fileIndex] : undefined;
          if (retryFile) retainedRetryFiles.set(retryId, retryFile);
          return { ...failure, retryId };
        },
      );
      const mergedFailures = [...retainedFailures, ...newFailures];
      uploadAddedCountRef.current += result.addedCount;
      const status: CanvaFeedbackStatus = {
        failures: mergedFailures,
        message: formatCustomDesignUploadSummary(
          uploadAddedCountRef.current,
          mergedFailures.map((failure) => ({
            code: failure.code ?? 'processing_failed',
          })),
        ),
        pending: false,
      };
      updateRetryFiles(retainedRetryFiles);
      setUploadStatus(status);
      persistUploadStatus(onUpdate, uploadAddedCountRef.current, status);
      if (result.status === 'committed' || result.status === 'partial') {
        setFiles([]);
      }
      if (result.status === 'committed' && closeWhenCommitted) onClose();
      if (result.status !== 'committed' && result.status !== 'partial') {
        setError(status.message ?? 'The Canva design could not be added.');
      }
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Canva design could not be added.');
      return null;
    } finally {
      setPending(false);
    }
  };

  const submit = async () => {
    if (section && controller) {
      setPending(true);
      if (!saveOrder()) {
        setPending(false);
        return;
      }
      const result = controller.saveSettings({
        displayMode,
        placement,
        sectionId: section.id,
      });
      setPending(false);
      if (!result.success) {
        setError(result.failure?.message ?? 'The Canva settings could not be saved.');
        return;
      }
      syncCanvaDraft(onUpdate, result.section, displayMode, placement);
      onClose();
      return;
    }
    if (files.length === 0) {
      setError('Choose at least one PNG, JPG, or WebP Canva page.');
      return;
    }
    await runUpload(files, true);
  };

  return (
    <>
      <Dialog description="Your uploaded design is added as a section you can move or edit later." onClose={requestClose} open={open} title="Upload a Canva design" variant="bottom-sheet">
        <div aria-busy={pending} className="onboarding-subflow">
        <FileImage aria-hidden="true" size={28} />
        {state.recipe.wantsCanvaFromWelcome ? (
          <div className="onboarding-prototype-state">
            <strong>Recommended for you</strong>
            <span>You told us you already have a Canva design.</span>
          </div>
        ) : null}
        <p>Export your Canva design as PNG, JPG or WebP. You can upload up to 10 pages.</p>
        {section && controller ? (
          <CanvaManager
            controller={controller}
            imageOrderDraft={imageOrderDraft}
            onImageOrderDraftChange={updateImageOrderDraft}
            onOrderCommitted={acceptCommittedOrder}
            onRequestRemoveAll={() => setRemoveAllPending(true)}
            onUpload={(selectedFiles) => { void runUpload(selectedFiles); }}
            onUpdate={onUpdate}
            persistedPlacement={state.canva.placement}
            section={section}
            setPending={setPending}
            setUploadStatus={(status) => setUploadStatus(status ? {
              ...status,
              failures: status.failures?.map((failure, index) => ({
                ...failure,
                retryId: `manager-${feedbackSequenceRef.current += 1}-${index}`,
              })),
            } : undefined)}
            uploadPending={Boolean(uploadStatus?.pending)}
          />
        ) : (
          <>
            <label className="onboarding-upload-choice" htmlFor={inputId}><strong>Choose Canva pages</strong><small>Up to 10 pages</small></label>
            <input
              accept="image/png,image/jpeg,image/webp"
              className="visually-hidden"
              id={inputId}
              multiple
              type="file"
              onChange={(event) => { setFiles([...event.target.files ?? []]); setError(''); }}
            />
            {!document && open && state.canva.images.length > 0 ? (
              <SavedCanvaPages images={state.canva.images} />
            ) : null}
          </>
        )}
        {files.length > 0 ? (
          <ul aria-label="Selected Canva pages" className="onboarding-file-list onboarding-file-list--visual">
            {files.map((file, index) => (
              <SelectedCanvaPage
                file={file}
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                onRemove={() => setFiles((current) => current.filter((candidate) => candidate !== file))}
              />
            ))}
          </ul>
        ) : null}
        <fieldset className="onboarding-layout-choice"><legend>Display</legend>
          {(['poster', 'contained', 'full_width'] as CanvaDisplayMode[]).map((mode) => <label key={mode}><input checked={displayMode === mode} name="canva-display" type="radio" value={mode} onChange={() => setDisplayMode(mode)} /><span>{mode === 'full_width' ? 'Full width' : `${mode[0]?.toUpperCase()}${mode.slice(1)}`}</span></label>)}
        </fieldset>
        <fieldset className="onboarding-layout-choice"><legend>Placement</legend>
          <label><input checked={placement === 'before_booking'} name="canva-placement" type="radio" value="before_booking" onChange={() => setPlacement('before_booking')} /><span>Before Booking</span></label>
          <label><input checked={placement === 'after_booking'} name="canva-placement" type="radio" value="after_booking" onChange={() => setPlacement('after_booking')} /><span>After Booking</span></label>
        </fieldset>
        {!available ? <p className="onboarding-inline-error" role="alert">{CANVA_UPLOADS_UNAVAILABLE_MESSAGE}</p> : null}
        {removeAllPending && section && controller ? (
          <div className="onboarding-inline-warning" role="alert">
            <strong>Remove this Canva design?</strong>
            <p>The uploaded section will no longer appear on your site.</p>
            <div className="onboarding-overlay-actions">
              <button type="button" onClick={() => setRemoveAllPending(false)}>Keep design</button>
              <button
                type="button"
                onClick={() => {
                  setPending(true);
                  void controller.removeDesign(section.id).then((result) => {
                    setPending(false);
                    if (!result.success) {
                      setError(result.failure?.message ?? 'The Canva design could not be removed.');
                      return;
                    }
                    syncCanvaDraft(
                      onUpdate,
                      null,
                      state.canva.displayMode,
                      state.canva.placement,
                    );
                    setRemoveAllPending(false);
                    if (result.cleanupWarnings?.length) {
                      setUploadStatus({
                        failures: result.cleanupWarnings.map((warning, index) => ({
                          ...(warning.code ? { code: warning.code } : {}),
                          fileName: warning.fileName ?? 'Canva page',
                          message: warning.message,
                          retryId: `cleanup-${feedbackSequenceRef.current += 1}-${index}`,
                        })),
                        message: 'The design is removed. This browser still needs to clean up an earlier image copy.',
                        pending: false,
                      });
                      return;
                    }
                    onClose();
                  });
                }}
              >
                Remove design
              </button>
            </div>
          </div>
        ) : null}
        {error ? <p className="onboarding-inline-error" role="alert">{error}</p> : null}
        {uploadStatus ? (
          <CanvaUploadResultPanel
            retryFiles={retryFiles}
            status={uploadStatus}
            onDismiss={() => {
              setUploadStatus(undefined);
              uploadAddedCountRef.current = 0;
              updateRetryFiles(new Map());
              onUpdate?.((current) => ({
                ...current,
                canva: { ...current.canva, errorMessage: '', uploadResult: null },
              }));
            }}
            onRetry={(retryId, file) => { void runUpload([file], false, retryId); }}
          />
        ) : null}
        <p aria-live="polite" className="visually-hidden" role="status">{pending ? 'Saving Canva pages.' : ''}</p>
        <footer className="onboarding-overlay-actions">
          <button type="button" onClick={requestClose}>Cancel</button>
          <button className="is-primary" disabled={!available || pending} type="button" onClick={() => { void submit(); }}>
            {pending
              ? <><LoaderCircle aria-hidden="true" className="is-spinning" size={17} /> Saving Canva pages…</>
              : section ? 'Save Canva design' : 'Add Canva design'}
          </button>
        </footer>
        </div>
      </Dialog>
      <Dialog
        description="You changed the order of your uploaded design pages."
        initialFocusSelector="[data-canva-order-keep-editing]"
        onClose={() => setOrderDismissPending(false)}
        open={orderDismissPending}
        title="Save this page order?"
      >
        <p className="eyebrow">UNSAVED IMAGE ORDER</p>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            data-canva-order-keep-editing
            type="button"
            onClick={() => setOrderDismissPending(false)}
          >
            Keep editing
          </button>
          <button className="secondary-button" type="button" onClick={discardOrderAndClose}>
            Discard changes
          </button>
          <button className="primary-button" type="button" onClick={saveOrderAndClose}>
            Save order
          </button>
        </div>
      </Dialog>
    </>
  );
}
