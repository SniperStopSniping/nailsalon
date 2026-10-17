import type { CustomDesignImageItem } from '../model/types';

/** Upload advice only; originals and normalized link coordinates stay intact. */
export function DesignExportHelp({ images }: { images: readonly CustomDesignImageItem[] }) {
  const smallImages = images.filter(image => image.width < 640);
  return (
    <div className="custom-design-export-help">
      {smallImages.length > 0
        ? (
            <p role="status">
              A sharper export would help:
              {' '}
              {smallImages.map(image => image.fileName).join(', ')}
              .
              {' '}
              Small images can look blurry when enlarged. You can continue and replace them later.
            </p>
          )
        : null}
      <details>
        <summary>Get a sharp Canva export</summary>
        <ol>
          <li>In Canva, choose Share → Download → PNG.</li>
          <li>Use 2× size if available. Aim for at least 1,200 pixels wide.</li>
          <li>Upload the downloaded file rather than a screenshot. Export a long design as separate pages if needed.</li>
        </ol>
        <p>Luster keeps the image’s proportions. It cannot recover detail missing from a small upload.</p>
      </details>
    </div>
  );
}
