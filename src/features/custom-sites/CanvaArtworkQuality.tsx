'use client';

import { useRef, useState } from 'react';

import type { CanvaDesign } from './canva';
import { canvaImageQuality } from './canva-quality';
import { CanvaImageQuality, CanvaUploadQuality } from './CanvaImageQuality';

export function CanvaArtworkQuality({ pages, disabled, onReplace }: {
  pages: CanvaDesign['pages'];
  disabled: boolean;
  onReplace: (pageIndex: number, file: File, kind: 'sharper' | 'new_design') => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [selectedPage, setSelectedPage] = useState(0);
  const [kind, setKind] = useState<'sharper' | 'new_design'>('sharper');
  const [files, setFiles] = useState<File[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  function choose(pageIndex: number, kind: 'sharper' | 'new_design') {
    setSelectedPage(pageIndex);
    setKind(kind);
    setFiles([]);
    setConfirmed(false);
    if (input.current) {
      input.current.value = '';
      input.current.click();
    }
  }
  return (
    <details className="studio-step" open={pages.some(page => canvaImageQuality(page).level === 'small')}>
      <summary>Images &amp; layout</summary>
      <section aria-label="Canva image quality">
        {pages.map((page, index) => (
          // Legacy pages have no ID; a new immutable artifact remounts this editor.
          // eslint-disable-next-line react/no-array-index-key
          <div key={`${page.id ?? page.assetId}:${index}`}>
            <CanvaImageQuality page={page} name={pages.length > 1 ? `Page ${index + 1}` : undefined} />
            <button
              type="button"
              disabled={disabled}
              onClick={() => choose(index, 'sharper')}
            >
              Upload sharper
              {' '}
              {pages.length > 1 ? `page ${index + 1}` : 'image'}
            </button>
            <button type="button" disabled={disabled} onClick={() => choose(index, 'new_design')}>
              {pages.length > 1 ? `Replace page ${index + 1}` : 'Replace design image'}
            </button>
          </div>
        ))}
        <input
          ref={input}
          type="file"
          className="setup-sr-only"
          aria-label={kind === 'new_design' ? 'New Canva design' : 'Sharper Canva export'}
          accept="image/png,image/jpeg,image/webp,application/pdf"
          disabled={disabled}
          onChange={(event) => {
            setFiles(Array.from(event.target.files ?? []));
            setConfirmed(false);
          }}
        />
        {files[0] && (
          <div className="setup-notice">
            <strong>{files[0].name}</strong>
            <CanvaUploadQuality files={files} />
            <label>
              <input type="checkbox" disabled={disabled} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
              {kind === 'new_design' ? 'I have permission to use this new design.' : 'This is the same design, text and layout, exported at a higher resolution. I have permission to use it.'}
            </label>
            <p>{kind === 'new_design' ? 'Links inside this page will be removed so you can place them on the new design. Other pages and your booking details stay as they are. Your published website stays unchanged.' : 'Your links stay in place. Check them before publishing. For a different layout, choose Replace design image instead.'}</p>
            <button type="button" disabled={disabled || !confirmed} onClick={() => void onReplace(selectedPage, files[0]!, kind)}>{kind === 'new_design' ? 'Replace design & reset its links' : 'Replace image & keep links'}</button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setFiles([]);
                setConfirmed(false);
              }}
            >
              Cancel replacement
            </button>
          </div>
        )}
      </section>
    </details>
  );
}
