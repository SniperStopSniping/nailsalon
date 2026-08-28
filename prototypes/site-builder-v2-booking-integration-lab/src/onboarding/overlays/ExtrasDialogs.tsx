import { FileImage, Images, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';

import {
  useCustomDesignAssetMap,
  type CustomDesignAssetUrlPair,
} from '../../custom-design/integration/CustomDesignAssetProvider';
import { Dialog } from '../../ui/Dialog';
import type { CanvaIntegrationResult } from '../extras/useCanvaIntegration';
import {
  decodeOnboardingLocalImage,
  validateOnboardingGalleryImages,
} from '../model/local-images';
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

const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error ?? new Error('The image could not be read.'));
  reader.onload = () => {
    if (typeof reader.result === 'string') {
      resolve(reader.result);
      return;
    }
    reject(new Error('The image could not be read.'));
  };
  reader.readAsDataURL(file);
});

const readLocalImage = async (file: File): Promise<LocalImageReference> => {
  const dimensions = await decodeOnboardingLocalImage(file);
  const previewUrl = await readFileAsDataUrl(file);
  return {
    altText: 'Uploaded portfolio work',
    fileName: file.name,
    ...dimensions,
    id: `gallery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mimeType: file.type,
    previewUrl,
    source: 'data_url',
  };
};

type GalleryDialogProps = {
  onClose: () => void;
  onUpdate: OnboardingStateUpdater;
  open: boolean;
  state: OnboardingLabState;
};

export function GalleryDialog({ onClose, onUpdate, open, state }: GalleryDialogProps) {
  const inputId = useId();
  const [error, setError] = useState('');
  const addUploads = async (files: readonly File[]) => {
    try {
      validateOnboardingGalleryImages(files);
      const results = await Promise.allSettled(files.map(readLocalImage));
      const images = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      const rejected = results.length - images.length;
      if (images.length > 0) {
        onUpdate((current) => ({
          ...current,
          gallery: { ...current.gallery, images, source: 'uploads' },
        }));
      }
      if (rejected === 0) {
        setError('');
      } else if (images.length === 0) {
        setError(`No images were added. ${rejected} ${rejected === 1 ? 'image was' : 'images were'} skipped. This image couldn’t be opened. Try exporting or selecting it again.`);
      } else {
        setError(`${images.length} ${images.length === 1 ? 'image was' : 'images were'} added and ${rejected} ${rejected === 1 ? 'was' : 'were'} skipped. This image couldn’t be opened. Try exporting or selecting it again.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The selected images could not be read.');
    }
  };
  const canAdd = state.gallery.source !== null && (state.gallery.source === 'mock_luster' || state.gallery.images.length > 0);
  const save = () => {
    if (!canAdd) {
      setError('Choose portfolio images or the Luster sample portfolio first.');
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
            onClick={() => onUpdate((current) => ({ ...current, gallery: { ...current.gallery, images: MOCK_GALLERY_IMAGES, source: 'mock_luster' } }))}
          >
            <strong>Use Luster sample portfolio</strong><small>Four sample nail photos</small>
          </button>
          <label htmlFor={inputId} className="onboarding-upload-choice">
            <strong>Upload portfolio photos</strong><small>PNG, JPG, or WebP</small>
          </label>
          <input
            accept="image/png,image/jpeg,image/webp"
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
            {state.gallery.images.map((image) => image.previewUrl ? <img alt={image.altText ?? ''} key={image.id} src={image.previewUrl} /> : null)}
          </div>
        ) : null}
        <fieldset className="onboarding-layout-choice"><legend>Gallery layout</legend>
          {(['grid', 'carousel', 'editorial'] as GalleryLayout[]).map((layout) => <label key={layout}><input checked={state.gallery.layout === layout} name="gallery-layout" type="radio" onChange={() => onUpdate((current) => ({ ...current, gallery: { ...current.gallery, layout } }))} /><span>{layout}</span></label>)}
        </fieldset>
        {error ? <p className="onboarding-inline-error" role="alert">{error}</p> : null}
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
  onAdd: (files: readonly File[], displayMode: CanvaDisplayMode, placement: CanvaPlacement) => Promise<CanvaIntegrationResult>;
  onClose: () => void;
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

export function CanvaDialog({ available, onAdd, onClose, open, state }: CanvaDialogProps) {
  const inputId = useId();
  const [files, setFiles] = useState<File[]>([]);
  const [displayMode, setDisplayMode] = useState<CanvaDisplayMode>(state.canva.displayMode);
  const [placement, setPlacement] = useState<CanvaPlacement>(state.canva.placement);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (files.length === 0) {
      setError('Choose at least one PNG, JPG, or WebP Canva page.');
      return;
    }
    setPending(true);
    try {
      const result = await onAdd(files, displayMode, placement);
      if (result.status === 'committed' || result.status === 'partial') {
        setFiles([]);
        setError(result.failures.length > 0 ? result.failures.map((failure) => failure.message).join(' ') : '');
        onClose();
        return;
      }
      setError(result.failures.map((failure) => failure.message).join(' ') || 'The Canva design could not be added.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Canva design could not be added.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog description="Your uploaded design is added as a section you can move or edit later." onClose={onClose} open={open} title="Upload a Canva design" variant="bottom-sheet">
      <div aria-busy={pending} className="onboarding-subflow">
        <FileImage aria-hidden="true" size={28} />
        {state.recipe.wantsCanvaFromWelcome ? <p className="onboarding-prototype-state">Recommended from your welcome choice</p> : null}
        <p>PNG, JPG, and WebP are supported. Export Canva pages as images before uploading.</p>
        <label className="onboarding-upload-choice" htmlFor={inputId}><strong>Choose Canva pages</strong><small>Up to 10 images · stored in this browser</small></label>
        <input
          accept="image/png,image/jpeg,image/webp"
          id={inputId}
          multiple
          type="file"
          onChange={(event) => { setFiles([...event.target.files ?? []]); setError(''); }}
        />
        {open && state.canva.images.length > 0 ? (
          <SavedCanvaPages images={state.canva.images} />
        ) : null}
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
          {(['poster', 'contained', 'full_width'] as CanvaDisplayMode[]).map((mode) => <label key={mode}><input checked={displayMode === mode} name="canva-display" type="radio" onChange={() => setDisplayMode(mode)} /><span>{mode === 'full_width' ? 'Full width' : `${mode[0]?.toUpperCase()}${mode.slice(1)}`}</span></label>)}
        </fieldset>
        <fieldset className="onboarding-layout-choice"><legend>Placement</legend>
          <label><input checked={placement === 'before_booking'} name="canva-placement" type="radio" onChange={() => setPlacement('before_booking')} /><span>Before Booking</span></label>
          <label><input checked={placement === 'after_booking'} name="canva-placement" type="radio" onChange={() => setPlacement('after_booking')} /><span>After Booking</span></label>
        </fieldset>
        {!available ? <p className="onboarding-inline-error" role="alert">Uploaded-design storage is unavailable in this browser.</p> : null}
        {error ? <p className="onboarding-inline-error" role="alert">{error}</p> : null}
        <p aria-live="polite" className="visually-hidden" role="status">{pending ? 'Saving Canva pages.' : ''}</p>
        <footer className="onboarding-overlay-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="is-primary" disabled={!available || pending} type="button" onClick={() => { void submit(); }}>
            {pending ? <><LoaderCircle aria-hidden="true" className="is-spinning" size={17} /> Saving Canva pages…</> : 'Add Canva design'}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
