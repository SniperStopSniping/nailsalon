'use client';

import { useEffect, useState } from 'react';

import type { ImageDimensions } from './canva-quality';
import { canvaImageQuality } from './canva-quality';

export function CanvaImageQuality({ page, name }: { page: ImageDimensions; name?: string }) {
  const quality = canvaImageQuality(page);
  return (
    <div className="setup-notice" role={quality.level === 'small' ? 'status' : undefined}>
      <strong>
        {name ? `${name} · ` : ''}
        {quality.level === 'small' ? 'A sharper image would help' : quality.level === 'standard' ? 'Good for phones; more detail helps on larger screens' : 'Good image resolution'}
      </strong>
      <p>
        {page.width}
        {' '}
        ×
        {' '}
        {page.height}
        {' '}
        pixels.
        {' '}
        {quality.level === 'small' ? 'This upload may look blurry when enlarged. You can still try it; Luster keeps its proportions but cannot recover missing detail.' : 'The whole design fits the screen without stretching or cropping. Small printed text still needs checking.'}
      </p>
      {page.width > page.height * 1.2 && <p>Wide pages shrink on a phone, including their text. A portrait Canva export is easier to read; an editable AI redesign can adapt the layout for phones.</p>}
      {quality.level !== 'sharp' && (
        <details>
          <summary>Get a sharper Canva export</summary>
          <p>
            Download the original PNG from Canva and increase its export size if available. Aim for at least
            {' '}
            {quality.recommendedWidth}
            {' '}
            pixels wide (
            {quality.recommendedWidth}
            {' '}
            ×
            {quality.recommendedHeight}
            {' '}
            for this design). Avoid screenshots or images forwarded through messaging apps. Canva images up to 20 MB are prepared automatically for upload.
          </p>
          <p>A larger export of the original design can preserve more detail. Enlarging this small image alone will not make its text sharper.</p>
        </details>
      )}
    </div>
  );
}

/** Local inspection does not upload files or consume AI. Release every object URL. */
export function CanvaUploadQuality({ files }: { files: File[] }) {
  const [pages, setPages] = useState<{ file: File; dimensions: ImageDimensions }[]>([]);
  useEffect(() => {
    let active = true;
    setPages([]);
    if (typeof URL.createObjectURL !== 'function') {
      return;
    }
    const pending = files.filter(file => file.type.startsWith('image/')).map((file) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        if (active && image.naturalWidth && image.naturalHeight) {
          setPages(current => [...current, { file, dimensions: { width: image.naturalWidth, height: image.naturalHeight } }]);
        }
      };
      image.src = url;
      return { url, image };
    });
    return () => {
      active = false;
      for (const { url, image } of pending) {
        image.onload = null;
        image.onerror = null;
        URL.revokeObjectURL(url);
      }
    };
  }, [files]);
  return (
    <>
      {files.some(file => file.type === 'application/pdf') && <p>PDF pages are prepared in order. Text and shapes can stay sharp; low-resolution pictures inside the PDF will still need a better original.</p>}
      {files.map(file => pages.find(page => page.file === file)).filter(page => page !== undefined).map(page => <CanvaImageQuality key={`${page.file.name}-${page.file.size}-${page.file.lastModified}`} page={page.dimensions} name={page.file.name} />)}
    </>
  );
}
