'use client';

import { useRef, useState } from 'react';

import type { CanvaDesign } from './canva';
import { canvaImageQuality } from './canva-quality';
import { CanvaImageQuality, CanvaUploadQuality } from './CanvaImageQuality';

export function CanvaArtworkQuality({ pages, disabled, onReplace }: {
  pages: CanvaDesign['pages'];
  disabled: boolean;
  onReplace: (pageAssetId: string, file: File) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [selectedPage, setSelectedPage] = useState(pages[0]!.assetId);
  const [files, setFiles] = useState<File[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <details className="studio-step" open={pages.some(page => canvaImageQuality(page).level === 'small')}>
      <summary>Image quality & sharper exports</summary>
      <section aria-label="Canva image quality">
        {pages.map((page, index) => (
          <div key={page.assetId}>
            <CanvaImageQuality page={page} name={pages.length > 1 ? `Page ${index + 1}` : undefined} />
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setSelectedPage(page.assetId);
                setFiles([]);
                setConfirmed(false);
                if (input.current) {
                  input.current.value = '';
                  input.current.click();
                }
              }}
            >
              Upload sharper
              {' '}
              {pages.length > 1 ? `page ${index + 1}` : 'image'}
            </button>
          </div>
        ))}
        <input
          ref={input}
          type="file"
          className="setup-sr-only"
          aria-label="Sharper Canva export"
          accept="image/png,image/jpeg,image/webp"
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
              This is the same design, text and layout, exported at a higher resolution. I have permission to use it.
            </label>
            <p>Your links stay in place. Check them before publishing. A different layout should be attached in chat so Luster can find its links again.</p>
            <button type="button" disabled={disabled || !confirmed} onClick={() => void onReplace(selectedPage, files[0]!)}>Replace image & keep links</button>
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
