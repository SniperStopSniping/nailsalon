'use client';

import { useEffect, useRef, useState } from 'react';

import { CANVA_INPUT_BYTES, prepareCanvaPages } from '@/features/custom-sites/canva-upload';
import { CanvaUploadQuality } from '@/features/custom-sites/CanvaImageQuality';
import type { DesignBrief } from '@/features/custom-sites/contracts';
import { CLIENT_IMAGE_INPUT_BYTES, prepareWebsiteImage } from '@/features/custom-sites/image-upload';
import type { DesignAsset } from '@/features/custom-sites/WebsitePhotoLibrary';

type Purpose = 'own' | 'inspiration' | 'photo' | 'logo';
const PURPOSES: { value: Purpose; label: string; description: string }[] = [
  { value: 'own', label: 'My design or menu', description: 'Recreate my design. Read details from it.' },
  { value: 'inspiration', label: 'Inspiration', description: 'Use the style with my business details.' },
  { value: 'photo', label: 'My photos', description: 'Photographs to use on my website.' },
  { value: 'logo', label: 'My logo', description: 'Use my own branding.' },
];

/** Uses the same saved brief and asset API as the manual website controls. */
export function ChatAttachments({ salonSlug, revision, brief, assets, selected, open, onClose, disabled, onBusyChange, onSaved, initialPurpose = 'inspiration' }: {
  salonSlug: string;
  revision: number;
  brief?: DesignBrief;
  assets: DesignAsset[];
  selected: string[];
  open: boolean;
  onClose: () => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onSaved: () => Promise<void>;
  initialPurpose?: Purpose;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [purpose, setPurpose] = useState<Purpose>(initialPurpose);
  const [keepDesign, setKeepDesign] = useState(brief?.mode === 'keep_design');
  const [permission, setPermission] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const uploaded = useRef(new Map<File, DesignAsset>());
  const prepared = useRef(new Map<File, File[]>());
  const endpoint = `/api/admin/custom-sites?salonSlug=${encodeURIComponent(salonSlug)}`;
  const values: DesignBrief = brief ?? { fidelity: 'inspiration', referenceIds: selected.filter(id => assets.some(asset => asset.id === id && asset.role === 'reference')), ownedReferenceIds: [], websiteAssetIds: selected.filter(id => assets.some(asset => asset.id === id && asset.role !== 'reference')) };
  const attached = assets.filter(asset => [...values.referenceIds, ...values.websiteAssetIds].includes(asset.id));
  useEffect(() => {
    if (open && !dialog.current?.open) {
      dialog.current?.showModal();
    } else if (!open && dialog.current?.open) {
      dialog.current.close();
    }
  }, [open]);
  async function save(values: DesignBrief) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preferences', input: { expectedRevision: revision, operationId: crypto.randomUUID(), values } }) });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error ?? 'Your image choices could not be saved.');
    }
  }
  async function change(work: () => Promise<void>) {
    setSaving(true);
    onBusyChange(true);
    setError('');
    setProgress('');
    try {
      await work();
      await onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Your files could not be saved. Please try again.');
      await onSaved().catch(() => {});
    } finally {
      setSaving(false);
      setProgress('');
      onBusyChange(false);
    }
  }
  async function upload() {
    if (!files.length || !permission || disabled || saving) {
      return;
    }
    await change(async () => {
      const isReference = purpose === 'own' || purpose === 'inspiration';
      const currentIds = isReference ? values.referenceIds : values.websiteAssetIds;
      const alreadySelected = (file: File) => currentIds.includes(uploaded.current.get(file)?.id ?? '');
      const pendingFiles = files.filter(file => !prepared.current.get(file)?.every(alreadySelected));
      if (pendingFiles.length + currentIds.length > 6) {
        throw new Error(`Choose up to six ${isReference ? 'references' : 'photos and logos'} in total. Remove an attached image to make room.`);
      }
      const canva = purpose === 'own' && keepDesign;
      if (files.some(file => file.size > (canva ? CANVA_INPUT_BYTES : isReference ? 3000000 : CLIENT_IMAGE_INPUT_BYTES) || !['image/png', 'image/jpeg', 'image/webp', ...(isReference ? ['application/pdf'] : [])].includes(file.type))) {
        if (canva) {
          throw new Error('Choose PNG, JPG, WebP or PDF Canva exports under 20 MB. Luster prepares larger files for upload.');
        }
        throw new Error(isReference ? 'Use PNG, JPG or WebP files under 3 MB each. A design or menu can also be a PDF.' : 'Use PNG, JPG or WebP photos and logos under 20 MB. Larger images are prepared automatically.');
      }
      const ready: File[] = [];
      for (const file of files) {
        let pages = prepared.current.get(file);
        if (!pages) {
          setProgress(canva ? 'Preparing your design…' : 'Preparing your images…');
          pages = canva ? await prepareCanvaPages(file, 6 - currentIds.length - ready.filter(page => !alreadySelected(page)).length, setProgress) : [isReference ? file : await prepareWebsiteImage(file)];
          prepared.current.set(file, pages);
        }
        ready.push(...pages);
      }
      if (ready.filter(file => !alreadySelected(file)).length + currentIds.length > 6) {
        throw new Error('Keep up to six pages or images in total. Remove an attached page or export fewer PDF pages.');
      }
      for (const [index, file] of ready.entries()) {
        if (uploaded.current.has(file)) {
          continue;
        }
        setProgress(`Uploading ${index + 1} of ${ready.length}…`);
        const data = new FormData();
        data.set('file', file);
        data.set('role', isReference ? 'reference' : purpose);
        data.set('rightsConfirmed', 'true');
        const response = await fetch(endpoint, { method: 'POST', body: data });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error ?? 'This file could not be uploaded. Earlier files are saved; retry to finish.');
        }
        uploaded.current.set(file, result.asset);
      }
      const ids = ready.map(file => uploaded.current.get(file)!.id);
      setProgress('Saving your files…');
      await save({
        ...values,
        fidelity: purpose === 'own' ? 'match' : values.fidelity,
        mode: purpose === 'own' ? keepDesign ? 'keep_design' : 'rebuild' : purpose === 'inspiration' ? 'rebuild' : values.mode,
        referenceIds: isReference ? [...new Set([...values.referenceIds, ...ids])] : values.referenceIds,
        ownedReferenceIds: purpose === 'own' ? [...new Set([...values.ownedReferenceIds, ...ids])] : values.ownedReferenceIds,
        websiteAssetIds: isReference ? values.websiteAssetIds : [...new Set([...values.websiteAssetIds, ...ids])],
      });
      setFiles([]);
      uploaded.current.clear();
      prepared.current.clear();
      setPermission(false);
      if (fileInput.current) {
        fileInput.current.value = '';
      }
      onClose();
    });
  }
  return (
    <>
      {attached.length > 0 && (
        <div className="setup-attachments" aria-label="Attached images">
          {attached.map(asset => (
            <div className="setup-attachment" key={asset.id}>
              {asset.mimeType.startsWith('image/') ? <img src={`${endpoint}&asset=${asset.id}`} alt="" /> /* eslint-disable-line @next/next/no-img-element */ : <span aria-hidden="true">▤</span>}
              <span>
                <strong>{asset.name}</strong>
                <small>{asset.role === 'reference' ? values.ownedReferenceIds.includes(asset.id) ? 'Your design' : 'Inspiration' : asset.role === 'logo' ? 'Logo' : 'Website photo'}</small>
              </span>
              <button type="button" aria-label={`Detach ${asset.name}`} disabled={disabled || saving} onClick={() => void change(() => save({ ...values, referenceIds: values.referenceIds.filter(id => id !== asset.id), ownedReferenceIds: values.ownedReferenceIds.filter(id => id !== asset.id), websiteAssetIds: values.websiteAssetIds.filter(id => id !== asset.id) }))}>×</button>
            </div>
          ))}
        </div>
      )}
      {error && !open && <p role="alert" className="setup-attachment-note">{error}</p>}
      <dialog
        ref={dialog}
        className="setup-attach-dialog"
        aria-labelledby="setup-attach-title"
        onCancel={(event) => {
          if (saving) {
            event.preventDefault();
          } else {
            onClose();
          }
        }}
        onClose={() => {
          onClose();
          document.getElementById('setup-attach-button')?.focus({ preventScroll: true });
        }}
      >
        <div className="setup-dialog-heading">
          <h2 id="setup-attach-title">Add to your conversation</h2>
          <button type="button" aria-label="Close attachments" disabled={saving} onClick={onClose}>×</button>
        </div>
        <p>A design, a menu, or photos of your work.</p>
        <div className="setup-attachment-purposes" role="group" aria-label="How should Luster use this file?">
          {PURPOSES.map(item => (
            <button
              type="button"
              key={item.value}
              disabled={saving || uploaded.current.size > 0}
              aria-pressed={purpose === item.value}
              onClick={() => {
                setPurpose(item.value);
                setPermission(false);
                prepared.current.clear();
              }}
            >
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
        {purpose === 'own' && (
          <label className="setup-attachment-permission">
            <input
              type="checkbox"
              checked={keepDesign}
              disabled={saving || uploaded.current.size > 0}
              onChange={(event) => {
                setKeepDesign(event.target.checked);
                prepared.current.clear();
              }}
            />
            <span>
              <strong>Keep my Canva design</strong>
              <br />
              Keep your artwork. AI adds booking and contact links. Upload original PNG or JPG pages in order, or a Canva PDF.
            </span>
          </label>
        )}
        <input
          ref={fileInput}
          id="setup-attachment-file"
          className="setup-sr-only"
          type="file"
          accept={`image/png,image/jpeg,image/webp${purpose === 'inspiration' || purpose === 'own' ? ',application/pdf' : ''}`}
          multiple
          disabled={saving}
          onChange={(event) => {
            setFiles(Array.from(event.target.files ?? []));
            uploaded.current.clear();
            prepared.current.clear();
            setError('');
          }}
        />
        <button type="button" className="setup-pick-files" disabled={saving} onClick={() => fileInput.current?.click()}>{files.length ? `${files.length} file${files.length === 1 ? '' : 's'} selected · Change` : 'Choose files'}</button>
        {files.length > 0 && <ul className="setup-chosen-files">{files.map(file => <li key={`${file.name}-${file.lastModified}-${file.size}`}>{file.name}</li>)}</ul>}
        {purpose === 'own' && keepDesign && files.length > 0 && <CanvaUploadQuality files={files} />}
        <small>{purpose === 'own' && keepDesign ? 'Canva PNG, JPG, WebP or PDF · up to 20 MB each · six pages in total · prepared automatically' : purpose === 'photo' || purpose === 'logo' ? 'PNG, JPG or WebP · up to 20 MB each · prepared automatically without stretching or cropping' : 'PNG, JPG, WebP or design PDF · up to 3 MB each'}</small>
        <label className="setup-attachment-permission">
          <input type="checkbox" checked={permission} disabled={saving} onChange={event => setPermission(event.target.checked)} />
          {purpose === 'inspiration' ? 'I may upload these files. Use the style, not another business’s photos or branding.' : 'These are my files, or I have permission to use them on my website.'}
        </label>
        {error && <p role="alert">{error}</p>}
        {saving && progress && <p role="status" aria-live="polite">{progress}</p>}
        <button type="button" className="setup-add-files" disabled={disabled || saving || !files.length || !permission} onClick={() => void upload()}>{saving ? 'Adding your files…' : 'Add to chat'}</button>
      </dialog>
    </>
  );
}
