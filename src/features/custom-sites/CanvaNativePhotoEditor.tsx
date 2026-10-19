'use client';

import { useEffect, useRef, useState } from 'react';

import type { CanvaNativeContent, CanvaNativeImage } from './canva-native-content';
import type { CanvaNativeChange, NativePhotoChoice } from './canva-native-edits';
import type { CustomSitePayload } from './contracts';
import { nativeImageLoader } from './native-image-loader';

function PhotoPreview({ image, media }: { image: CanvaNativeImage; media: NonNullable<CustomSitePayload['nativeMedia']> }) {
  const [data, setData] = useState<string | null | undefined>();
  const [retry, setRetry] = useState(0);
  const { artifactId, shareToken } = media;
  useEffect(() => {
    setData(undefined);
    const loader = nativeImageLoader({ artifactId, mediaIds: [image.mediaId], ...(shareToken ? { shareToken } : {}) }, (_id, value) => setData(value));
    loader.request(image.mediaId);
    return () => loader.dispose();
  }, [image.mediaId, artifactId, shareToken, retry]);
  return data
    ? <img src={data} alt={image.alt} width={image.width} height={image.height} style={{ objectFit: 'contain', maxHeight: 260 }} /> // eslint-disable-line @next/next/no-img-element -- bounded authenticated image bytes, no arbitrary URL
    : (
        <p role="status">
          {data === undefined
            ? 'Loading photo…'
            : (
                <>
                  This photo could not load.
                  <button type="button" onClick={() => setRetry(value => value + 1)}>Retry photo</button>
                </>
              )}
        </p>
      );
}

function PhotoControls({ block, choices, media, disabled, onSave, onUpload, newGallery = false }: { block: Exclude<CanvaNativeContent[number], { type: 'reviews' }>; choices: NativePhotoChoice[]; media?: CustomSitePayload['nativeMedia']; disabled: boolean; onSave: (change: CanvaNativeChange) => Promise<void>; onUpload?: (file: File, alt: string, replaceId?: string) => Promise<void>; newGallery?: boolean }) {
  const images = block.type === 'about' ? block.image ? [block.image] : [] : block.images;
  const [selected, setSelected] = useState(images[0]?.mediaId ?? '');
  const image = images.find(image => image.mediaId === selected) ?? images[0];
  const index = images.findIndex(item => item.mediaId === image?.mediaId);
  const [choice, setChoice] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const replacement = useRef<string | undefined>(undefined);
  const [rights, setRights] = useState(false);
  const [description, setDescription] = useState('');
  const available = choices.filter(choice => choice.role === (block.type === 'about' ? 'profile' : 'gallery') && !images.some(image => image.mediaId === choice.mediaId));
  const picked = available.find(item => item.mediaId === choice) ?? available[0];
  return (
    <fieldset disabled={disabled}>
      <legend>{block.type === 'about' ? 'About photo' : 'Gallery photos'}</legend>
      {block.type === 'gallery' && !newGallery && (
        <label>
          Gallery layout
          <select value={block.layout} onChange={event => void onSave({ type: 'layout', layout: event.target.value as 'grid' | 'carousel' | 'editorial' })}>
            <option value="grid">Photo grid</option>
            <option value="carousel">Scrollable gallery</option>
            <option value="editorial">Large first photo</option>
          </select>
        </label>
      )}
      {images.length > 1 && (
        <label>
          Choose a photo
          <select value={image?.mediaId} onChange={event => setSelected(event.target.value)}>{images.map((item, index) => <option key={item.mediaId} value={item.mediaId}>{`${index + 1}. ${item.alt}`}</option>)}</select>
        </label>
      )}
      {image
        ? (
            <article className="studio-photo-card">
              {media && <PhotoPreview key={image.mediaId} image={image} media={media} />}
              <form
                key={`${image.mediaId}:${image.alt}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void onSave({ type: 'describe', mediaId: image.mediaId, alt: String(data.get('description') ?? '') });
                }}
              >
                <label>
                  Photo description
                  <input name="description" defaultValue={image.alt} maxLength={500} required />
                </label>
                <button type="submit">Save description</button>
              </form>
              <div className="studio-photo-actions">
                {block.type === 'gallery' && (
                  <>
                    <button type="button" disabled={disabled || index === 0} onClick={() => void onSave({ type: 'move', mediaId: image.mediaId, direction: 'earlier' })}>Move earlier</button>
                    <button type="button" disabled={disabled || index === images.length - 1} onClick={() => void onSave({ type: 'move', mediaId: image.mediaId, direction: 'later' })}>Move later</button>
                  </>
                )}
                <button type="button" onClick={() => void onSave({ type: 'remove', mediaId: image.mediaId })}>Remove from draft</button>
              </div>
            </article>
          )
        : <p>No photos in this section.</p>}
      {picked && (
        <div>
          <label>
            Choose a saved photo
            <select value={picked.mediaId} onChange={event => setChoice(event.target.value)}>{available.map(item => <option key={item.mediaId} value={item.mediaId}>{item.name}</option>)}</select>
          </label>
          <div className="studio-photo-actions">
            {(block.type === 'about' || images.length < 60) && <button type="button" onClick={() => void onSave({ type: 'use', mediaId: picked.mediaId, alt: picked.alt })}>{block.type === 'about' && image ? 'Replace About photo' : 'Add saved photo'}</button>}
            {block.type === 'gallery' && image && <button type="button" onClick={() => void onSave({ type: 'use', mediaId: picked.mediaId, replaceId: image.mediaId, alt: picked.alt })}>Replace selected photo</button>}
          </div>
        </div>
      )}
      {onUpload && (
        <div>
          <label>
            New photo description (optional)
            <input value={description} maxLength={500} onChange={event => setDescription(event.target.value)} placeholder="For example, a close-up of my nail art" />
          </label>
          <label className="studio-rights">
            <input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} />
            I own or have permission to use this photo.
          </label>
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            aria-label="Choose new About or Gallery photo"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file && rights && !disabled) {
                const alt = description.trim() || file.name.replace(/\.[^.]+$/u, '').replace(/[_-]/gu, ' ').trim() || 'Salon photo';
                void onUpload(file, alt.slice(0, 500), replacement.current);
              }
            }}
          />
          <div className="studio-photo-actions">
            {(block.type === 'about' || images.length < 60) && (
              <button
                type="button"
                disabled={disabled || !rights}
                onClick={() => {
                  replacement.current = block.type === 'about' ? image?.mediaId : undefined;
                  picker.current?.click();
                }}
              >
                {block.type === 'about' && image ? 'Upload replacement photo' : 'Upload a photo'}
              </button>
            )}
            {block.type === 'gallery' && image && (
              <button
                type="button"
                disabled={disabled || !rights}
                onClick={() => {
                  replacement.current = image.mediaId;
                  picker.current?.click();
                }}
              >
                Upload replacement photo
              </button>
            )}
          </div>
          <p>PNG, JPG or WebP · up to 20 MB. Larger photos are prepared automatically, without stretching or cropping.</p>
        </div>
      )}
    </fieldset>
  );
}

export function CanvaNativePhotoEditor({ payload, choices, disabled, onSave, uploadsEnabled = false, onUpload }: { payload: CustomSitePayload; choices: NativePhotoChoice[]; disabled: boolean; onSave: (blockId: string, change: CanvaNativeChange) => Promise<void>; uploadsEnabled?: boolean; onUpload?: (blockId: string, file: File, alt: string, replaceId?: string, createGallery?: boolean) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const canUpload = uploadsEnabled && Boolean(onUpload);
  const blocks = (payload.source.canva?.nativeContent ?? []).filter(block => block.type !== 'reviews').filter(block => canUpload || (block.type === 'about' ? Boolean(block.image) : block.images.length > 0) || choices.some(choice => choice.role === (block.type === 'about' ? 'profile' : 'gallery')));
  const newGallery = canUpload && !blocks.some(block => block.type === 'gallery');
  if (newGallery) {
    blocks.push({ type: 'gallery', id: 'native-photo-gallery', title: 'Gallery', beforePage: payload.source.canva!.pages.length, layout: 'grid', images: [] });
  }
  const block = blocks.find(block => block.id === selected) ?? blocks[0];
  if (!block) {
    return null;
  }
  return (
    <details className="studio-media-controls studio-native-photo-controls" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>About & Gallery photos</summary>
      {open && (
        <section className="studio-photo-library">
          <p>These photos sit beside your Canva artwork. Your original design image stays unchanged.</p>
          {blocks.length > 1 && (
            <label>
              Choose a section
              <select value={block.id} onChange={event => setSelected(event.target.value)}>{blocks.map((item, index) => <option key={item.id} value={item.id}>{`${item.title} (${index + 1})`}</option>)}</select>
            </label>
          )}
          <PhotoControls key={block.id} block={block} choices={choices} media={payload.nativeMedia} disabled={disabled} newGallery={newGallery && block.id === 'native-photo-gallery'} onSave={change => onSave(block.id, newGallery && block.id === 'native-photo-gallery' && change.type === 'use' ? { ...change, createGallery: true } : change)} onUpload={canUpload ? (file, alt, replaceId) => onUpload!(block.id, file, alt, replaceId, newGallery && block.id === 'native-photo-gallery' ? true : undefined) : undefined} />
          <p>Changes are saved to your draft. Review and publish when you are ready.</p>
        </section>
      )}
    </details>
  );
}
