'use client';

import { useEffect, useRef, useState } from 'react';

import type { DesignBrief } from '@/features/custom-sites/contracts';
import type { DesignAsset } from '@/features/custom-sites/WebsitePhotoLibrary';

type Purpose = 'own' | 'inspiration' | 'photo' | 'logo';
const PURPOSES: { value: Purpose; label: string; description: string }[] = [
  { value: 'own', label: 'My design or menu', description: 'Recreate my design. Read details from it.' },
  { value: 'inspiration', label: 'Inspiration', description: 'Use the style with my business details.' },
  { value: 'photo', label: 'My photos', description: 'Photographs to use on my website.' },
  { value: 'logo', label: 'My logo', description: 'Use my own branding.' },
];

/** Uses the same saved brief and asset API as the manual website controls. */
export function ChatAttachments({ salonSlug, revision, brief, assets, selected, open, onClose, disabled, onBusyChange, onSaved }: {
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
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [purpose, setPurpose] = useState<Purpose>('inspiration');
  const [permission, setPermission] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const uploaded = useRef(new Map<File, DesignAsset>());
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
    try {
      await work();
      await onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Your files could not be saved. Please try again.');
      await onSaved().catch(() => {});
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  }
  async function upload() {
    if (!files.length || !permission || disabled || saving) {
      return;
    }
    await change(async () => {
      const isReference = purpose === 'own' || purpose === 'inspiration';
      if (files.length + (isReference ? values.referenceIds : values.websiteAssetIds).length > 6) {
        throw new Error(`Choose up to six ${isReference ? 'references' : 'photos and logos'} in total. Remove an attached image to make room.`);
      }
      if (files.some(file => file.size > 3000000 || !['image/png', 'image/jpeg', 'image/webp', ...(isReference ? ['application/pdf'] : [])].includes(file.type))) {
        throw new Error('Use PNG, JPG or WebP files under 3 MB each. A design or menu can also be a PDF.');
      }
      for (const file of files) {
        if (uploaded.current.has(file)) {
          continue;
        }
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
      const ids = files.map(file => uploaded.current.get(file)!.id);
      await save({
        ...values,
        fidelity: purpose === 'own' ? 'match' : values.fidelity,
        referenceIds: isReference ? [...new Set([...values.referenceIds, ...ids])] : values.referenceIds,
        ownedReferenceIds: purpose === 'own' ? [...new Set([...values.ownedReferenceIds, ...ids])] : values.ownedReferenceIds,
        websiteAssetIds: isReference ? values.websiteAssetIds : [...new Set([...values.websiteAssetIds, ...ids])],
      });
      setFiles([]);
      uploaded.current.clear();
      setPermission(false);
      if (fileInput.current) {
        fileInput.current.value = '';
      }
      setNotice(purpose === 'own' ? 'Attached. Tell me what to create — I can read the business details in your image.' : purpose === 'inspiration' ? 'Inspiration attached. Tell me what you like about it.' : 'Attached for your website. Tell me where you’d like to use it.');
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
      {notice && <p className="setup-attachment-note" role="status">{notice}</p>}
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
            <button type="button" key={item.value} disabled={saving || uploaded.current.size > 0} aria-pressed={purpose === item.value} onClick={() => setPurpose(item.value)}>
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
        <input
          ref={fileInput}
          id="setup-attachment-file"
          className="setup-sr-only"
          type="file"
          accept={`image/png,image/jpeg,image/webp${purpose === 'own' || purpose === 'inspiration' ? ',application/pdf' : ''}`}
          multiple
          disabled={saving}
          onChange={(event) => {
            setFiles(Array.from(event.target.files ?? []));
            uploaded.current.clear();
            setError('');
          }}
        />
        <button type="button" className="setup-pick-files" disabled={saving} onClick={() => fileInput.current?.click()}>{files.length ? `${files.length} file${files.length === 1 ? '' : 's'} selected · Change` : 'Choose files'}</button>
        {files.length > 0 && <ul className="setup-chosen-files">{files.map(file => <li key={`${file.name}-${file.lastModified}-${file.size}`}>{file.name}</li>)}</ul>}
        <small>PNG, JPG, WebP or design PDF · up to 3 MB each</small>
        <label className="setup-attachment-permission">
          <input type="checkbox" checked={permission} disabled={saving} onChange={event => setPermission(event.target.checked)} />
          {purpose === 'inspiration' ? 'I may upload these files. Use the style, not another business’s photos or branding.' : 'These are my files, or I have permission to use them on my website.'}
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="button" className="setup-add-files" disabled={disabled || saving || !files.length || !permission} onClick={() => void upload()}>{saving ? 'Adding your files…' : 'Add to chat'}</button>
      </dialog>
    </>
  );
}
