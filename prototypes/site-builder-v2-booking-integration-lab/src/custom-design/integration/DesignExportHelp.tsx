import type { CustomDesignImageItem } from '../model/types';

/** Upload advice only; originals and normalized link coordinates stay intact. */
export function DesignExportHelp({ images }: { images: readonly CustomDesignImageItem[] }) {
  const smallImages = images.filter(image => image.width < 640);
  const hasWideImage = images.some(image => image.width / image.height > 2);
  const hasLongImage = images.some(image => image.height / image.width > 4);
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
      {hasWideImage
        ? <p className="custom-design-image-size-tip">Wide artwork stays in proportion. Small text may be hard to read on a phone; a portrait page works better for text-heavy designs.</p>
        : null}
      {hasLongImage
        ? <p className="custom-design-image-size-tip">This long design will scroll naturally. Separate pages can make small text easier to check and future updates simpler.</p>
        : null}
      <details>
        <summary>Get a sharp Canva export</summary>
        <p>There is no required shape. These sizes are useful starting points:</p>
        <table>
          <caption>Suggested image sizes</caption>
          <thead>
            <tr>
              <th scope="col">Your image</th>
              <th scope="col">Suggested export</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Portrait page</th>
              <td>1,200 × 1,800 px</td>
            </tr>
            <tr>
              <th scope="row">Square image</th>
              <td>1,200 × 1,200 px</td>
            </tr>
            <tr>
              <th scope="row">Wide banner</th>
              <td>1,920 × 1,080 px</td>
            </tr>
            <tr>
              <th scope="row">Long page</th>
              <td>At least 1,200 px wide; height can vary</td>
            </tr>
          </tbody>
        </table>
        <ol>
          <li>In Canva, choose Share → Download → PNG.</li>
          <li>Use 2× size if available. Aim for at least 1,200 pixels wide.</li>
          <li>Upload the downloaded file rather than a screenshot. Export a long design as separate pages if needed.</li>
        </ol>
        <p>Use Size & background to centre an unusual size and choose the colour around it. Luster fits the whole design without stretching or cropping it.</p>
        <p>Luster keeps the image’s proportions. It cannot recover detail missing from a small upload.</p>
      </details>
    </div>
  );
}
